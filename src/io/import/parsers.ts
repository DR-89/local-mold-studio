import {
  BufferGeometry,
  Mesh,
  Object3D,
  Vector3,
} from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { MeshFileFormat, SourceUnit } from "./types";
import { MeshImportError } from "./types";

export type ParsedMesh = {
  trianglePositions: Float64Array;
  sourceUnit: Exclude<SourceUnit, "auto"> | null;
};

type ModelObject = {
  positions?: number[];
  indices?: number[];
  components?: ModelReference[];
};

type ModelReference = {
  objectId: string;
  transform: number[];
  modelPath: string;
};

type ModelPart = {
  unitMm: number;
  objects: Map<string, ModelObject>;
  buildItems: ModelReference[];
};

const THREE_MF_UNIT_TO_MM: Record<string, number> = {
  millimeter: 1,
  centimeter: 10,
  meter: 1_000,
  inch: 25.4,
  foot: 304.8,
  micron: 0.001,
};

const MAX_3MF_EXPANDED_BYTES = 200 * 1024 * 1024;

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MeshImportError("PARSE_FAILED", "The 3MF structure is incomplete.", label);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new MeshImportError("PARSE_FAILED", "The file contains invalid numbers.", label);
  }
  return number;
}

function transformPoint(
  x: number,
  y: number,
  z: number,
  transform: number[],
): [number, number, number] {
  const m = transform.length === 12
    ? transform
    : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  return [
    x * m[0] + y * m[3] + z * m[6] + m[9],
    x * m[1] + y * m[4] + z * m[7] + m[10],
    x * m[2] + y * m[5] + z * m[8] + m[11],
  ];
}

function parseTransform(value: unknown): number[] {
  if (typeof value !== "string") return [];
  const values = value.trim().split(/\s+/).map(Number);
  return values.length === 12 && values.every(Number.isFinite) ? values : [];
}

function normalizeModelPath(value: string, basePath = ""): string {
  const normalizedValue = value.replace(/\\/g, "/");
  const segments = normalizedValue.startsWith("/")
    ? []
    : basePath.split("/").slice(0, -1).filter(Boolean);
  for (const segment of normalizedValue.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new MeshImportError(
          "PARSE_FAILED",
          "A 3MF model path escapes the package.",
          value,
        );
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const result = segments.join("/");
  if (!result) {
    throw new MeshImportError(
      "PARSE_FAILED",
      "A 3MF model path is empty.",
      value,
    );
  }
  return result;
}

function scaleTransformTranslation(transform: number[], scale: number): number[] {
  if (transform.length !== 12 || scale === 1) return transform;
  const result = [...transform];
  result[9] *= scale;
  result[10] *= scale;
  result[11] *= scale;
  return result;
}

function objectToTrianglePositions(root: Object3D): Float64Array {
  const values: number[] = [];
  const point = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry as BufferGeometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const triangleCount = Math.floor(count / 3);
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const sourceIndex = index
          ? index.getX(triangle * 3 + corner)
          : triangle * 3 + corner;
        point.fromBufferAttribute(position, sourceIndex).applyMatrix4(child.matrixWorld);
        values.push(point.x, point.y, point.z);
      }
    }
  });
  if (values.length === 0) {
    throw new MeshImportError("EMPTY_MESH", "The file contains no triangular faces.");
  }
  return new Float64Array(values);
}

function parseStl(data: ArrayBuffer): ParsedMesh {
  let geometry: BufferGeometry;
  try {
    geometry = new STLLoader().parse(data);
  } catch (error) {
    throw new MeshImportError(
      "PARSE_FAILED",
      "The STL file could not be read.",
      error instanceof Error ? error.message : String(error),
    );
  }
  const root = new Object3D();
  root.add(new Mesh(geometry));
  return { trianglePositions: objectToTrianglePositions(root), sourceUnit: null };
}

function parseObj(data: ArrayBuffer): ParsedMesh {
  let root: Object3D;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    root = new OBJLoader().parse(text);
  } catch (error) {
    throw new MeshImportError(
      "PARSE_FAILED",
      "The OBJ file could not be read.",
      error instanceof Error ? error.message : String(error),
    );
  }
  return { trianglePositions: objectToTrianglePositions(root), sourceUnit: null };
}

function parseThreeMf(data: ArrayBuffer): ParsedMesh {
  let expandedBytes = 0;
  let rawArchive: Record<string, Uint8Array>;
  try {
    rawArchive = unzipSync(new Uint8Array(data), {
      filter: (file) => {
        if (!/\.model$/i.test(file.name)) return false;
        expandedBytes += file.originalSize;
        if (expandedBytes > MAX_3MF_EXPANDED_BYTES) {
          throw new MeshImportError(
            "FILE_TOO_LARGE",
            "The unpacked 3MF exceeds the safe size limit.",
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof MeshImportError) throw error;
    throw new MeshImportError(
      "PARSE_FAILED",
      "The 3MF archive could not be opened.",
      error instanceof Error ? error.message : String(error),
    );
  }

  const archive = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(rawArchive)) {
    const modelPath = normalizeModelPath(name);
    if (archive.has(modelPath)) {
      throw new MeshImportError(
        "PARSE_FAILED",
        "The 3MF contains duplicate model paths.",
        modelPath,
      );
    }
    archive.set(modelPath, bytes);
  }
  const rootModelPath =
    [...archive.keys()].find((name) => /^3D\/3dmodel\.model$/i.test(name)) ??
    [...archive.keys()][0];
  if (!rootModelPath) {
    throw new MeshImportError("PARSE_FAILED", "The 3MF contains no model.");
  }

  const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    processEntities: false,
  });
  const models = new Map<string, ModelPart>();
  try {
    for (const [modelPath, bytes] of archive) {
      const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
        throw new MeshImportError(
          "PARSE_FAILED",
          "3MF files with external or custom entities are not accepted.",
        );
      }
      const parsed = xmlParser.parse(xml) as Record<string, unknown>;
      const model = asRecord(parsed.model, "model");
      const unitName = typeof model.unit === "string"
        ? model.unit.toLowerCase()
        : "millimeter";
      const unitMm = THREE_MF_UNIT_TO_MM[unitName];
      if (unitMm === undefined) {
        throw new MeshImportError(
          "PARSE_FAILED",
          "The 3MF uses an unknown unit.",
          unitName,
        );
      }

      const objects = new Map<string, ModelObject>();
      const resources = asRecord(model.resources, "resources");
      for (const candidate of asArray(resources.object)) {
        const object = asRecord(candidate, "object");
        const id = String(object.id ?? "");
        if (!id) continue;
        const result: ModelObject = {};
        if (object.mesh) {
          const mesh = asRecord(object.mesh, "mesh");
          const verticesNode = asRecord(mesh.vertices, "vertices");
          const trianglesNode = asRecord(mesh.triangles, "triangles");
          const positions: number[] = [];
          for (const value of asArray(verticesNode.vertex)) {
            const vertex = asRecord(value, "vertex");
            positions.push(
              finiteNumber(vertex.x, "vertex.x"),
              finiteNumber(vertex.y, "vertex.y"),
              finiteNumber(vertex.z, "vertex.z"),
            );
          }
          const indices: number[] = [];
          for (const value of asArray(trianglesNode.triangle)) {
            const triangle = asRecord(value, "triangle");
            indices.push(
              finiteNumber(triangle.v1, "triangle.v1"),
              finiteNumber(triangle.v2, "triangle.v2"),
              finiteNumber(triangle.v3, "triangle.v3"),
            );
          }
          result.positions = positions;
          result.indices = indices;
        }
        if (object.components) {
          const componentsNode = asRecord(object.components, "components");
          result.components = asArray(componentsNode.component).map((value) => {
            const component = asRecord(value, "component");
            return {
              objectId: String(component.objectid ?? ""),
              transform: parseTransform(component.transform),
              modelPath: typeof component.path === "string"
                ? normalizeModelPath(component.path, modelPath)
                : modelPath,
            };
          });
        }
        objects.set(id, result);
      }

      const buildItems: ModelReference[] = [];
      if (model.build) {
        const build = asRecord(model.build, "build");
        for (const value of asArray(build.item)) {
          const item = asRecord(value, "item");
          buildItems.push({
            objectId: String(item.objectid ?? ""),
            transform: parseTransform(item.transform),
            modelPath: typeof item.path === "string"
              ? normalizeModelPath(item.path, modelPath)
              : modelPath,
          });
        }
      }
      models.set(modelPath, { unitMm, objects, buildItems });
    }
  } catch (error) {
    if (error instanceof MeshImportError) throw error;
    throw new MeshImportError(
      "PARSE_FAILED",
      "The 3MF model data could not be read.",
      error instanceof Error ? error.message : String(error),
    );
  }

  const rootModel = models.get(rootModelPath);
  if (!rootModel) {
    throw new MeshImportError("PARSE_FAILED", "The main 3MF model is missing.");
  }
  const rootUnitMm = rootModel.unitMm;

  function resolveObjectGroups(
    modelPath: string,
    objectId: string,
    transform: number[],
    stack: Set<string>,
  ): number[][] {
    const objectKey = modelPath + "#" + objectId;
    if (stack.has(objectKey)) {
      throw new MeshImportError("PARSE_FAILED", "The 3MF contains a cyclic component.");
    }
    const model = models.get(modelPath);
    if (!model) {
      throw new MeshImportError(
        "PARSE_FAILED",
        "A 3MF component refers to a missing model part.",
        modelPath,
      );
    }
    const object = model.objects.get(objectId);
    if (!object) {
      throw new MeshImportError(
        "PARSE_FAILED",
        "A 3MF component refers to a missing object.",
        objectKey,
      );
    }
    const nextStack = new Set(stack).add(objectKey);
    const groups: number[][] = [];
    const modelScale = model.unitMm / rootUnitMm;
    if (object.positions && object.indices) {
      const output: number[] = [];
      for (const index of object.indices) {
        const offset = index * 3;
        if (offset < 0 || offset + 2 >= object.positions.length) {
          throw new MeshImportError("PARSE_FAILED", "A 3MF triangle has an invalid vertex index.");
        }
        output.push(...transformPoint(
          object.positions[offset] * modelScale,
          object.positions[offset + 1] * modelScale,
          object.positions[offset + 2] * modelScale,
          transform,
        ));
      }
      if (output.length > 0) groups.push(output);
    }
    for (const component of object.components ?? []) {
      const childGroups = resolveObjectGroups(
        component.modelPath,
        component.objectId,
        scaleTransformTranslation(component.transform, modelScale),
        nextStack,
      );
      for (const child of childGroups) {
        const output: number[] = [];
        for (let offset = 0; offset < child.length; offset += 3) {
          output.push(...transformPoint(
            child[offset],
            child[offset + 1],
            child[offset + 2],
            transform,
          ));
        }
        groups.push(output);
      }
    }
    return groups;
  }

  const outputGroups: Float64Array[] = [];
  for (const item of rootModel.buildItems) {
    const builtGroups = resolveObjectGroups(
      item.modelPath,
      item.objectId,
      item.transform,
      new Set(),
    );
    for (const group of builtGroups) outputGroups.push(new Float64Array(group));
  }  if (outputGroups.length === 0) {
    throw new MeshImportError("EMPTY_MESH", "The 3MF contains no built triangular faces.");
  }
  const sourceUnitMap: Record<number, Exclude<SourceUnit, "auto">> = {
    1: "mm",
    10: "cm",
    1_000: "m",
    25.4: "inch",
    304.8: "foot",
    0.001: "micron",
  };
  return {
    triangleGroups: outputGroups,
    sourceUnit: sourceUnitMap[rootUnitMm] ?? "mm",
  };
}

export function detectMeshFormat(fileName: string): MeshFileFormat {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "stl" || extension === "obj" || extension === "3mf") return extension;
  throw new MeshImportError(
    "UNSUPPORTED_FORMAT",
    "STL, OBJ, and 3MF files are supported.",
  );
}

export function parseMeshFile(
  data: ArrayBuffer,
  format: MeshFileFormat,
): ParsedMesh {
  if (format === "stl") return parseStl(data);
  if (format === "obj") return parseObj(data);
  return parseThreeMf(data);
}
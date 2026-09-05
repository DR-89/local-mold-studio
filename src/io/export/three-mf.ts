import { strToU8, zipSync } from "fflate";
import { MODEL_SPLITTER_PLATE_EDGE_MARGIN_MM } from "../../domain/model-splitter";
import type { TriangleMeshData } from "../../workers/protocol";

function xmlEscape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}

function number(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function meshXml(
  mesh: TriangleMeshData,
  id: number,
  name: string,
  productionUuid?: string,
): string {
  const vertices: string[] = [];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    vertices.push(
      '<vertex x="' +
        number(mesh.positions[offset]) +
        '" y="' +
        number(mesh.positions[offset + 1]) +
        '" z="' +
        number(mesh.positions[offset + 2]) +
        '"/>',
    );
  }
  const triangles: string[] = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    triangles.push(
      '<triangle v1="' +
        mesh.indices[offset] +
        '" v2="' +
        mesh.indices[offset + 1] +
        '" v3="' +
        mesh.indices[offset + 2] +
        '"/>',
    );
  }
  return (
    '<object id="' +
    id +
    (productionUuid ? '" p:UUID="' + productionUuid : "") +
    '" type="model" name="' +
    xmlEscape(name) +
    '"><mesh><vertices>' +
    vertices.join("") +
    "</vertices><triangles>" +
    triangles.join("") +
    "</triangles></mesh></object>"
  );
}

function width(mesh: TriangleMeshData): number {
  let min = Infinity;
  let max = -Infinity;
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    min = Math.min(min, mesh.positions[offset]);
    max = Math.max(max, mesh.positions[offset]);
  }
  return max - min;
}

export type ThreeMfPart = {
  mesh: TriangleMeshData;
  name: string;
  forceOwnPlate?: boolean;
};

export function encodeMultiPartThreeMf(
  parts: ThreeMfPart[],
  title = "Local Mold Studio · Multipart box mold",
  projectSettings?: Record<string, unknown>,
): {
  archive: Uint8Array;
  offsetsXMm: number[];
} {
  if (parts.length < 1 || parts.length > 256) {
    throw new Error("A combined 3MF requires one to 256 model parts.");
  }
  const offsetsXMm: number[] = [];
  let cursorX = 0;
  const resources: string[] = [];
  const items: string[] = [];
  parts.forEach((part, index) => {
    const objectId = index + 1;
    offsetsXMm.push(cursorX);
    resources.push(meshXml(part.mesh, objectId, part.name));
    const transform =
      cursorX === 0
        ? ""
        : ' transform="1 0 0 0 1 0 0 0 1 ' + number(cursorX) + ' 0 0"';
    items.push('<item objectid="' + objectId + '"' + transform + "/>");
    cursorX += width(part.mesh) + 5;
  });
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<metadata name="Title">' +
    xmlEscape(title) +
    "</metadata>" +
    "<resources>" +
    resources.join("") +
    "</resources><build>" +
    items.join("") +
    "</build></model>";
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    "</Types>";
  const relationships =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    "</Relationships>";
  const archiveFiles: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(relationships),
    "3D/3dmodel.model": strToU8(model),
  };
  if (projectSettings) {
    archiveFiles["Metadata/project_settings.config"] = strToU8(
      JSON.stringify(projectSettings),
    );
  }
  return {
    offsetsXMm,
    archive: zipSync(archiveFiles, { level: 6 }),
  };
}
export const BAMBU_STUDIO_MAX_PLATES = 36;
export const BAMBU_STUDIO_PROJECT_GENERATOR = "BambuStudio-02.08.02.61";
export const H2S_EXPORT_BUILD_VOLUME_MM = [340, 320, 340] as const;
const BAMBU_STUDIO_PLATE_GAP_RATIO = 0.2;

function bambuPlateColumnCount(plateCount: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(plateCount)));
}

function bambuPlateOrigin(
  plateIndex: number,
  plateCount: number,
  buildVolumeMm: readonly [number, number, number],
): [number, number] {
  const columns = bambuPlateColumnCount(plateCount);
  const column = plateIndex % columns;
  const row = Math.floor(plateIndex / columns);
  return [
    column * buildVolumeMm[0] * (1 + BAMBU_STUDIO_PLATE_GAP_RATIO),
    -row * buildVolumeMm[1] * (1 + BAMBU_STUDIO_PLATE_GAP_RATIO),
  ];
}

export type AxisAlignedRotation = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type ThreeMfPlatePlacement = {
  plateNumber: number;
  translationMm: [number, number, number];
  rotationMatrix: AxisAlignedRotation;
  orientedSizeMm: [number, number, number];
  bedContactAreaMm2: number;
};

type MultiPlateThreeMfOptions = {
  title: string;
  buildVolumeMm: readonly [number, number, number];
  sourceSizeMm: readonly [number, number, number];
  lightningInfillPercent: number;
  wallLoops: number;
  packSmallParts?: boolean;
  infillPattern?: "lightning" | "gyroid" | "cubic";
  topShellLayers?: number;
  bottomShellLayers?: number;
  filamentProfileId?: string;
  filamentType?: string;
  supportsEnabled?: boolean;
  nozzleDiameterMm?: ThreeMfPrintProfile["nozzleDiameterMm"];
  layerHeightMm?: number;
  processPreset?: "cloud-fast";
};

export type ThreeMfPrintProfile = {
  nozzleDiameterMm: 0.2 | 0.4 | 0.6 | 0.8;
  layerHeightMm: number;
  supportType: "tree(auto)";
  supportStyle: "tree_organic";
};

export function recommendThreeMfPrintProfile(
  sourceSizeMm: readonly [number, number, number],
): ThreeMfPrintProfile {
  const largestDimensionMm = Math.max(...sourceSizeMm);
  const nozzleDiameterMm =
    largestDimensionMm <= 80
      ? 0.2
      : largestDimensionMm <= 350
        ? 0.4
        : largestDimensionMm <= 1_000
          ? 0.6
          : 0.8;
  return {
    nozzleDiameterMm,
    layerHeightMm: nozzleDiameterMm / 2,
    supportType: "tree(auto)",
    supportStyle: "tree_organic",
  };
}

type Bounds3 = {
  min: [number, number, number];
  max: [number, number, number];
};

const AXIS_PERMUTATIONS: Array<[0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

function meshBounds(mesh: TriangleMeshData): Bounds3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[offset + axis] ?? 0;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}

function axisAlignedRotations(): AxisAlignedRotation[] {
  const rotations: AxisAlignedRotation[] = [];
  for (const permutation of AXIS_PERMUTATIONS) {
    const inversions =
      Number(permutation[0] > permutation[1]) +
      Number(permutation[0] > permutation[2]) +
      Number(permutation[1] > permutation[2]);
    const parity = inversions % 2 === 0 ? 1 : -1;
    for (const xSign of [-1, 1]) {
      for (const ySign of [-1, 1]) {
        for (const zSign of [-1, 1]) {
          if (xSign * ySign * zSign !== parity) {
            continue;
          }
          const signs = [xSign, ySign, zSign];
          const rotation: AxisAlignedRotation = [0, 0, 0, 0, 0, 0, 0, 0, 0];
          for (let outputAxis = 0; outputAxis < 3; outputAxis += 1) {
            const inputAxis = permutation[outputAxis];
            rotation[inputAxis * 3 + outputAxis] = signs[outputAxis] ?? 1;
          }
          rotations.push(rotation);
        }
      }
    }
  }
  return rotations;
}

const AXIS_ALIGNED_ROTATIONS = axisAlignedRotations();

function transformPoint(
  point: readonly [number, number, number],
  rotation: AxisAlignedRotation,
): [number, number, number] {
  return [
    point[0] * rotation[0] + point[1] * rotation[3] + point[2] * rotation[6],
    point[0] * rotation[1] + point[1] * rotation[4] + point[2] * rotation[7],
    point[0] * rotation[2] + point[1] * rotation[5] + point[2] * rotation[8],
  ];
}

function transformedBounds(
  bounds: Bounds3,
  rotation: AxisAlignedRotation,
): Bounds3 {
  const result: Bounds3 = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = transformPoint([x, y, z], rotation);
        for (let axis = 0; axis < 3; axis += 1) {
          result.min[axis] = Math.min(result.min[axis], point[axis]);
          result.max[axis] = Math.max(result.max[axis], point[axis]);
        }
      }
    }
  }
  return result;
}

function bedContactArea(
  mesh: TriangleMeshData,
  rotation: AxisAlignedRotation,
  minimumZ: number,
  height: number,
): number {
  const tolerance = Math.max(1e-4, height * 1e-6);
  let area = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const points = [0, 1, 2].map((corner) => {
      const vertexIndex = mesh.indices[offset + corner] ?? 0;
      const positionOffset = vertexIndex * 3;
      return transformPoint(
        [
          mesh.positions[positionOffset] ?? 0,
          mesh.positions[positionOffset + 1] ?? 0,
          mesh.positions[positionOffset + 2] ?? 0,
        ],
        rotation,
      );
    }) as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];
    if (points.some((point) => Math.abs(point[2] - minimumZ) > tolerance)) {
      continue;
    }
    const ab = [
      points[1][0] - points[0][0],
      points[1][1] - points[0][1],
      points[1][2] - points[0][2],
    ];
    const ac = [
      points[2][0] - points[0][0],
      points[2][1] - points[0][1],
      points[2][2] - points[0][2],
    ];
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    area += Math.hypot(cross[0], cross[1], cross[2]) / 2;
  }
  return area;
}
function choosePrintOrientation(
  mesh: TriangleMeshData,
  buildVolumeMm: readonly [number, number, number],
): {
  rotation: AxisAlignedRotation;
  bounds: Bounds3;
  size: [number, number, number];
  bedContactAreaMm2: number;
} {
  const sourceBounds = meshBounds(mesh);
  let best: ReturnType<typeof choosePrintOrientation> | null = null;
  let bestOverflow = Infinity;
  let bestContactArea = -Infinity;
  let bestHeight = Infinity;
  let bestPlanarSlack = Infinity;
  const epsilon = 1e-6;
  for (const rotation of AXIS_ALIGNED_ROTATIONS) {
    const bounds = transformedBounds(sourceBounds, rotation);
    const size: [number, number, number] = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ];
    const overflow = size.reduce(
      (sum, value, axis) =>
        sum +
        Math.max(0, value - buildVolumeMm[axis]) /
          Math.max(1, buildVolumeMm[axis]),
      0,
    );
    const contactArea = bedContactArea(mesh, rotation, bounds.min[2], size[2]);
    const planarSlack =
      Math.abs(buildVolumeMm[0] - size[0]) +
      Math.abs(buildVolumeMm[1] - size[1]);
    const improves =
      overflow < bestOverflow - epsilon ||
      (Math.abs(overflow - bestOverflow) <= epsilon &&
        (contactArea > bestContactArea + epsilon ||
          (Math.abs(contactArea - bestContactArea) <= epsilon &&
            (size[2] < bestHeight - epsilon ||
              (Math.abs(size[2] - bestHeight) <= epsilon &&
                planarSlack < bestPlanarSlack - epsilon)))));
    if (improves) {
      bestOverflow = overflow;
      bestContactArea = contactArea;
      bestHeight = size[2];
      bestPlanarSlack = planarSlack;
      best = { rotation, bounds, size, bedContactAreaMm2: contactArea };
    }
  }
  return best!;
}

function matrix(
  rotation: AxisAlignedRotation,
  translation: readonly [number, number, number],
): string {
  return [...rotation, ...translation].map(number).join(" ");
}
type PreparedThreeMfPart = {
  part: ThreeMfPart;
  orientation: ReturnType<typeof choosePrintOrientation>;
};

type PackedThreeMfPart = {
  plateIndex: number;
  localCenterMm: [number, number];
};

const PACKED_PART_GAP_MM = 5;
const MAX_SMALL_PARTS_PER_PLATE = BAMBU_STUDIO_MAX_PLATES;

function packThreeMfParts(
  prepared: readonly PreparedThreeMfPart[],
  buildVolumeMm: readonly [number, number, number],
  enabled: boolean,
): { packed: PackedThreeMfPart[]; plateCount: number } {
  const [bedWidth, bedDepth] = buildVolumeMm;
  if (!enabled) {
    return {
      packed: prepared.map((_, plateIndex) => ({
        plateIndex,
        localCenterMm: [bedWidth / 2, bedDepth / 2],
      })),
      plateCount: prepared.length,
    };
  }

  const margin = MODEL_SPLITTER_PLATE_EDGE_MARGIN_MM;
  const gap = Math.min(PACKED_PART_GAP_MM, bedWidth * 0.04, bedDepth * 0.04);
  type ShelfPlate = {
    plateIndex: number;
    cursorX: number;
    cursorY: number;
    rowHeight: number;
    count: number;
  };
  const shelfPlates: ShelfPlate[] = [];
  const packed: PackedThreeMfPart[] = [];
  let plateCount = 0;

  const tryPlace = (
    plate: ShelfPlate,
    width: number,
    depth: number,
  ): [number, number] | null => {
    if (plate.count >= MAX_SMALL_PARTS_PER_PLATE) return null;
    let x = plate.cursorX;
    let y = plate.cursorY;
    let rowHeight = plate.rowHeight;
    if (x + width > bedWidth - margin + 1e-6) {
      x = margin;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    if (
      x + width > bedWidth - margin + 1e-6 ||
      y + depth > bedDepth - margin + 1e-6
    )
      return null;
    plate.cursorX = x + width + gap;
    plate.cursorY = y;
    plate.rowHeight = Math.max(rowHeight, depth);
    plate.count += 1;
    return [x + width / 2, y + depth / 2];
  };

  for (const item of prepared) {
    const [width, depth] = item.orientation.size;
    const footprintRatio = (width * depth) / Math.max(1, bedWidth * bedDepth);
    const tiny =
      width <= bedWidth * 0.3 &&
      depth <= bedDepth * 0.3 &&
      footprintRatio <= 0.05;
    const small =
      tiny ||
      (!item.part.forceOwnPlate &&
        width <= bedWidth * 0.55 &&
        depth <= bedDepth * 0.55 &&
        footprintRatio <= 0.22);
    if (!small) {
      packed.push({
        plateIndex: plateCount,
        localCenterMm: [bedWidth / 2, bedDepth / 2],
      });
      plateCount += 1;
      continue;
    }

    let selectedPlate: ShelfPlate | null = null;
    let placement: [number, number] | null = null;
    for (const candidate of shelfPlates) {
      placement = tryPlace(candidate, width, depth);
      if (placement) {
        selectedPlate = candidate;
        break;
      }
    }
    if (!placement) {
      selectedPlate = {
        plateIndex: plateCount,
        cursorX: margin,
        cursorY: margin,
        rowHeight: 0,
        count: 0,
      };
      plateCount += 1;
      shelfPlates.push(selectedPlate);
      placement = tryPlace(selectedPlate, width, depth);
    }
    packed.push({
      plateIndex: selectedPlate!.plateIndex,
      localCenterMm: placement ?? [bedWidth / 2, bedDepth / 2],
    });
  }
  return { packed, plateCount };
}

export function encodeMultiPlateThreeMf(
  parts: ThreeMfPart[],
  options: MultiPlateThreeMfOptions,
): {
  archive: Uint8Array;
  placements: ThreeMfPlatePlacement[];
  plateCount: number;
  printProfile: ThreeMfPrintProfile;
} {
  if (parts.length < 1 || parts.length > BAMBU_STUDIO_MAX_PLATES) {
    throw new Error(
      `A Bambu Studio 3MF requires one to ${BAMBU_STUDIO_MAX_PLATES} plates.`,
    );
  }
  const resources: string[] = [];
  const items: string[] = [];
  const objects: string[] = [];
  const plates: string[] = [];
  const objectModels: Record<string, Uint8Array> = {};
  const objectRelationships: string[] = [];
  const placements: ThreeMfPlatePlacement[] = [];
  const recommendedPrintProfile = recommendThreeMfPrintProfile(
    options.sourceSizeMm,
  );
  const cloudFast = options.processPreset === "cloud-fast";
  const printProfile: ThreeMfPrintProfile = {
    ...recommendedPrintProfile,
    nozzleDiameterMm:
      options.nozzleDiameterMm ??
      (cloudFast ? 0.6 : recommendedPrintProfile.nozzleDiameterMm),
    layerHeightMm:
      options.layerHeightMm ??
      (cloudFast ? 0.36 : recommendedPrintProfile.layerHeightMm),
  };
  const orientationVolumeMm: [number, number, number] = [
    Math.max(
      1,
      options.buildVolumeMm[0] - MODEL_SPLITTER_PLATE_EDGE_MARGIN_MM * 2,
    ),
    Math.max(
      1,
      options.buildVolumeMm[1] - MODEL_SPLITTER_PLATE_EDGE_MARGIN_MM * 2,
    ),
    options.buildVolumeMm[2],
  ];
  const prepared: PreparedThreeMfPart[] = parts.map((part) => ({
    part,
    orientation: choosePrintOrientation(part.mesh, orientationVolumeMm),
  }));
  const packing = packThreeMfParts(
    prepared,
    options.buildVolumeMm,
    options.packSmallParts ?? false,
  );
  const plateInstances: string[][] = Array.from(
    { length: packing.plateCount },
    () => [],
  );
  const plateNames: string[][] = Array.from(
    { length: packing.plateCount },
    () => [],
  );

  parts.forEach((part, index) => {
    const meshId = index * 2 + 1;
    const objectId = meshId + 1;
    const orientation = prepared[index]!.orientation;
    const packed = packing.packed[index]!;
    const plateOrigin = bambuPlateOrigin(
      packed.plateIndex,
      packing.plateCount,
      options.buildVolumeMm,
    );
    const instanceUuid =
      objectId.toString().padStart(8, "0") + "-b1ec-4553-aec9-835e5b724bb4";
    const wrapperUuid =
      "00000000-0000-4000-8000-" + objectId.toString().padStart(12, "0");
    const componentUuid =
      "00000000-0000-4000-8100-" + meshId.toString().padStart(12, "0");
    const meshUuid =
      "00000000-0000-4000-8200-" + meshId.toString().padStart(12, "0");
    const partUuid =
      "00000000-0000-4000-8300-" + meshId.toString().padStart(12, "0");
    const translation: [number, number, number] = [
      plateOrigin[0] +
        packed.localCenterMm[0] -
        (orientation.bounds.min[0] + orientation.bounds.max[0]) / 2,
      plateOrigin[1] +
        packed.localCenterMm[1] -
        (orientation.bounds.min[1] + orientation.bounds.max[1]) / 2,
      -orientation.bounds.min[2],
    ];
    const transform = matrix(orientation.rotation, translation);
    const escapedName = xmlEscape(part.name);
    const triangleCount = Math.floor(part.mesh.indices.length / 3);
    const objectPath = `3D/Objects/object_${meshId}.model`;
    placements.push({
      plateNumber: packed.plateIndex + 1,
      translationMm: translation,
      rotationMatrix: orientation.rotation,
      orientedSizeMm: orientation.size,
      bedContactAreaMm2: orientation.bedContactAreaMm2,
    });

    resources.push(
      '<object id="' +
        objectId +
        '" p:UUID="' +
        wrapperUuid +
        '" type="model"><components>' +
        '<component p:path="/' +
        objectPath +
        '" objectid="' +
        meshId +
        '" p:UUID="' +
        componentUuid +
        '" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components></object>',
    );
    objectModels[objectPath] = strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ' +
        'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">' +
        '<metadata name="BambuStudio:3mfVersion">1</metadata><resources>' +
        meshXml(part.mesh, meshId, part.name, meshUuid) +
        "</resources><build/></model>",
    );
    objectRelationships.push(
      '<Relationship Target="/3D/Objects/object_' +
        meshId +
        '.model" Id="rel-' +
        objectId +
        '" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>',
    );
    items.push(
      '<item objectid="' +
        objectId +
        '" p:UUID="' +
        instanceUuid +
        '" transform="' +
        transform +
        '" printable="1"/>',
    );
    objects.push(
      '<object id="' +
        objectId +
        '"><metadata key="name" value="' +
        escapedName +
        '"/><metadata key="extruder" value="1"/><metadata face_count="' +
        triangleCount +
        '"/><part id="' +
        meshId +
        '" subtype="normal_part" uuid="' +
        partUuid +
        '"><metadata key="name" value="' +
        escapedName +
        '"/><metadata key="extruder" value="1"/><metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>' +
        '<metadata key="source_file" value="Local Mold Studio"/><metadata key="source_object_id" value="' +
        objectId +
        '"/><metadata key="source_volume_id" value="0"/><metadata key="source_offset_x" value="0"/>' +
        '<metadata key="source_offset_y" value="0"/><metadata key="source_offset_z" value="0"/>' +
        '<mesh_stat face_count="' +
        triangleCount +
        '" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/></part></object>',
    );
    plateNames[packed.plateIndex]!.push(part.name);
    plateInstances[packed.plateIndex]!.push(
      '<model_instance><metadata key="object_id" value="' +
        objectId +
        '"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="' +
        objectId +
        '"/></model_instance>',
    );
  });

  for (let plateIndex = 0; plateIndex < packing.plateCount; plateIndex += 1) {
    const names = plateNames[plateIndex]!;
    const plateName =
      names.length === 1
        ? names[0]!
        : `Packed small parts ${plateIndex + 1} (${names.length})`;
    plates.push(
      '<plate><metadata key="plater_id" value="' +
        (plateIndex + 1) +
        '"/><metadata key="plater_name" value="' +
        xmlEscape(plateName) +
        '"/><metadata key="locked" value="false"/><metadata key="filament_map_mode" value="Auto For Flush"/>' +
        '<metadata key="filament_maps" value="1"/><metadata key="filament_volume_maps" value="0"/>' +
        plateInstances[plateIndex]!.join("") +
        "</plate>",
    );
  }

  const model =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ' +
    'xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">' +
    '<metadata name="Application">' +
    BAMBU_STUDIO_PROJECT_GENERATOR +
    "</metadata>" +
    '<metadata name="Generator">Local Mold Studio</metadata><metadata name="BambuStudio:3mfVersion">1</metadata>' +
    '<metadata name="Title">' +
    xmlEscape(options.title) +
    "</metadata><resources>" +
    resources.join("") +
    '</resources><build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">' +
    items.join("") +
    "</build></model>";
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const relationships =
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  const modelRelationships =
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    objectRelationships.join("") +
    "</Relationships>";
  const modelSettings =
    '<?xml version="1.0" encoding="UTF-8"?><config>' +
    objects.join("") +
    plates.join("") +
    "</config>";
  const [buildWidth, buildDepth, buildHeight] = options.buildVolumeMm;
  const nozzle = printProfile.nozzleDiameterMm;
  const layerHeight = printProfile.layerHeightMm;
  const largeFast = cloudFast && nozzle === 0.8 && layerHeight >= 0.4;
  const lineWidth = nozzle * 1.05;
  const innerLineWidth = nozzle * 1.125;
  const nozzleLabel = nozzle.toFixed(1);
  const layerLabel = layerHeight.toFixed(2);
  const printerProfileId = `Bambu Lab H2S ${nozzleLabel} nozzle`;
  const printProfileId = cloudFast
    ? `${layerLabel}mm Local Mold Studio ${largeFast ? "LARGE FAST" : "FAST"} @BBL H2S`
    : `${layerLabel}mm Local Mold Studio @BBL H2S`;
  const defaultPrintProfileId = cloudFast
    ? `${layerLabel}mm Standard @BBL H2S ${nozzleLabel} nozzle`
    : `${layerLabel}mm Standard @BBL H2S`;
  const filamentProfileId =
    options.filamentProfileId ?? "Bambu PLA Basic @BBL H2S";
  const projectSettings = JSON.stringify({
    from: "project",
    name: "project_settings",
    version: BAMBU_STUDIO_PROJECT_GENERATOR.replace("BambuStudio-", ""),
    printer_technology: "FFF",
    printer_model: "Bambu Lab H2S",
    printer_variant: nozzleLabel,
    printer_structure: "corexy",
    printer_settings_id: printerProfileId,
    print_settings_id: printProfileId,
    default_print_profile: defaultPrintProfileId,
    filament_settings_id: [filamentProfileId],
    default_filament_profile: [filamentProfileId],
    printable_area: [
      "0x0",
      number(buildWidth) + "x0",
      number(buildWidth) + "x" + number(buildDepth),
      "0x" + number(buildDepth),
    ],
    printable_height: number(buildHeight),
    bed_exclude_area: [],
    sparse_infill_pattern: options.infillPattern ?? "lightning",
    sparse_infill_density: number(options.lightningInfillPercent) + "%",
    wall_loops: String(options.wallLoops),
    top_shell_layers:
      options.topShellLayers === undefined
        ? undefined
        : String(options.topShellLayers),
    bottom_shell_layers:
      options.bottomShellLayers === undefined
        ? undefined
        : String(options.bottomShellLayers),
    filament_type:
      options.filamentType === undefined ? undefined : [options.filamentType],
    nozzle_diameter: [number(nozzle)],
    nozzle_type: ["hardened_steel", "hardened_steel", "hardened_steel"],
    layer_height: number(layerHeight),
    min_layer_height: [number(nozzle * 0.2)],
    max_layer_height: [number(nozzle * 0.75)],
    initial_layer_print_height: number(
      largeFast ? 0.4 : cloudFast ? 0.3 : Math.max(0.2, layerHeight),
    ),
    line_width: number(lineWidth),
    initial_layer_line_width: number(nozzle * 1.25),
    outer_wall_line_width: number(lineWidth),
    inner_wall_line_width: number(innerLineWidth),
    sparse_infill_line_width: number(innerLineWidth),
    skeleton_infill_line_width: number(innerLineWidth),
    skin_infill_line_width: number(innerLineWidth),
    internal_solid_infill_line_width: number(lineWidth),
    top_surface_line_width: number(lineWidth),
    support_line_width: number(lineWidth),
    enable_support: options.supportsEnabled === false ? "0" : "1",
    support_type: printProfile.supportType,
    support_style: printProfile.supportStyle,
    support_on_build_plate_only: "0",
    support_threshold_angle: largeFast ? "60" : cloudFast ? "55" : "45",
    independent_support_layer_height: "1",
    support_interface_top_layers: cloudFast ? "2" : "3",
    support_interface_bottom_layers: largeFast ? "0" : cloudFast ? "1" : "2",
    support_top_z_distance: number(
      largeFast ? 0.4 : cloudFast ? 0.3 : layerHeight,
    ),
    support_bottom_z_distance: number(
      largeFast ? 0.4 : cloudFast ? 0.3 : layerHeight,
    ),
    ...(cloudFast
      ? {
          curr_bed_type: "Textured PEI Plate",
          wall_generator: "arachne",
          top_shell_thickness: "0.6",
          bottom_shell_thickness: "0",
          internal_solid_infill_pattern: "zig-zag",
          infill_direction: "45",
          minimum_sparse_infill_area: largeFast ? "30" : "15",
          detect_narrow_internal_solid_infill: "1",
          support_object_xy_distance: "0.35",
          support_object_first_layer_gap: "0.2",
          support_base_pattern: "default",
          support_base_pattern_spacing: largeFast ? "6" : "3.5",
          support_interface_pattern: "auto",
          support_interface_spacing: largeFast ? "0.7" : "0.5",
          support_bottom_interface_spacing: largeFast ? "0.7" : "0.5",
          support_remove_small_overhang: "1",
          support_critical_regions_only: largeFast ? "1" : "0",
          support_expansion: "0",
          bridge_no_support: "0",
          enable_overhang_speed: "1",
          brim_type: "auto_brim",
          brim_width: "0",
          brim_object_gap: "0",
          seam_position: "aligned",
          resolution: largeFast ? "0.04" : "0.01",
          print_sequence: "by layer",
          only_one_wall_first_layer: "0",
          elefant_foot_compensation: "0",
          outer_wall_speed: ["100"],
          inner_wall_speed: ["150"],
          sparse_infill_speed: ["200"],
          internal_solid_infill_speed: ["150"],
          top_surface_speed: ["100"],
          support_speed: ["120"],
          support_interface_speed: ["90"],
          travel_speed: ["300"],
          default_acceleration: ["5000"],
          outer_wall_acceleration: ["3000"],
          inner_wall_acceleration: ["5000"],
          sparse_infill_acceleration: ["7000"],
          top_surface_acceleration: ["3000"],
          travel_acceleration: ["10000"],
        }
      : {}),
  });
  const sliceInfo =
    '<?xml version="1.0" encoding="UTF-8"?><config><header><header_item key="X-BBL-Client-Type" value="slicer"/>' +
    '<header_item key="X-BBL-Client-Version" value="Local Mold Studio"/></header></config>';

  return {
    placements,
    plateCount: packing.plateCount,
    printProfile,
    archive: zipSync(
      {
        "[Content_Types].xml": strToU8(contentTypes),
        "_rels/.rels": strToU8(relationships),
        "3D/3dmodel.model": strToU8(model),
        "3D/_rels/3dmodel.model.rels": strToU8(modelRelationships),
        ...objectModels,
        "Metadata/model_settings.config": strToU8(modelSettings),
        "Metadata/project_settings.config": strToU8(projectSettings),
        "Metadata/slice_info.config": strToU8(sliceInfo),
      },
      { level: 6 },
    ),
  };
}
export function encodeCombinedThreeMf(
  front: TriangleMeshData,
  back: TriangleMeshData,
  frontName: string,
  backName: string,
): { archive: Uint8Array; backOffsetXMm: number } {
  const backOffsetXMm = width(front) + 5;
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<metadata name="Title">Local Mold Studio · Two-part box mold</metadata>' +
    "<resources>" +
    meshXml(front, 1, frontName) +
    meshXml(back, 2, backName) +
    "</resources><build>" +
    '<item objectid="1"/>' +
    '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 ' +
    number(backOffsetXMm) +
    ' 0 0"/>' +
    "</build></model>";
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    "</Types>";
  const relationships =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    "</Relationships>";
  return {
    backOffsetXMm,
    archive: zipSync(
      {
        "[Content_Types].xml": strToU8(contentTypes),
        "_rels/.rels": strToU8(relationships),
        "3D/3dmodel.model": strToU8(model),
      },
      { level: 6 },
    ),
  };
}

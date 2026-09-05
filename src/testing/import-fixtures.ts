import { strToU8, zipSync } from "fflate";
import type { TriangleMeshData } from "../workers/protocol";
import { indexedCube } from "./fixtures";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function textBuffer(value: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(value));
}

function triangles(mesh: TriangleMeshData): Array<[number, number, number][]> {
  const output: Array<[number, number, number][]> = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const triangle: Array<[number, number, number]> = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = mesh.indices[offset + corner];
      triangle.push([
        mesh.positions[index * 3],
        mesh.positions[index * 3 + 1],
        mesh.positions[index * 3 + 2],
      ]);
    }
    output.push(triangle);
  }
  return output;
}

export function cubeAsciiStl(options: {
  addDegenerate?: boolean;
  reverseTriangle?: number;
  open?: boolean;
} = {}): ArrayBuffer {
  const faces = triangles(indexedCube(20));
  if (options.open) faces.splice(faces.length - 2, 2);
  if (options.reverseTriangle !== undefined) {
    const face = faces[options.reverseTriangle];
    if (face) [face[1], face[2]] = [face[2], face[1]];
  }
  if (options.addDegenerate) {
    faces.push([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
  }
  const lines = ["solid fixture"];
  for (const face of faces) {
    lines.push("facet normal 0 0 0", "outer loop");
    for (const vertex of face) lines.push("vertex " + vertex.join(" "));
    lines.push("endloop", "endfacet");
  }
  lines.push("endsolid fixture");
  return textBuffer(lines.join("\n"));
}

export function cubeObj(options: {
  reverseTriangle?: number;
  open?: boolean;
  nonManifold?: boolean;
} = {}): ArrayBuffer {
  const mesh = indexedCube(20);
  const lines: string[] = ["o generated-cube"];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    lines.push(
      "v " +
        mesh.positions[offset] + " " +
        mesh.positions[offset + 1] + " " +
        mesh.positions[offset + 2],
    );
  }
  const faceCount = options.open ? mesh.indices.length / 3 - 2 : mesh.indices.length / 3;
  for (let triangle = 0; triangle < faceCount; triangle += 1) {
    const values = [
      mesh.indices[triangle * 3] + 1,
      mesh.indices[triangle * 3 + 1] + 1,
      mesh.indices[triangle * 3 + 2] + 1,
    ];
    if (options.reverseTriangle === triangle) {
      [values[1], values[2]] = [values[2], values[1]];
    }
    lines.push("f " + values.join(" "));
  }
  if (options.nonManifold) {
    lines.push("v 0 -20 0", "f 1 3 9");
  }
  return textBuffer(lines.join("\n"));
}

export function twoCubeObj(): ArrayBuffer {
  const mesh = indexedCube(20);
  const lines: string[] = ["o two-generated-cubes"];
  for (const offsetX of [0, 30]) {
    for (let offset = 0; offset < mesh.positions.length; offset += 3) {
      lines.push(
        "v " +
          (mesh.positions[offset] + offsetX) + " " +
          mesh.positions[offset + 1] + " " +
          mesh.positions[offset + 2],
      );
    }
  }
  const verticesPerCube = mesh.positions.length / 3;
  for (const cubeIndex of [0, 1]) {
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      lines.push(
        "f " +
          (mesh.indices[offset] + 1 + cubeIndex * verticesPerCube) + " " +
          (mesh.indices[offset + 1] + 1 + cubeIndex * verticesPerCube) + " " +
          (mesh.indices[offset + 2] + 1 + cubeIndex * verticesPerCube),
      );
    }
  }
  return textBuffer(lines.join("\n"));
}
export function cubeThreeMfCentimeters(): ArrayBuffer {
  const mesh = indexedCube(20);
  const vertexXml: string[] = [];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    vertexXml.push(
      '<vertex x="' + mesh.positions[offset] / 10 +
        '" y="' + mesh.positions[offset + 1] / 10 +
        '" z="' + mesh.positions[offset + 2] / 10 + '"/>',
    );
  }
  const triangleXml: string[] = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    triangleXml.push(
      '<triangle v1="' + mesh.indices[offset] +
        '" v2="' + mesh.indices[offset + 1] +
        '" v3="' + mesh.indices[offset + 2] + '"/>',
    );
  }
  const model = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="centimeter" xmlns="' + "http" + '://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '<resources><object id="1" type="model"><mesh><vertices>',
    vertexXml.join(""),
    '</vertices><triangles>',
    triangleXml.join(""),
    '</triangles></mesh></object></resources>',
    '<build><item objectid="1"/></build></model>',
  ].join("");
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="' + "http" + '://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '</Types>';
  const relationships =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="' + "http" + '://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" ' +
    'Type="' + "http" + '://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    '</Relationships>';
  return toArrayBuffer(
    zipSync({
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(relationships),
      "3D/3dmodel.model": strToU8(model),
    }),
  );
}
export function cubeThreeMfProductionExtension(): ArrayBuffer {
  const mesh = indexedCube(20);
  const vertices: string[] = [];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    vertices.push(
      '<vertex x="' + mesh.positions[offset] +
        '" y="' + mesh.positions[offset + 1] +
        '" z="' + mesh.positions[offset + 2] + '"/>',
    );
  }
  const triangles: string[] = [];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    triangles.push(
      '<triangle v1="' + mesh.indices[offset] +
        '" v2="' + mesh.indices[offset + 1] +
        '" v3="' + mesh.indices[offset + 2] + '"/>',
    );
  }
  const coreNamespace = "http" +
    "://schemas.microsoft.com/3dmanufacturing/core/2015/02";
  const productionNamespace = "http" +
    "://schemas.microsoft.com/3dmanufacturing/production/2015/06";
  const rootModel = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xmlns="', coreNamespace,
    '" xmlns:p="', productionNamespace, '" requiredextensions="p">',
    '<resources><object id="2" type="model"><components>',
    '<component objectid="1" p:path="/3D/Objects/object_1.model" ',
    'transform="1 0 0 0 1 0 0 0 1 5 0 0"/>',
    '</components></object></resources>',
    '<build><item objectid="2" ',
    'transform="1 0 0 0 1 0 0 0 1 10 2 3"/></build></model>',
  ].join("");
  const objectModel = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xmlns="', coreNamespace, '">',
    '<resources><object id="1" type="model"><mesh><vertices>',
    vertices.join(""),
    '</vertices><triangles>',
    triangles.join(""),
    '</triangles></mesh></object></resources></model>',
  ].join("");
  return toArrayBuffer(
    zipSync({
      "3D/3dmodel.model": strToU8(rootModel),
      "3D/Objects/object_1.model": strToU8(objectModel),
    }),
  );
}

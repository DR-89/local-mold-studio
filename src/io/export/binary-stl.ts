import type { TriangleMeshData } from "../../workers/protocol";

function normal(
  positions: Float32Array,
  aIndex: number,
  bIndex: number,
  cIndex: number,
): [number, number, number] {
  const ax = positions[aIndex * 3];
  const ay = positions[aIndex * 3 + 1];
  const az = positions[aIndex * 3 + 2];
  const ux = positions[bIndex * 3] - ax;
  const uy = positions[bIndex * 3 + 1] - ay;
  const uz = positions[bIndex * 3 + 2] - az;
  const vx = positions[cIndex * 3] - ax;
  const vy = positions[cIndex * 3 + 1] - ay;
  const vz = positions[cIndex * 3 + 2] - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  return length > 0 ? [nx / length, ny / length, nz / length] : [0, 0, 0];
}

export function encodeBinaryStl(
  mesh: TriangleMeshData,
  solidName: string,
): Uint8Array {
  const triangleCount = mesh.indices.length / 3;
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const bytes = new Uint8Array(buffer);
  const header = new TextEncoder().encode("Local Mold Studio · " + solidName);
  bytes.set(header.subarray(0, 80), 0);
  const view = new DataView(buffer);
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = mesh.indices[triangle * 3];
    const b = mesh.indices[triangle * 3 + 1];
    const c = mesh.indices[triangle * 3 + 2];
    const values = [
      ...normal(mesh.positions, a, b, c),
      mesh.positions[a * 3],
      mesh.positions[a * 3 + 1],
      mesh.positions[a * 3 + 2],
      mesh.positions[b * 3],
      mesh.positions[b * 3 + 1],
      mesh.positions[b * 3 + 2],
      mesh.positions[c * 3],
      mesh.positions[c * 3 + 1],
      mesh.positions[c * 3 + 2],
    ];
    for (const value of values) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return bytes;
}
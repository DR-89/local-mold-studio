import type { MeshBounds } from "../io/import/types";
import type { TriangleMeshData } from "../workers/protocol";

export type ModelPlacement = {
  positionMm: [number, number, number];
  rotationDeg: [number, number, number];
};

export const DEFAULT_MODEL_PLACEMENT: ModelPlacement = {
  positionMm: [0, 0, 0],
  rotationDeg: [0, 0, 0],
};

export function meshBounds(mesh: TriangleMeshData): MeshBounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[offset + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return {
    min,
    max,
    size: [
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
    ],
  };
}

function rotatePoint(
  x: number,
  y: number,
  z: number,
  rotationDeg: ModelPlacement["rotationDeg"],
): [number, number, number] {
  const [rx, ry, rz] = rotationDeg.map(
    (value) => (value * Math.PI) / 180,
  );
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const x1 = x;
  const y1 = y * cosX - z * sinX;
  const z1 = y * sinX + z * cosX;
  const x2 = x1 * cosY + z1 * sinY;
  const y2 = y1;
  const z2 = -x1 * sinY + z1 * cosY;
  return [
    x2 * cosZ - y2 * sinZ,
    x2 * sinZ + y2 * cosZ,
    z2,
  ];
}

export function placeMeshOnPlate(
  mesh: TriangleMeshData,
  placement: ModelPlacement,
): TriangleMeshData {
  const sourceBounds = meshBounds(mesh);
  const center = sourceBounds.min.map(
    (value, axis) => (value + sourceBounds.max[axis]) / 2,
  );
  const positions = new Float32Array(mesh.positions.length);
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    const rotated = rotatePoint(
      mesh.positions[offset] - center[0],
      mesh.positions[offset + 1] - center[1],
      mesh.positions[offset + 2] - center[2],
      placement.rotationDeg,
    );
    positions.set(rotated, offset);
  }
  const rotatedBounds = meshBounds({ positions, indices: mesh.indices });
  const translation: [number, number, number] = [
    placement.positionMm[0] -
      (rotatedBounds.min[0] + rotatedBounds.max[0]) / 2,
    placement.positionMm[1] - rotatedBounds.min[1],
    placement.positionMm[2] -
      (rotatedBounds.min[2] + rotatedBounds.max[2]) / 2,
  ];
  for (let offset = 0; offset < positions.length; offset += 3) {
    positions[offset] += translation[0];
    positions[offset + 1] += translation[1];
    positions[offset + 2] += translation[2];
  }
  return { positions, indices: mesh.indices };
}

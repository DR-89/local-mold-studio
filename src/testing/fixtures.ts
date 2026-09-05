import type { TriangleMeshData } from "../workers/protocol";

export function indexedCube(size = 20): TriangleMeshData {
  const half = size / 2;
  const positions = new Float32Array([
    -half, -half, -half,
    half, -half, -half,
    half, half, -half,
    -half, half, -half,
    -half, -half, half,
    half, -half, half,
    half, half, half,
    -half, half, half,
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3,
    1, 2, 6, 1, 6, 5,
  ]);
  return { positions, indices };
}

export function openCube(size = 20): TriangleMeshData {
  const cube = indexedCube(size);
  return {
    positions: cube.positions,
    indices: cube.indices.slice(0, cube.indices.length - 6),
  };
}

import type { Manifold as ManifoldSolid } from "manifold-3d";
import {
  measureSolid,
  triangleMeshToManifold,
} from "../../geometry/kernel/adapter";
import { loadManifold } from "../../geometry/kernel/loader";
import { ShapeUtils, Vector2 } from "three";
import type { UpAxis } from "../../domain/mold";
import type { TriangleMeshData } from "../../workers/protocol";
import type {
  MeshDiagnostic,
  MeshImportOptions,
  MeshImportResult,
  MeshFileFormat,
  SourceUnit,
} from "./types";
import { MAX_MODEL_BYTES, MAX_MODEL_TRIANGLES, MeshImportError } from "./types";
import { detectMeshFormat, parseMeshFile } from "./parsers";

const UNIT_TO_MM: Record<Exclude<SourceUnit, "auto">, number> = {
  mm: 1,
  cm: 10,
  m: 1_000,
  inch: 25.4,
  foot: 304.8,
  micron: 0.001,
};

type EdgeOccurrence = {
  triangle: number;
  direction: 1 | -1;
};

function buildEdgeMap(triangles: Array<[number, number, number]>): Map<string, EdgeOccurrence[]> {
  const edges = new Map<string, EdgeOccurrence[]>();
  triangles.forEach(([a, b, c], triangle) => {
    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      const key = edgeKey(from, to);
      const occurrences = edges.get(key) ?? [];
      occurrences.push({ triangle, direction: from < to ? 1 : -1 });
      edges.set(key, occurrences);
    }
  });
  return edges;
}

function repairOpenBoundaries(
  positions: number[],
  triangles: Array<[number, number, number]>,
): { cappedLoops: number; cappedEdges: number; removedNonManifoldTriangles: number } {
  let edges = buildEdgeMap(triangles);
  const removedTriangles = new Set<number>();
  const affectedVertices = new Set<number>();
  for (const occurrences of edges.values()) {
    if (occurrences.length <= 2) continue;
    let keepFirst = 0;
    let keepSecond = 1;
    outer: for (let first = 0; first < occurrences.length; first += 1) {
      for (let second = first + 1; second < occurrences.length; second += 1) {
        if (occurrences[first].direction !== occurrences[second].direction) {
          keepFirst = first;
          keepSecond = second;
          break outer;
        }
      }
    }
    occurrences.forEach((occurrence, index) => {
      if (index !== keepFirst && index !== keepSecond) removedTriangles.add(occurrence.triangle);
    });
  }
  if (removedTriangles.size > 0) {
    for (const triangleIndex of removedTriangles) {
      for (const vertex of triangles[triangleIndex] ?? []) affectedVertices.add(vertex);
    }
    const retained = triangles.filter((_, index) => !removedTriangles.has(index));
    triangles.length = 0;
    for (const triangle of retained) triangles.push(triangle);
    edges = buildEdgeMap(triangles);
  }

  const outgoing = new Map<number, number[]>();
  const incomingCount = new Map<number, number>();
  for (const [key, occurrences] of edges) {
    if (occurrences.length !== 1) continue;
    const [lowText, highText] = key.split(":");
    const low = Number(lowText);
    const high = Number(highText);
    const from = occurrences[0].direction === 1 ? low : high;
    const to = occurrences[0].direction === 1 ? high : low;
    const next = outgoing.get(from) ?? [];
    next.push(to);
    outgoing.set(from, next);
    incomingCount.set(to, (incomingCount.get(to) ?? 0) + 1);
  }

  const used = new Set<string>();
  const directedKey = (from: number, to: number) => `${from}:${to}`;
  let cappedLoops = 0;
  let cappedEdges = 0;
  for (const [start, targets] of outgoing) {
    for (const firstTarget of targets) {
      if (used.has(directedKey(start, firstTarget))) continue;
      const loop = [start];
      let from = start;
      let to = firstTarget;
      let closed = false;
      for (let guard = 0; guard <= outgoing.size + 1; guard += 1) {
        used.add(directedKey(from, to));
        loop.push(to);
        if (to === start) {
          closed = true;
          loop.pop();
          break;
        }
        const nextTargets = outgoing.get(to) ?? [];
        if (nextTargets.length !== 1 || (incomingCount.get(to) ?? 0) !== 1) break;
        from = to;
        to = nextTargets[0];
        if (used.has(directedKey(from, to))) break;
      }
      if (!closed || loop.length < 3) continue;

      if (loop.some((vertex) => affectedVertices.has(vertex))) {
        const center = positions.length / 3;
        let centerX = 0;
        let centerY = 0;
        let centerZ = 0;
        for (const vertex of loop) {
          centerX += positions[vertex * 3];
          centerY += positions[vertex * 3 + 1];
          centerZ += positions[vertex * 3 + 2];
        }
        positions.push(
          centerX / loop.length,
          centerY / loop.length,
          centerZ / loop.length,
        );
        for (let index = 0; index < loop.length; index += 1) {
          triangles.push([
            loop[(index + 1) % loop.length],
            loop[index],
            center,
          ]);
        }
        cappedLoops += 1;
        cappedEdges += loop.length;
        continue;
      }

      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let index = 0; index < loop.length; index += 1) {
        const current = loop[index] * 3;
        const next = loop[(index + 1) % loop.length] * 3;
        const x1 = positions[current];
        const y1 = positions[current + 1];
        const z1 = positions[current + 2];
        const x2 = positions[next];
        const y2 = positions[next + 1];
        const z2 = positions[next + 2];
        nx += (y1 - y2) * (z1 + z2);
        ny += (z1 - z2) * (x1 + x2);
        nz += (x1 - x2) * (y1 + y2);
      }
      const dominant = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz)
        ? 0
        : Math.abs(ny) >= Math.abs(nz) ? 1 : 2;
      const contour = loop.map((vertex) => {
        const offset = vertex * 3;
        if (dominant === 0) return new Vector2(positions[offset + 1], positions[offset + 2]);
        if (dominant === 1) return new Vector2(positions[offset], positions[offset + 2]);
        return new Vector2(positions[offset], positions[offset + 1]);
      });
      const faces = ShapeUtils.triangulateShape(contour, []);
      if (faces.length === 0) continue;
      const boundaryDirections = new Set<string>();
      for (let index = 0; index < loop.length; index += 1) {
        boundaryDirections.add(directedKey(loop[index], loop[(index + 1) % loop.length]));
      }
      let sameDirection = 0;
      let oppositeDirection = 0;
      for (const face of faces) {
        const vertices = [loop[face[0]], loop[face[1]], loop[face[2]]];
        for (let edge = 0; edge < 3; edge += 1) {
          const a = vertices[edge];
          const b = vertices[(edge + 1) % 3];
          if (boundaryDirections.has(directedKey(a, b))) sameDirection += 1;
          if (boundaryDirections.has(directedKey(b, a))) oppositeDirection += 1;
        }
      }
      const flip = sameDirection > oppositeDirection;
      for (const face of faces) {
        const a = loop[face[0]];
        const b = loop[face[1]];
        const c = loop[face[2]];
        triangles.push(flip ? [a, c, b] : [a, b, c]);
      }
      cappedLoops += 1;
      cappedEdges += loop.length;
    }
  }
  edges = buildEdgeMap(triangles);
  const undirected = new Map<number, number[]>();
  for (const [key, occurrences] of edges) {
    if (occurrences.length !== 1) continue;
    const [aText, bText] = key.split(":");
    const a = Number(aText);
    const b = Number(bText);
    const fromA = undirected.get(a) ?? [];
    fromA.push(b);
    undirected.set(a, fromA);
    const fromB = undirected.get(b) ?? [];
    fromB.push(a);
    undirected.set(b, fromB);
  }
  const usedUndirected = new Set<string>();
  const undirectedKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (const [start, neighbors] of undirected) {
    for (const first of neighbors) {
      if (usedUndirected.has(undirectedKey(start, first))) continue;
      const loop = [start];
      let previous = start;
      let current = first;
      let closed = false;
      for (let guard = 0; guard <= undirected.size + 1; guard += 1) {
        usedUndirected.add(undirectedKey(previous, current));
        loop.push(current);
        if (current === start) {
          closed = true;
          loop.pop();
          break;
        }
        const next = (undirected.get(current) ?? []).find((candidate) =>
          candidate !== previous && !usedUndirected.has(undirectedKey(current, candidate))
        );
        if (next === undefined) break;
        previous = current;
        current = next;
      }
      if (!closed || loop.length < 3) continue;
      const center = positions.length / 3;
      let centerX = 0;
      let centerY = 0;
      let centerZ = 0;
      for (const vertex of loop) {
        centerX += positions[vertex * 3];
        centerY += positions[vertex * 3 + 1];
        centerZ += positions[vertex * 3 + 2];
      }
      positions.push(centerX / loop.length, centerY / loop.length, centerZ / loop.length);
      for (let index = 0; index < loop.length; index += 1) {
        triangles.push([loop[index], loop[(index + 1) % loop.length], center]);
      }
      cappedLoops += 1;
      cappedEdges += loop.length;
    }
  }

  return {
    cappedLoops,
    cappedEdges,
    removedNonManifoldTriangles: removedTriangles.size,
  };
}

function orientPoint(
  x: number,
  y: number,
  z: number,
  upAxis: UpAxis,
): [number, number, number] {
  if (upAxis === "x") return [-y, x, z];
  if (upAxis === "z") return [x, z, -y];
  return [x, y, z];
}

function edgeKey(a: number, b: number): string {
  return a < b ? a + ":" + b : b + ":" + a;
}

function signedTriangleVolume(
  positions: number[],
  a: number,
  b: number,
  c: number,
): number {
  const ax = positions[a * 3];
  const ay = positions[a * 3 + 1];
  const az = positions[a * 3 + 2];
  const bx = positions[b * 3];
  const by = positions[b * 3 + 1];
  const bz = positions[b * 3 + 2];
  const cx = positions[c * 3];
  const cy = positions[c * 3 + 1];
  const cz = positions[c * 3 + 2];
  return (
    (ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx)) /
    6
  );
}

function buildNormalizedMesh(
  raw: Float64Array,
  upAxis: UpAxis,
  scale: number,
): {
  mesh: TriangleMeshData;
  componentCount: number;
  removedDegenerateTriangles: number;
  removedDuplicateTriangles: number;
  repairedWindingTriangles: number;
  cappedBoundaryLoops: number;
  cappedBoundaryEdges: number;
  removedNonManifoldTriangles: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
} {
  if (raw.length === 0 || raw.length % 9 !== 0) {
    throw new MeshImportError(
      "EMPTY_MESH",
      "The file contains no complete triangles.",
    );
  }
  const rawTriangleCount = raw.length / 9;
  if (rawTriangleCount > MAX_MODEL_TRIANGLES) {
    throw new MeshImportError(
      "TOO_MANY_TRIANGLES",
      "The model contains too many triangles for safe browser processing.",
    );
  }

  const transformed = new Float64Array(raw.length);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let offset = 0; offset < raw.length; offset += 3) {
    const x = raw[offset];
    const y = raw[offset + 1];
    const z = raw[offset + 2];
    if (![x, y, z].every(Number.isFinite)) {
      throw new MeshImportError(
        "NON_FINITE_VERTEX",
        "The model contains invalid coordinates.",
      );
    }
    const oriented = orientPoint(x * scale, y * scale, z * scale, upAxis);
    transformed[offset] = oriented[0];
    transformed[offset + 1] = oriented[1];
    transformed[offset + 2] = oriented[2];
    minX = Math.min(minX, oriented[0]);
    minY = Math.min(minY, oriented[1]);
    minZ = Math.min(minZ, oriented[2]);
    maxX = Math.max(maxX, oriented[0]);
    maxY = Math.max(maxY, oriented[1]);
    maxZ = Math.max(maxZ, oriented[2]);
  }

  const maximumSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!Number.isFinite(maximumSpan) || maximumSpan <= 0) {
    throw new MeshImportError(
      "ZERO_VOLUME",
      "The model has no spatial extent.",
    );
  }
  const weldTolerance = Math.max(maximumSpan * 1e-7, 1e-6);
  const inverseTolerance = 1 / weldTolerance;
  const areaThresholdSquared = Math.pow(weldTolerance, 4);
  const vertexMap = new Map<string, number>();
  const positions: number[] = [];
  const triangles: Array<[number, number, number]> = [];
  const triangleKeys = new Set<string>();
  let removedDegenerateTriangles = 0;
  let removedDuplicateTriangles = 0;

  function weldVertex(offset: number): number {
    const x = transformed[offset];
    const y = transformed[offset + 1];
    const z = transformed[offset + 2];
    const key =
      Math.round(x * inverseTolerance) +
      ":" +
      Math.round(y * inverseTolerance) +
      ":" +
      Math.round(z * inverseTolerance);
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(x, y, z);
    vertexMap.set(key, index);
    return index;
  }

  for (let offset = 0; offset < transformed.length; offset += 9) {
    const a = weldVertex(offset);
    const b = weldVertex(offset + 3);
    const c = weldVertex(offset + 6);
    if (a === b || b === c || c === a) {
      removedDegenerateTriangles += 1;
      continue;
    }
    const ax = positions[a * 3];
    const ay = positions[a * 3 + 1];
    const az = positions[a * 3 + 2];
    const abx = positions[b * 3] - ax;
    const aby = positions[b * 3 + 1] - ay;
    const abz = positions[b * 3 + 2] - az;
    const acx = positions[c * 3] - ax;
    const acy = positions[c * 3 + 1] - ay;
    const acz = positions[c * 3 + 2] - az;
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    const areaSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;
    if (areaSquared <= areaThresholdSquared) {
      removedDegenerateTriangles += 1;
      continue;
    }
    const duplicateKey = [a, b, c]
      .sort((left, right) => left - right)
      .join(":");
    if (triangleKeys.has(duplicateKey)) {
      removedDuplicateTriangles += 1;
      continue;
    }
    triangleKeys.add(duplicateKey);
    triangles.push([a, b, c]);
  }

  if (triangles.length < 4) {
    throw new MeshImportError(
      "EMPTY_MESH",
      "Too few faces remain after safe cleanup.",
    );
  }

  const repair = {
    cappedLoops: 0,
    cappedEdges: 0,
    removedNonManifoldTriangles: 0,
  };
  let edges = buildEdgeMap(triangles);
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (let pass = 0; pass < 6; pass += 1) {
    const passRepair = repairOpenBoundaries(positions, triangles);
    repair.cappedLoops += passRepair.cappedLoops;
    repair.cappedEdges += passRepair.cappedEdges;
    repair.removedNonManifoldTriangles += passRepair.removedNonManifoldTriangles;
    edges = buildEdgeMap(triangles);
    boundaryEdges = 0;
    nonManifoldEdges = 0;
    for (const occurrences of edges.values()) {
      if (occurrences.length === 1) boundaryEdges += 1;
      else if (occurrences.length !== 2) nonManifoldEdges += 1;
    }
    if (boundaryEdges === 0 && nonManifoldEdges === 0) break;
    if (passRepair.cappedLoops === 0 && passRepair.removedNonManifoldTriangles === 0) break;
  }
  if (nonManifoldEdges > 0 || boundaryEdges > 0) {
    const adjacency: number[][] = Array.from(
      { length: triangles.length },
      () => [],
    );
    for (const occurrences of edges.values()) {
      const first = occurrences[0]?.triangle;
      if (first === undefined) continue;
      for (let index = 1; index < occurrences.length; index += 1) {
        const other = occurrences[index]?.triangle;
        if (other === undefined) continue;
        adjacency[first].push(other);
        adjacency[other].push(first);
      }
    }
    const visited = new Uint8Array(triangles.length);
    let componentCount = 0;
    for (let start = 0; start < triangles.length; start += 1) {
      if (visited[start]) continue;
      componentCount += 1;
      const queue = [start];
      visited[start] = 1;
      while (queue.length > 0) {
        const triangle = queue.pop();
        if (triangle === undefined) continue;
        for (const neighbor of adjacency[triangle]) {
          if (visited[neighbor]) continue;
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    return {
      mesh: {
        positions: new Float32Array(positions),
        indices: new Uint32Array(triangles.flat()),
      },
      componentCount,
      removedDegenerateTriangles,
      removedDuplicateTriangles,
      repairedWindingTriangles: 0,
      cappedBoundaryLoops: repair.cappedLoops,
      cappedBoundaryEdges: repair.cappedEdges,
      removedNonManifoldTriangles: repair.removedNonManifoldTriangles,
      boundaryEdges,
      nonManifoldEdges,
    };
  }

  const adjacency: Array<Array<{ triangle: number; flipConstraint: 0 | 1 }>> =
    Array.from({ length: triangles.length }, () => []);
  for (const occurrences of edges.values()) {
    const first = occurrences[0];
    const second = occurrences[1];
    if (!first || !second) continue;
    const flipConstraint: 0 | 1 = first.direction === second.direction ? 1 : 0;
    adjacency[first.triangle].push({
      triangle: second.triangle,
      flipConstraint,
    });
    adjacency[second.triangle].push({
      triangle: first.triangle,
      flipConstraint,
    });
  }

  const flips = new Int8Array(triangles.length).fill(-1);
  const components: number[][] = [];
  for (let start = 0; start < triangles.length; start += 1) {
    if (flips[start] !== -1) continue;
    const component: number[] = [];
    const queue = [start];
    flips[start] = 0;
    while (queue.length > 0) {
      const triangle = queue.pop();
      if (triangle === undefined) continue;
      component.push(triangle);
      for (const neighbor of adjacency[triangle]) {
        const expected = flips[triangle] ^ neighbor.flipConstraint;
        if (flips[neighbor.triangle] === -1) {
          flips[neighbor.triangle] = expected;
          queue.push(neighbor.triangle);
        } else if (flips[neighbor.triangle] !== expected) {
          throw new MeshImportError(
            "WINDING_AMBIGUOUS",
            "Surface orientation is inconsistent and cannot be repaired safely.",
          );
        }
      }
    }
    components.push(component);
  }

  let repairedWindingTriangles = 0;
  for (let triangle = 0; triangle < triangles.length; triangle += 1) {
    if (flips[triangle] === 1) {
      const value = triangles[triangle];
      triangles[triangle] = [value[0], value[2], value[1]];
      repairedWindingTriangles += 1;
    }
  }

  const volumeTolerance = Math.max(Math.pow(maximumSpan, 3) * 1e-12, 1e-9);
  for (const component of components) {
    let signedVolume = 0;
    for (const triangleIndex of component) {
      const [a, b, c] = triangles[triangleIndex];
      signedVolume += signedTriangleVolume(positions, a, b, c);
    }
    if (Math.abs(signedVolume) <= volumeTolerance) {
      throw new MeshImportError(
        "ZERO_VOLUME",
        "At least one model component has no reliable volume.",
      );
    }
    if (signedVolume < 0) {
      for (const triangleIndex of component) {
        const value = triangles[triangleIndex];
        triangles[triangleIndex] = [value[0], value[2], value[1]];
        repairedWindingTriangles += 1;
      }
    }
  }

  return {
    mesh: {
      positions: new Float32Array(positions),
      indices: new Uint32Array(triangles.flat()),
    },
    componentCount: components.length,
    removedDegenerateTriangles,
    removedDuplicateTriangles,
    repairedWindingTriangles,
    cappedBoundaryLoops: repair.cappedLoops,
    cappedBoundaryEdges: repair.cappedEdges,
    removedNonManifoldTriangles: repair.removedNonManifoldTriangles,
    boundaryEdges,
    nonManifoldEdges,
  };
}

function measurePreviewMesh(
  mesh: TriangleMeshData,
  boundaryEdges: number,
  nonManifoldEdges: number,
) {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = mesh.positions[offset + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  let surfaceAreaMm2 = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset] * 3;
    const b = mesh.indices[offset + 1] * 3;
    const c = mesh.indices[offset + 2] * 3;
    const abx = mesh.positions[b] - mesh.positions[a];
    const aby = mesh.positions[b + 1] - mesh.positions[a + 1];
    const abz = mesh.positions[b + 2] - mesh.positions[a + 2];
    const acx = mesh.positions[c] - mesh.positions[a];
    const acy = mesh.positions[c + 1] - mesh.positions[a + 1];
    const acz = mesh.positions[c + 2] - mesh.positions[a + 2];
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    surfaceAreaMm2 += Math.sqrt(
      crossX * crossX + crossY * crossY + crossZ * crossZ,
    ) / 2;
  }
  return {
    bounds: { min, max },
    triangles: mesh.indices.length / 3,
    vertices: mesh.positions.length / 3,
    volumeMm3: 0,
    surfaceAreaMm2,
    boundaryEdges,
    nonManifoldEdges,
  };
}

export async function importAndNormalizeMesh(
  data: ArrayBuffer,
  options: MeshImportOptions,
  isCancelled: () => boolean = () => false,
  onPreparedSolid?: (solid: ManifoldSolid) => void,
): Promise<MeshImportResult> {
  if (data.byteLength > MAX_MODEL_BYTES) {
    throw new MeshImportError(
      "FILE_TOO_LARGE",
      "The file exceeds the local 100 MB limit.",
    );
  }
  if (isCancelled())
    throw new MeshImportError("CANCELLED", "Import cancelled.");

  const format: MeshFileFormat = detectMeshFormat(options.fileName);
  const parsed = parseMeshFile(data, format);
  if (isCancelled())
    throw new MeshImportError("CANCELLED", "Import cancelled.");

  const requestedUnit = options.sourceUnit ?? "auto";
  const resolvedUnit =
    requestedUnit === "auto" ? (parsed.sourceUnit ?? "mm") : requestedUnit;
  const scale = (UNIT_TO_MM[resolvedUnit] * options.scalePercent) / 100;
  const rawGroups = parsed.triangleGroups ??
    (parsed.trianglePositions ? [parsed.trianglePositions] : []);
  if (rawGroups.length === 0) {
    throw new MeshImportError("EMPTY_MESH", "The file contains no complete triangles.");
  }
  const totalTriangles = rawGroups.reduce((sum, group) => sum + group.length / 9, 0);
  if (totalTriangles > MAX_MODEL_TRIANGLES) {
    throw new MeshImportError(
      "TOO_MANY_TRIANGLES",
      "The model contains too many triangles for safe browser processing.",
    );
  }
  const normalizedGroups = rawGroups.map((group) =>
    buildNormalizedMesh(group, options.upAxis, scale)
  );
  const positionLength = normalizedGroups.reduce(
    (sum, group) => sum + group.mesh.positions.length,
    0,
  );
  const indexLength = normalizedGroups.reduce(
    (sum, group) => sum + group.mesh.indices.length,
    0,
  );
  const combinedPositions = new Float32Array(positionLength);
  const combinedIndices = new Uint32Array(indexLength);
  let positionOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;
  for (const group of normalizedGroups) {
    combinedPositions.set(group.mesh.positions, positionOffset);
    for (let index = 0; index < group.mesh.indices.length; index += 1) {
      combinedIndices[indexOffset + index] = group.mesh.indices[index] + vertexOffset;
    }
    positionOffset += group.mesh.positions.length;
    indexOffset += group.mesh.indices.length;
    vertexOffset += group.mesh.positions.length / 3;
  }
  const normalized = {
    mesh: { positions: combinedPositions, indices: combinedIndices },
    componentCount: normalizedGroups.reduce((sum, group) => sum + group.componentCount, 0),
    removedDegenerateTriangles: normalizedGroups.reduce(
      (sum, group) => sum + group.removedDegenerateTriangles,
      0,
    ),
    removedDuplicateTriangles: normalizedGroups.reduce(
      (sum, group) => sum + group.removedDuplicateTriangles,
      0,
    ),
    repairedWindingTriangles: normalizedGroups.reduce(
      (sum, group) => sum + group.repairedWindingTriangles,
      0,
    ),
    cappedBoundaryLoops: normalizedGroups.reduce(
      (sum, group) => sum + group.cappedBoundaryLoops,
      0,
    ),
    cappedBoundaryEdges: normalizedGroups.reduce(
      (sum, group) => sum + group.cappedBoundaryEdges,
      0,
    ),
    removedNonManifoldTriangles: normalizedGroups.reduce(
      (sum, group) => sum + group.removedNonManifoldTriangles,
      0,
    ),
    boundaryEdges: normalizedGroups.reduce((sum, group) => sum + group.boundaryEdges, 0),
    nonManifoldEdges: normalizedGroups.reduce(
      (sum, group) => sum + group.nonManifoldEdges,
      0,
    ),
  };
  if (isCancelled())
    throw new MeshImportError("CANCELLED", "Import cancelled.");

  const moldReady =
    normalized.boundaryEdges === 0 && normalized.nonManifoldEdges === 0;
  let measured: ReturnType<typeof measurePreviewMesh>;
  if (moldReady) {
    const kernel = await loadManifold();
    let solid;
    try {
      solid = triangleMeshToManifold(kernel, normalized.mesh);
    } catch (error) {
      throw new MeshImportError(
        "NON_MANIFOLD",
        "The repaired solid is not recognized as closed by the geometry kernel.",
        error instanceof Error ? error.message : String(error),
      );
    }
    measured = measureSolid(solid);
    if (onPreparedSolid) onPreparedSolid(solid);
    else solid.delete();
  } else {
    measured = measurePreviewMesh(
      normalized.mesh,
      normalized.boundaryEdges,
      normalized.nonManifoldEdges,
    );
  }

  const diagnostics: MeshDiagnostic[] = [];
  diagnostics.push(
    parsed.sourceUnit && requestedUnit === "auto"
      ? {
          code: "UNIT_FROM_3MF",
          severity: "info",
          message:
            "The unit was taken from the 3MF and converted to millimeters.",
        }
      : {
          code: "UNIT_ASSUMED_MM",
          severity: "info",
          message:
            requestedUnit === "auto"
              ? "The format has no reliable unit; millimeters were assumed."
              : "The selected source-file unit was converted to millimeters.",
        },
  );
  if (normalized.removedDegenerateTriangles > 0) {
    diagnostics.push({
      code: "DEGENERATE_TRIANGLES_REMOVED",
      severity: "warning",
      message:
        "Degenerate triangles were removed without changing the surface.",
      count: normalized.removedDegenerateTriangles,
    });
  }
  if (normalized.removedDuplicateTriangles > 0) {
    diagnostics.push({
      code: "DUPLICATE_TRIANGLES_REMOVED",
      severity: "warning",
      message: "Exact duplicate triangles were removed.",
      count: normalized.removedDuplicateTriangles,
    });
  }
  if (normalized.repairedWindingTriangles > 0) {
    diagnostics.push({
      code: "WINDING_REPAIRED",
      severity: "warning",
      message:
        "Unambiguous surface orientations were made consistent.",
      count: normalized.repairedWindingTriangles,
    });
  }
  if (normalized.cappedBoundaryLoops > 0) {
    diagnostics.push({
      code: "BOUNDARY_LOOPS_CAPPED",
      severity: "warning",
      message:
        "Open component boundaries were closed locally; every original component was preserved.",
      count: normalized.cappedBoundaryLoops,
    });
  }
  if (normalized.removedNonManifoldTriangles > 0) {
    diagnostics.push({
      code: "NON_MANIFOLD_FACES_REMOVED",
      severity: "warning",
      message:
        "Conflicting excess faces were removed before their boundaries were closed.",
      count: normalized.removedNonManifoldTriangles,
    });
  }
  if (normalized.boundaryEdges > 0) {
    diagnostics.push({
      code: "OPEN_EDGES",
      severity: "warning",
      message:
        "Preview is available, but the model has open edges. Mold generation remains blocked until it is repaired.",
      count: normalized.boundaryEdges,
    });
  }
  if (normalized.nonManifoldEdges > 0) {
    diagnostics.push({
      code: "NON_MANIFOLD_EDGES",
      severity: "warning",
      message:
        "Preview is available, but some edges belong to more than two faces. Mold generation remains blocked until it is repaired.",
      count: normalized.nonManifoldEdges,
    });
  }

  if (normalized.componentCount > 1) {
    diagnostics.push({
      code: "MULTIPLE_COMPONENTS",
      severity: "warning",
      message:
        "The model contains multiple closed components; none was removed silently.",
      count: normalized.componentCount,
    });
  }
  const size: [number, number, number] = [
    measured.bounds.max[0] - measured.bounds.min[0],
    measured.bounds.max[1] - measured.bounds.min[1],
    measured.bounds.max[2] - measured.bounds.min[2],
  ];
  if (Math.max(...size) < 40) {
    diagnostics.push({
      code: "MODEL_SMALL",
      severity: "warning",
      message:
        "The model is smaller than 40 mm. Check the scale; it can be adjusted before mold generation.",
    });
  }
  if (Math.min(...size) < 4) {
    diagnostics.push({
      code: "MODEL_THIN",
      severity: "warning",
      message: "At least one model dimension is below 4 mm.",
    });
  }

  return {
    kind: "mesh-import",
    format,
    fileName: options.fileName,
    moldReady,
    mesh: normalized.mesh,
    measurements: {
      bounds: {
        min: measured.bounds.min,
        max: measured.bounds.max,
        size,
      },
      triangles: measured.triangles,
      vertices: measured.vertices,
      volumeMm3: measured.volumeMm3,
      surfaceAreaMm2: measured.surfaceAreaMm2,
      componentCount: normalized.componentCount,
      boundaryEdges: measured.boundaryEdges,
      nonManifoldEdges: measured.nonManifoldEdges,
      removedDegenerateTriangles: normalized.removedDegenerateTriangles,
      removedDuplicateTriangles: normalized.removedDuplicateTriangles,
      repairedWindingTriangles: normalized.repairedWindingTriangles,
      cappedBoundaryLoops: normalized.cappedBoundaryLoops,
      cappedBoundaryEdges: normalized.cappedBoundaryEdges,
      removedNonManifoldTriangles: normalized.removedNonManifoldTriangles,
    },
    diagnostics,
  };
}

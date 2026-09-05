import type {
  Manifold as ManifoldSolid,
  ManifoldToplevel,
} from "manifold-3d";
import type { TriangleMeshData } from "../../workers/protocol";
import { loadManifold } from "./loader";

export type MeshTopology = {
  triangles: number;
  vertices: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  closed: boolean;
};

export type SolidMetrics = MeshTopology & {
  volumeMm3: number;
  surfaceAreaMm2: number;
  genus: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
};

export type SplitResult = {
  positive: TriangleMeshData;
  negative: TriangleMeshData;
  positiveMetrics: SolidMetrics;
  negativeMetrics: SolidMetrics;
};

export class KernelMeshError extends Error {
  constructor(
    message: string,
    readonly code:
      | "EMPTY_MESH"
      | "INVALID_POSITION_LENGTH"
      | "INVALID_INDEX_LENGTH"
      | "NON_FINITE_VERTEX"
      | "INDEX_OUT_OF_BOUNDS"
      | "NOT_MANIFOLD",
  ) {
    super(message);
    this.name = "KernelMeshError";
  }
}

export function validateTriangleMesh(mesh: TriangleMeshData): void {
  if (mesh.positions.length === 0 || mesh.indices.length === 0) {
    throw new KernelMeshError("Mesh must contain vertices and triangles.", "EMPTY_MESH");
  }
  if (mesh.positions.length % 3 !== 0) {
    throw new KernelMeshError(
      "Position array length must be divisible by three.",
      "INVALID_POSITION_LENGTH",
    );
  }
  if (mesh.indices.length % 3 !== 0) {
    throw new KernelMeshError(
      "Index array length must be divisible by three.",
      "INVALID_INDEX_LENGTH",
    );
  }
  for (const value of mesh.positions) {
    if (!Number.isFinite(value)) {
      throw new KernelMeshError("Mesh contains a non-finite vertex.", "NON_FINITE_VERTEX");
    }
  }
  const vertexCount = mesh.positions.length / 3;
  for (const index of mesh.indices) {
    if (index >= vertexCount) {
      throw new KernelMeshError(
        `Triangle index ${index} exceeds vertex count ${vertexCount}.`,
        "INDEX_OUT_OF_BOUNDS",
      );
    }
  }
}

export function meshTopology(mesh: TriangleMeshData): MeshTopology {
  validateTriangleMesh(mesh);
  const edgeCounts = new Map<string, number>();
  for (let triangle = 0; triangle < mesh.indices.length; triangle += 3) {
    const a = mesh.indices[triangle];
    const b = mesh.indices[triangle + 1];
    const c = mesh.indices[triangle + 2];
    if (a === undefined || b === undefined || c === undefined) continue;
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdges += 1;
    else if (count !== 2) nonManifoldEdges += 1;
  }
  return {
    triangles: mesh.indices.length / 3,
    vertices: mesh.positions.length / 3,
    boundaryEdges,
    nonManifoldEdges,
    closed: boundaryEdges === 0 && nonManifoldEdges === 0,
  };
}

/**
 * Separates a mesh into its connected bodies. Runs in one pass over the
 * triangles per stage, so it stays usable on parts with hundreds of thousands
 * of faces. A mesh that is already a single body is returned untouched and
 * without any copying.
 */
export function splitMeshIntoConnectedComponents(
  mesh: TriangleMeshData,
): TriangleMeshData[] {
  validateTriangleMesh(mesh);
  const triangleCount = mesh.indices.length / 3;
  const vertexCount = mesh.positions.length / 3;
  const parent = new Uint32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) parent[vertex] = vertex;
  const find = (vertex: number): number => {
    let root = vertex;
    while (parent[root] !== root) root = parent[root];
    let current = vertex;
    while (parent[current] !== root) {
      const next = parent[current];
      parent[current] = root;
      current = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (leftRoot < rightRoot) parent[rightRoot] = leftRoot;
    else parent[leftRoot] = rightRoot;
  };
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    union(mesh.indices[offset] ?? 0, mesh.indices[offset + 1] ?? 0);
    union(mesh.indices[offset + 1] ?? 0, mesh.indices[offset + 2] ?? 0);
  }

  const componentOfRoot = new Map<number, number>();
  const triangleComponents = new Uint32Array(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = find(mesh.indices[triangle * 3] ?? 0);
    let component = componentOfRoot.get(root);
    if (component === undefined) {
      component = componentOfRoot.size;
      componentOfRoot.set(root, component);
    }
    triangleComponents[triangle] = component;
  }
  const componentCount = componentOfRoot.size;
  if (componentCount <= 1) return [mesh];

  const componentTriangles = new Uint32Array(componentCount);
  const componentVertices = new Uint32Array(componentCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const component = triangleComponents[triangle]!;
    componentTriangles[component] = componentTriangles[component]! + 1;
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const component = componentOfRoot.get(find(vertex));
    if (component !== undefined) componentVertices[component] = componentVertices[component]! + 1;
  }

  const components: TriangleMeshData[] = [];
  const positionCursors = new Uint32Array(componentCount);
  const indexCursors = new Uint32Array(componentCount);
  for (let component = 0; component < componentCount; component += 1) {
    components.push({
      positions: new Float32Array(componentVertices[component]! * 3),
      indices: new Uint32Array(componentTriangles[component]! * 3),
    });
  }
  // -1 marks a vertex that has not been copied into its component yet.
  const remapped = new Int32Array(vertexCount).fill(-1);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const component = triangleComponents[triangle]!;
    const target = components[component]!;
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = mesh.indices[triangle * 3 + corner] ?? 0;
      let index = remapped[vertex]!;
      if (index === -1) {
        const cursor = positionCursors[component]!;
        index = cursor / 3;
        target.positions[cursor] = mesh.positions[vertex * 3] ?? 0;
        target.positions[cursor + 1] = mesh.positions[vertex * 3 + 1] ?? 0;
        target.positions[cursor + 2] = mesh.positions[vertex * 3 + 2] ?? 0;
        positionCursors[component] = cursor + 3;
        remapped[vertex] = index;
      }
      const indexCursor = indexCursors[component]!;
      target.indices[indexCursor] = index;
      indexCursors[component] = indexCursor + 1;
    }
  }
  return components;
}

export function triangleMeshToManifold(
  kernel: ManifoldToplevel,
  mesh: TriangleMeshData,
): ManifoldSolid {
  validateTriangleMesh(mesh);
  try {
    const solid = new kernel.Manifold(
      new kernel.Mesh({
        numProp: 3,
        vertProperties: new Float32Array(mesh.positions),
        triVerts: new Uint32Array(mesh.indices),
      }),
    );
    const status = solid.status();
    if (status !== "NoError") {
      solid.delete();
      throw new KernelMeshError(
        `Mesh is not an oriented 2-manifold (${status}).`,
        "NOT_MANIFOLD",
      );
    }
    return solid;
  } catch (error) {
    throw new KernelMeshError(
      error instanceof Error ? error.message : "Mesh is not an oriented 2-manifold.",
      "NOT_MANIFOLD",
    );
  }
}

export function manifoldToTriangleMesh(solid: ManifoldSolid): TriangleMeshData {
  const mesh = solid.getMesh();
  const positions = new Float32Array(mesh.numVert * 3);
  for (let vertex = 0; vertex < mesh.numVert; vertex += 1) {
    const sourceOffset = vertex * mesh.numProp;
    const targetOffset = vertex * 3;
    positions[targetOffset] = mesh.vertProperties[sourceOffset] ?? 0;
    positions[targetOffset + 1] = mesh.vertProperties[sourceOffset + 1] ?? 0;
    positions[targetOffset + 2] = mesh.vertProperties[sourceOffset + 2] ?? 0;
  }
  return {
    positions,
    indices: new Uint32Array(mesh.triVerts),
  };
}

export function measureSolid(solid: ManifoldSolid): SolidMetrics {
  const mesh = manifoldToTriangleMesh(solid);
  const topology = meshTopology(mesh);
  const bounds = solid.boundingBox();
  return {
    ...topology,
    volumeMm3: solid.volume(),
    surfaceAreaMm2: solid.surfaceArea(),
    genus: solid.genus(),
    bounds: {
      min: [...bounds.min] as [number, number, number],
      max: [...bounds.max] as [number, number, number],
    },
  };
}

export async function splitTriangleMeshByPlane(
  mesh: TriangleMeshData,
  normal: [number, number, number] = [1, 0, 0],
  originOffset = 0,
): Promise<SplitResult> {
  const kernel = await loadManifold();
  const source = triangleMeshToManifold(kernel, mesh);
  const [positive, negative] = source.splitByPlane(normal, originOffset);
  try {
    if (positive.isEmpty() || negative.isEmpty()) {
      throw new KernelMeshError(
        "Split plane produced an empty half.",
        "NOT_MANIFOLD",
      );
    }
    return {
      positive: manifoldToTriangleMesh(positive),
      negative: manifoldToTriangleMesh(negative),
      positiveMetrics: measureSolid(positive),
      negativeMetrics: measureSolid(negative),
    };
  } finally {
    source.delete();
    positive.delete();
    negative.delete();
  }
}

export type MultiSplitPart = {
  mesh: TriangleMeshData;
  metrics: SolidMetrics;
};

export async function splitTriangleMeshIntoSegments(
  mesh: TriangleMeshData,
  normal: [number, number, number],
  planeOffsets: number[],
): Promise<MultiSplitPart[]> {
  const orderedOffsets = [...planeOffsets].sort((a, b) => a - b);
  if (orderedOffsets.length < 1 || orderedOffsets.length > 15) {
    throw new KernelMeshError("One to fifteen split planes are required.", "NOT_MANIFOLD");
  }
  if (orderedOffsets.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= orderedOffsets[index - 1]))) {
    throw new KernelMeshError("Split planes must be finite and strictly increasing.", "NOT_MANIFOLD");
  }

  const kernel = await loadManifold();
  let remainder = triangleMeshToManifold(kernel, mesh);
  const segments: ManifoldSolid[] = [];
  try {
    for (const offset of orderedOffsets) {
      const [positive, negative] = remainder.splitByPlane(normal, offset);
      remainder.delete();
      if (positive.isEmpty() || negative.isEmpty()) {
        positive.delete();
        negative.delete();
        throw new KernelMeshError("A split plane produced an empty segment.", "NOT_MANIFOLD");
      }
      segments.push(negative);
      remainder = positive;
    }
    segments.push(remainder);
    remainder = null as unknown as ManifoldSolid;
    return segments.map((solid) => ({
      mesh: manifoldToTriangleMesh(solid),
      metrics: measureSolid(solid),
    }));
  } finally {
    if (remainder) remainder.delete();
    for (const segment of segments) segment.delete();
  }
}

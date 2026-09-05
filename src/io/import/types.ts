import type { UpAxis } from "../../domain/mold";
import type { TriangleMeshData } from "../../workers/protocol";

export const MAX_MODEL_BYTES = 100 * 1024 * 1024;
export const MAX_MODEL_TRIANGLES = 5_000_000;

export type MeshFileFormat = "stl" | "obj" | "3mf";
export type SourceUnit =
  "auto" | "mm" | "cm" | "m" | "inch" | "foot" | "micron";

export type MeshImportErrorCode =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "PARSE_FAILED"
  | "EMPTY_MESH"
  | "TOO_MANY_TRIANGLES"
  | "NON_FINITE_VERTEX"
  | "OPEN_MESH"
  | "NON_MANIFOLD"
  | "WINDING_AMBIGUOUS"
  | "ZERO_VOLUME"
  | "CANCELLED";

export type MeshDiagnosticCode =
  | "UNIT_ASSUMED_MM"
  | "UNIT_FROM_3MF"
  | "DEGENERATE_TRIANGLES_REMOVED"
  | "DUPLICATE_TRIANGLES_REMOVED"
  | "WINDING_REPAIRED"
  | "MULTIPLE_COMPONENTS"
  | "OPEN_EDGES"
  | "NON_MANIFOLD_EDGES"
  | "MODEL_THIN"
  | "MODEL_SMALL";

export type MeshDiagnostic = {
  code: MeshDiagnosticCode;
  severity: "info" | "warning";
  message: string;
  count?: number;
};

export type MeshImportOptions = {
  fileName: string;
  mimeType?: string;
  upAxis: UpAxis;
  scalePercent: number;
  sourceUnit?: SourceUnit;
};

export type MeshBounds = {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
};

export type MeshMeasurements = {
  bounds: MeshBounds;
  triangles: number;
  vertices: number;
  volumeMm3: number;
  surfaceAreaMm2: number;
  componentCount: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  removedDegenerateTriangles: number;
  removedDuplicateTriangles: number;
  repairedWindingTriangles: number;
};

export type MeshImportResult = {
  kind: "mesh-import";
  sourceCacheKey?: string;
  format: MeshFileFormat;
  fileName: string;
  moldReady: boolean;
  mesh: TriangleMeshData;
  measurements: MeshMeasurements;
  diagnostics: MeshDiagnostic[];
};

export class MeshImportError extends Error {
  constructor(
    readonly code: MeshImportErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "MeshImportError";
  }
}

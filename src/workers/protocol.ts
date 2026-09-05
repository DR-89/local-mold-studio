import type { TwoPartMoldParams } from "../domain/mold";
import type { ModelPlacement } from "../domain/placement";
import type { PressMoldParams } from "../domain/press-mold";
import type { ModelSplitterParams } from "../domain/model-splitter";
import type {
  MoldGenerationErrorCode,
  MoldGenerationResult,
} from "../geometry/mold/types";
import type { PressMoldGenerationResult } from "../geometry/press-mold/types";
import type {
  ModelSplitterErrorCode,
  ModelSplitterGenerationResult,
} from "../geometry/model-splitter/types";
import type {
  MeshImportErrorCode,
  MeshImportOptions,
  MeshImportResult,
} from "../io/import/types";
import type {
  MoldExportErrorCode,
  MoldExportResult,
  PressMoldExportResult,
  ModelSplitterExportResult,
} from "../io/export/types";

export const WORKER_PROTOCOL_VERSION = 57 as const;

export type TriangleMeshData = {
  positions: Float32Array;
  indices: Uint32Array;
};

export type WorkerStage =
  | "queued"
  | "initializing"
  | "parsing"
  | "normalizing"
  | "repairing"
  | "validating"
  | "boolean"
  | "measuring"
  | "shell"
  | "cavity"
  | "channels"
  | "registration"
  | "exterior"
  | "orienting"
  | "exporting"
  | "complete";

export type WorkerErrorCode =
  | MeshImportErrorCode
  | MoldGenerationErrorCode
  | MoldExportErrorCode
  | ModelSplitterErrorCode
  | "INVALID_MESSAGE"
  | "INVALID_MESH"
  | "KERNEL_INIT_FAILED"
  | "KERNEL_OPERATION_FAILED"
  | "MEMORY_BUDGET_EXCEEDED"
  | "FEATURE_NOT_IMPLEMENTED";

export type KernelSelfTestRequest = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "kernel.self-test";
  jobId: string;
};

export type MeshImportRequest = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "mesh.import";
  jobId: string;
  data: ArrayBuffer;
  options: MeshImportOptions;
};

export type GenerateMoldRequest = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "mold.generate";
  jobId: string;
  mesh: TriangleMeshData;
  params: TwoPartMoldParams;
  sourceCacheKey?: string;
  placement?: ModelPlacement;
};

export type ExportMoldRequest = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "mold.export";
  jobId: string;
  sourceResultJobId: string;
  expectedResultJobId: string;
  baseName: string;
  result: MoldGenerationResult;
};

export type GeneratePressMoldRequest = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "press.generate";
  jobId: string;
  mesh: TriangleMeshData;
  params: PressMoldParams;
};

export type ExportPressMoldRequest = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "press.export";
  jobId: string;
  sourceResultJobId: string;
  expectedResultJobId: string;
  baseName: string;
  result: PressMoldGenerationResult;
};

export type GenerateModelSplitterRequest = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "splitter.generate";
  jobId: string;
  mesh: TriangleMeshData;
  params: ModelSplitterParams;
};

export type ExportModelSplitterRequest = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "splitter.export";
  jobId: string;
  sourceResultJobId: string;
  expectedResultJobId: string;
  baseName: string;
  result: ModelSplitterGenerationResult;
};

export type CancelJobRequest = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "job.cancel";
  jobId: string;
};

export type WorkerRequest =
  | KernelSelfTestRequest
  | MeshImportRequest
  | GenerateMoldRequest
  | ExportMoldRequest
  | GeneratePressMoldRequest
  | ExportPressMoldRequest
  | GenerateModelSplitterRequest
  | ExportModelSplitterRequest
  | CancelJobRequest;

export type KernelMetric = {
  name: string;
  triangles: number;
  volumeMm3: number;
  closed: boolean;
  durationMs: number;
};

export type KernelSelfTestResult = {
  kind: "kernel-self-test";
  kernel: string;
  version: string;
  totalDurationMs: number;
  metrics: KernelMetric[];
};

export type WorkerProgressResponse = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "job.progress";
  jobId: string;
  stage: WorkerStage;
  progress: number;
  message: string;
};

export type WorkerSuccessResponse = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "job.success";
  jobId: string;
  result:
    | KernelSelfTestResult
    | MeshImportResult
    | MoldGenerationResult
    | MoldExportResult
    | PressMoldGenerationResult
    | PressMoldExportResult
    | ModelSplitterGenerationResult
    | ModelSplitterExportResult;
};

export type WorkerErrorResponse = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "job.error";
  jobId: string;
  error: {
    code: WorkerErrorCode;
    message: string;
    detail?: string;
  };
};

export type WorkerCancelledResponse = {
  version: typeof WORKER_PROTOCOL_VERSION;
  type: "job.cancelled";
  jobId: string;
};

export type WorkerResponse =
  | WorkerProgressResponse
  | WorkerSuccessResponse
  | WorkerErrorResponse
  | WorkerCancelledResponse;

export function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === WORKER_PROTOCOL_VERSION &&
    typeof candidate.type === "string" &&
    typeof candidate.jobId === "string"
  );
}

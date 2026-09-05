import type { Manifold as ManifoldSolid } from "manifold-3d";
import { runKernelSelfTest } from "../geometry/kernel/self-test";
import { loadManifold } from "../geometry/kernel/loader";
import {
  measureSolid,
  triangleMeshToManifold,
} from "../geometry/kernel/adapter";
import {
  generateTwoPartMold,
  MoldGenerationError,
  transformPreparedSourceForPlacement,
} from "../geometry/mold";
import { generatePressMold } from "../geometry/press-mold";
import { generateModelSplitter, ModelSplitterError } from "../geometry/model-splitter";
import { calculateMeshBounds } from "../geometry/mold/placement";
import { planSplitGrid } from "../geometry/model-splitter/planner";
import { modelSplitterConnectorPolicy } from "../domain/model-splitter";
import { importAndNormalizeMesh, MeshImportError } from "../io/import";
import {
  buildMoldExportPackage,
  buildPressMoldExportPackage,
  buildModelSplitterExportPackage,
  MoldExportError,
} from "../io/export";
import {
  WORKER_PROTOCOL_VERSION,
  type KernelSelfTestRequest,
  type MeshImportRequest,
  type GenerateMoldRequest,
  type ExportMoldRequest,
  type GeneratePressMoldRequest,
  type ExportPressMoldRequest,
  type GenerateModelSplitterRequest,
  type ExportModelSplitterRequest,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";
import { detectRuntimeCapabilities, estimateModelSplitterMemory, estimateMoldMemory } from "./orchestration";

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
};

const scope = self as unknown as WorkerScope;
const cancelledJobs = new Set<string>();
let activeJobId: string | null = null;
let cachedPreparedSource: ManifoldSolid | null = null;
let cachedPreparedSourceKey: string | null = null;

function clearPreparedSourceCache(): void {
  cachedPreparedSource?.delete();
  cachedPreparedSource = null;
  cachedPreparedSourceKey = null;
}

function beginJob(jobId: string): void {
  if (activeJobId && activeJobId !== jobId) cancelledJobs.add(activeJobId);
  activeJobId = jobId;
}

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  if (message.type !== "job.progress") {
    cancelledJobs.delete(message.jobId);
    if (activeJobId === message.jobId) activeJobId = null;
  }
  scope.postMessage(message, transfer);
}

function progress(
  jobId: string,
  stage: "parsing" | "normalizing" | "repairing" | "validating",
  value: number,
  message: string,
): void {
  post({
    version: WORKER_PROTOCOL_VERSION,
    type: "job.progress",
    jobId,
    stage,
    progress: value,
    message,
  });
}

async function runImport(request: MeshImportRequest): Promise<void> {
  let retainedSolid: ManifoldSolid | null = null;
  clearPreparedSourceCache();
  try {
    progress(request.jobId, "parsing", 0.12, "Reading file locally");
    await new Promise((resolve) => setTimeout(resolve, 0));
    progress(
      request.jobId,
      "normalizing",
      0.35,
      "Normalizing unit and axis",
    );
    const result = await importAndNormalizeMesh(
      request.data,
      request.options,
      () => cancelledJobs.has(request.jobId),
      (solid) => {
        retainedSolid = solid;
      },
    );
    progress(
      request.jobId,
      "validating",
      0.92,
      "Measuring closed solid",
    );
    if (cancelledJobs.has(request.jobId)) {
      retainedSolid?.delete();
      retainedSolid = null;
      cancelledJobs.delete(request.jobId);
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.cancelled",
        jobId: request.jobId,
      });
      return;
    }
    const sourceCacheKey = retainedSolid ? request.jobId : undefined;
    if (retainedSolid) {
      cachedPreparedSource = retainedSolid;
      cachedPreparedSourceKey = request.jobId;
      retainedSolid = null;
    }
    const resultWithCache = { ...result, sourceCacheKey };
    post(
      {
        version: WORKER_PROTOCOL_VERSION,
        type: "job.success",
        jobId: request.jobId,
        result: resultWithCache,
      },
      [result.mesh.positions.buffer, result.mesh.indices.buffer],
    );
  } catch (error) {
    retainedSolid?.delete();
    retainedSolid = null;
    const cancelled =
      cancelledJobs.has(request.jobId) ||
      (error instanceof MeshImportError && error.code === "CANCELLED");
    cancelledJobs.delete(request.jobId);
    if (cancelled) {
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.cancelled",
        jobId: request.jobId,
      });
      return;
    }
    const importError =
      error instanceof MeshImportError
        ? error
        : new MeshImportError(
            "PARSE_FAILED",
            "The model could not be imported locally.",
            error instanceof Error ? error.message : String(error),
          );
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: request.jobId,
      error: {
        code: importError.code,
        message: importError.message,
        detail: importError.detail,
      },
    });
  }
}

async function runMold(request: GenerateMoldRequest): Promise<void> {
  try {
    const memory = estimateMoldMemory(
      request.mesh,
      detectRuntimeCapabilities(),
    );
    if (!memory.allowed) {
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.error",
        jobId: request.jobId,
        error: {
          code: "MEMORY_BUDGET_EXCEEDED",
          message: memory.reason ?? "Local memory budget exceeded.",
          detail: String(memory.estimatedPeakBytes),
        },
      });
      return;
    }
    const reusableSource =
      request.sourceCacheKey === cachedPreparedSourceKey &&
      request.placement &&
      cachedPreparedSource
        ? cachedPreparedSource
        : null;
    const result = await generateTwoPartMold(request.mesh, request.params, {
      isCancelled: () => cancelledJobs.has(request.jobId),
      preparedSourceFactory: reusableSource && request.placement
        ? () => transformPreparedSourceForPlacement(reusableSource, request.placement!)
        : undefined,
      onProgress: ({ stage, progress: value, message }) => {
        post({
          version: WORKER_PROTOCOL_VERSION,
          type: "job.progress",
          jobId: request.jobId,
          stage,
          progress: value,
          message,
        });
      },
    });
    if (cancelledJobs.has(request.jobId)) {
      cancelledJobs.delete(request.jobId);
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.cancelled",
        jobId: request.jobId,
      });
      return;
    }
    const transferBuffers = new Set<ArrayBuffer>();
    for (const mesh of [result.front, result.back, ...result.parts.map((part) => part.mesh)]) {
      transferBuffers.add(mesh.positions.buffer);
      transferBuffers.add(mesh.indices.buffer);
    }
    post(
      {
        version: WORKER_PROTOCOL_VERSION,
        type: "job.success",
        jobId: request.jobId,
        result,
      },
      [...transferBuffers],
    );
  } catch (error) {
    const cancelled =
      cancelledJobs.has(request.jobId) ||
      (error instanceof MoldGenerationError && error.code === "CANCELLED");
    cancelledJobs.delete(request.jobId);
    if (cancelled) {
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.cancelled",
        jobId: request.jobId,
      });
      return;
    }
    const moldError =
      error instanceof MoldGenerationError
        ? error
        : new MoldGenerationError(
            "MOLD_KERNEL_FAILED",
            "The two-part mold could not be generated locally.",
            "source",
            undefined,
            error instanceof Error ? error.message : String(error),
          );
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: request.jobId,
      error: {
        code: moldError.code,
        message: moldError.message,
        detail: [moldError.feature, moldError.featureId, moldError.detail]
          .filter(Boolean)
          .join(": "),
      },
    });
  }
}
async function runPressMold(request: GeneratePressMoldRequest): Promise<void> {
  try {
    const memory = estimateMoldMemory(request.mesh, detectRuntimeCapabilities());
    if (!memory.allowed) {
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.error",
        jobId: request.jobId,
        error: {
          code: "MEMORY_BUDGET_EXCEEDED",
          message: memory.reason ?? "Local memory budget exceeded.",
          detail: String(memory.estimatedPeakBytes),
        },
      });
      return;
    }
    const result = await generatePressMold(request.mesh, request.params, {
      isCancelled: () => cancelledJobs.has(request.jobId),
      onProgress: ({ stage, progress: value, message }) => {
        post({
          version: WORKER_PROTOCOL_VERSION,
          type: "job.progress",
          jobId: request.jobId,
          stage,
          progress: value,
          message,
        });
      },
    });
    if (cancelledJobs.has(request.jobId)) {
      cancelledJobs.delete(request.jobId);
      post({ version: WORKER_PROTOCOL_VERSION, type: "job.cancelled", jobId: request.jobId });
      return;
    }
    post(
      { version: WORKER_PROTOCOL_VERSION, type: "job.success", jobId: request.jobId, result },
      [
        result.die.positions.buffer,
        result.die.indices.buffer,
        result.piston.positions.buffer,
        result.piston.indices.buffer,
      ],
    );
  } catch (error) {
    const cancelled = cancelledJobs.has(request.jobId) ||
      (error instanceof MoldGenerationError && error.code === "CANCELLED");
    cancelledJobs.delete(request.jobId);
    if (cancelled) {
      post({ version: WORKER_PROTOCOL_VERSION, type: "job.cancelled", jobId: request.jobId });
      return;
    }
    const moldError = error instanceof MoldGenerationError
      ? error
      : new MoldGenerationError(
          "MOLD_KERNEL_FAILED",
          "The press mold could not be generated locally.",
          "source",
          undefined,
          error instanceof Error ? error.message : String(error),
        );
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: request.jobId,
      error: {
        code: moldError.code,
        message: moldError.message,
        detail: [moldError.feature, moldError.featureId, moldError.detail].filter(Boolean).join(": "),
      },
    });
  }
}

async function runExport(request: ExportMoldRequest): Promise<void> {
  try {
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "validating",
      progress: 0.18,
      message: "Rechecking result ID and topology",
    });
    if (
      !request.sourceResultJobId ||
      request.sourceResultJobId !== request.expectedResultJobId
    ) {
      throw new MoldExportError(
        "STALE_RESULT",
        "The mold result is no longer current and cannot be exported.",
      );
    }
    const kernel = await loadManifold();
    for (const part of request.result.parts) {
      if (cancelledJobs.has(request.jobId)) break;
      let solid;
      try {
        solid = triangleMeshToManifold(kernel, part.mesh);
      } catch (error) {
        throw new MoldExportError(
          "INVALID_EXPORT_TOPOLOGY",
          "At least one mold part fails renewed Manifold validation.",
          error instanceof Error ? error.message : part.id,
        );
      }
      try {
        const metrics = measureSolid(solid);
        if (
          !metrics.closed ||
          metrics.boundaryEdges !== 0 ||
          metrics.nonManifoldEdges !== 0 ||
          metrics.volumeMm3 <= 0
        ) {
          throw new MoldExportError(
            "INVALID_EXPORT_TOPOLOGY",
            "At least one mold half is no longer exportable.",
            side,
          );
        }
      } finally {
        solid.delete();
      }
    }
    if (cancelledJobs.has(request.jobId)) {
      cancelledJobs.delete(request.jobId);
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.cancelled",
        jobId: request.jobId,
      });
      return;
    }
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "exporting",
      progress: 0.62,
      message: "Creating STL, 3MF, and print package locally",
    });
    const result = buildMoldExportPackage(request);
    post(
      {
        version: WORKER_PROTOCOL_VERSION,
        type: "job.success",
        jobId: request.jobId,
        result,
      },
      [
        ...result.partStls.map((artifact) => artifact.data),
        result.combinedThreeMf.data,
        result.printPackageZip.data,
      ],
    );
  } catch (error) {
    const cancelled = cancelledJobs.has(request.jobId);
    cancelledJobs.delete(request.jobId);
    if (cancelled) {
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.cancelled",
        jobId: request.jobId,
      });
      return;
    }
    const exportError =
      error instanceof MoldExportError
        ? error
        : new MoldExportError(
            "EXPORT_FAILED",
            "The local export package could not be created.",
            error instanceof Error ? error.message : String(error),
          );
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: request.jobId,
      error: {
        code: exportError.code,
        message: exportError.message,
        detail: exportError.detail,
      },
    });
  }
}

async function runPressExport(request: ExportPressMoldRequest): Promise<void> {
  try {
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "validating",
      progress: 0.18,
      message: "Rechecking press mold ID and topology",
    });
    if (!request.sourceResultJobId || request.sourceResultJobId !== request.expectedResultJobId) {
      throw new MoldExportError("STALE_RESULT", "The press mold result is no longer current and cannot be exported.");
    }
    const kernel = await loadManifold();
    for (const part of ["die", "piston"] as const) {
      if (cancelledJobs.has(request.jobId)) break;
      let solid;
      try {
        solid = triangleMeshToManifold(kernel, request.result[part]);
      } catch (error) {
        throw new MoldExportError(
          "INVALID_EXPORT_TOPOLOGY",
          "Die or piston fails renewed Manifold validation.",
          error instanceof Error ? error.message : part,
        );
      }
      try {
        const metrics = measureSolid(solid);
        if (!metrics.closed || metrics.boundaryEdges !== 0 || metrics.nonManifoldEdges !== 0 || metrics.volumeMm3 <= 0) {
          throw new MoldExportError("INVALID_EXPORT_TOPOLOGY", "Die or piston is no longer exportable.", part);
        }
      } finally {
        solid.delete();
      }
    }
    if (cancelledJobs.has(request.jobId)) {
      cancelledJobs.delete(request.jobId);
      post({ version: WORKER_PROTOCOL_VERSION, type: "job.cancelled", jobId: request.jobId });
      return;
    }
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "exporting",
      progress: 0.62,
      message: "Creating die, piston, 3MF, and print package locally",
    });
    const result = buildPressMoldExportPackage(request);
    post(
      { version: WORKER_PROTOCOL_VERSION, type: "job.success", jobId: request.jobId, result },
      [result.dieStl.data, result.pistonStl.data, result.combinedThreeMf.data, result.printPackageZip.data],
    );
  } catch (error) {
    const cancelled = cancelledJobs.has(request.jobId);
    cancelledJobs.delete(request.jobId);
    if (cancelled) {
      post({ version: WORKER_PROTOCOL_VERSION, type: "job.cancelled", jobId: request.jobId });
      return;
    }
    const exportError = error instanceof MoldExportError
      ? error
      : new MoldExportError("EXPORT_FAILED", "The local press mold package could not be created.", error instanceof Error ? error.message : String(error));
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: request.jobId,
      error: { code: exportError.code, message: exportError.message, detail: exportError.detail },
    });
  }
}

async function runModelSplitter(request: GenerateModelSplitterRequest): Promise<void> {
  try {
    const splitPlan = planSplitGrid(calculateMeshBounds(request.mesh), request.params);
    const connectorPolicy = modelSplitterConnectorPolicy(splitPlan.gridCounts);
    const expectedConnectors = request.params.connectors
      ? Math.min(
          connectorPolicy.totalBudget,
          connectorPolicy.interfaceCount * connectorPolicy.maxPerInterface,
        )
      : 0;
    const memory = estimateModelSplitterMemory(
      request.mesh,
      detectRuntimeCapabilities(),
      splitPlan.partCount,
      expectedConnectors,
    );
    if (!memory.allowed) {
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.error",
        jobId: request.jobId,
        error: {
          code: "MEMORY_BUDGET_EXCEEDED",
          message: memory.reason ?? "Local memory budget exceeded.",
          detail: String(memory.estimatedPeakBytes),
        },
      });
      return;
    }
    const result = await generateModelSplitter(request.mesh, request.params, {
      isCancelled: () => cancelledJobs.has(request.jobId),
      onProgress: ({ stage, progress: value, message }) => {
        post({
          version: WORKER_PROTOCOL_VERSION,
          type: "job.progress",
          jobId: request.jobId,
          stage,
          progress: value,
          message,
        });
      },
    });
    if (cancelledJobs.has(request.jobId)) {
      cancelledJobs.delete(request.jobId);
      post({ version: WORKER_PROTOCOL_VERSION, type: "job.cancelled", jobId: request.jobId });
      return;
    }
    const transferBuffers = new Set<ArrayBuffer>();
    for (const part of result.parts) {
      transferBuffers.add(part.mesh.positions.buffer);
      transferBuffers.add(part.mesh.indices.buffer);
    }
    post(
      { version: WORKER_PROTOCOL_VERSION, type: "job.success", jobId: request.jobId, result },
      [...transferBuffers],
    );
  } catch (error) {
    const cancelled = cancelledJobs.has(request.jobId) ||
      (error instanceof ModelSplitterError && error.code === "CANCELLED");
    cancelledJobs.delete(request.jobId);
    if (cancelled) {
      post({ version: WORKER_PROTOCOL_VERSION, type: "job.cancelled", jobId: request.jobId });
      return;
    }
    const splitterError = error instanceof ModelSplitterError
      ? error
      : new ModelSplitterError(
          "SPLITTER_KERNEL_FAILED",
          "The model could not be split locally.",
          error instanceof Error ? error.message : String(error),
        );
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: request.jobId,
      error: {
        code: splitterError.code,
        message: splitterError.message,
        detail: splitterError.detail,
      },
    });
  }
}

async function runModelSplitterExport(request: ExportModelSplitterRequest): Promise<void> {
  try {
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "validating",
      progress: 0.18,
      message: "Rechecking all eight centered parts",
    });
    if (!request.sourceResultJobId || request.sourceResultJobId !== request.expectedResultJobId) {
      throw new MoldExportError(
        "STALE_RESULT",
        "The model splitter result is no longer current and cannot be exported.",
      );
    }
    const kernel = await loadManifold();
    for (const part of request.result.parts) {
      if (cancelledJobs.has(request.jobId)) break;
      let solid;
      try {
        solid = triangleMeshToManifold(kernel, part.mesh);
      } catch (error) {
        throw new MoldExportError(
          "INVALID_EXPORT_TOPOLOGY",
          `Split part ${part.id} fails renewed Manifold validation.`,
          error instanceof Error ? error.message : String(error),
        );
      }
      try {
        const metrics = measureSolid(solid);
        if (!metrics.closed || metrics.boundaryEdges !== 0 || metrics.nonManifoldEdges !== 0 || metrics.volumeMm3 <= 0) {
          throw new MoldExportError(
            "INVALID_EXPORT_TOPOLOGY",
            `Split part ${part.id} is no longer exportable.`,
          );
        }
      } finally {
        solid.delete();
      }
    }
    if (cancelledJobs.has(request.jobId)) {
      cancelledJobs.delete(request.jobId);
      post({ version: WORKER_PROTOCOL_VERSION, type: "job.cancelled", jobId: request.jobId });
      return;
    }
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "exporting",
      progress: 0.62,
      message: "Creating STL files, one-object plates, and assembly package locally",
    });
    const result = buildModelSplitterExportPackage(request);
    post(
      { version: WORKER_PROTOCOL_VERSION, type: "job.success", jobId: request.jobId, result },
      [
        ...result.partStls.map((artifact) => artifact.data),
        ...result.plateThreeMfs.map((artifact) => artifact.data),
        result.printPackageZip.data,
      ],
    );
  } catch (error) {
    const cancelled = cancelledJobs.has(request.jobId);
    cancelledJobs.delete(request.jobId);
    if (cancelled) {
      post({ version: WORKER_PROTOCOL_VERSION, type: "job.cancelled", jobId: request.jobId });
      return;
    }
    const exportError = error instanceof MoldExportError
      ? error
      : new MoldExportError(
          "EXPORT_FAILED",
          "The local model splitter package could not be created.",
          error instanceof Error ? error.message : String(error),
        );
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: request.jobId,
      error: { code: exportError.code, message: exportError.message, detail: exportError.detail },
    });
  }
}

async function runSelfTest(request: KernelSelfTestRequest): Promise<void> {
  try {
    const result = await runKernelSelfTest({
      isCancelled: () => cancelledJobs.has(request.jobId),
      onProgress: ({ stage, progress: value, message }) => {
        post({
          version: WORKER_PROTOCOL_VERSION,
          type: "job.progress",
          jobId: request.jobId,
          stage,
          progress: value,
          message,
        });
      },
    });
    if (cancelledJobs.has(request.jobId)) {
      cancelledJobs.delete(request.jobId);
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.cancelled",
        jobId: request.jobId,
      });
      return;
    }
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.success",
      jobId: request.jobId,
      result,
    });
  } catch (error) {
    const cancelled =
      cancelledJobs.has(request.jobId) ||
      (error instanceof Error && error.message === "SELF_TEST_CANCELLED");
    cancelledJobs.delete(request.jobId);
    if (cancelled) {
      post({
        version: WORKER_PROTOCOL_VERSION,
        type: "job.cancelled",
        jobId: request.jobId,
      });
      return;
    }
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: request.jobId,
      error: {
        code: "KERNEL_OPERATION_FAILED",
        message:
          "The local geometry kernel could not complete the self-test.",
        detail: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (
    !request ||
    request.version !== WORKER_PROTOCOL_VERSION ||
    typeof request.jobId !== "string"
  ) {
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: "unknown",
      error: {
        code: "INVALID_MESSAGE",
        message: `Worker request does not match protocol version ${WORKER_PROTOCOL_VERSION}.`,
      },
    });
    return;
  }
  if (request.type === "job.cancel") {
    cancelledJobs.add(request.jobId);
  } else if (request.type === "mesh.import") {
    beginJob(request.jobId);
    progress(request.jobId, "parsing", 0.02, "Import job queued");
    void runImport(request);
  } else if (request.type === "mold.generate") {
    beginJob(request.jobId);
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "queued",
      progress: 0.02,
      message: "Mold job queued",
    });
    void runMold(request);
  } else if (request.type === "mold.export") {
    beginJob(request.jobId);
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "queued",
      progress: 0.02,
      message: "Export job queued",
    });
    void runExport(request);
  } else if (request.type === "press.generate") {
    beginJob(request.jobId);
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "queued",
      progress: 0.02,
      message: "Press mold job queued",
    });
    void runPressMold(request);
  } else if (request.type === "press.export") {
    beginJob(request.jobId);
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "queued",
      progress: 0.02,
      message: "Press mold export queued",
    });
    void runPressExport(request);
  } else if (request.type === "splitter.generate") {
    beginJob(request.jobId);
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "queued",
      progress: 0.02,
      message: "Eight-part model split queued",
    });
    void runModelSplitter(request);
  } else if (request.type === "splitter.export") {
    beginJob(request.jobId);
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.progress",
      jobId: request.jobId,
      stage: "queued",
      progress: 0.02,
      message: "Model splitter export queued",
    });
    void runModelSplitterExport(request);
  } else if (request.type === "kernel.self-test") {
    beginJob(request.jobId);
    void runSelfTest(request);
  } else {
    post({
      version: WORKER_PROTOCOL_VERSION,
      type: "job.error",
      jobId: request.jobId,
      error: {
        code: "FEATURE_NOT_IMPLEMENTED",
        message: "The mold generator follows import and repair.",
      },
    });
  }
};

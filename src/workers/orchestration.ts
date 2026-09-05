import type { TriangleMeshData, WorkerResponse } from "./protocol";

export type GeometryJobKind = "import" | "mold" | "export" | "self-test";
export type WorkerExecutionMode = "isolated-worker" | "single-thread-fallback";

export type RuntimeCapabilities = {
  mode: WorkerExecutionMode;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  deviceMemoryGb: number | null;
  memoryBudgetBytes: number;
};

export type MemoryEstimate = {
  inputBytes: number;
  estimatedPeakBytes: number;
  budgetBytes: number;
  allowed: boolean;
  reason: string | null;
};

type CapabilitySource = {
  crossOriginIsolated?: boolean;
  SharedArrayBuffer?: unknown;
  navigator?: { deviceMemory?: number };
};

const MIB = 1024 * 1024;
const DEFAULT_BUDGET_BYTES = 384 * MIB;
const MIN_BUDGET_BYTES = 256 * MIB;
const MAX_BUDGET_BYTES = 768 * MIB;
const WASM_BASE_BYTES = 64 * MIB;

export function detectRuntimeCapabilities(
  source: CapabilitySource = globalThis as CapabilitySource,
): RuntimeCapabilities {
  const deviceMemoryGb =
    typeof source.navigator?.deviceMemory === "number" &&
    Number.isFinite(source.navigator.deviceMemory) &&
    source.navigator.deviceMemory > 0
      ? source.navigator.deviceMemory
      : null;
  const sharedArrayBuffer =
    typeof source.SharedArrayBuffer === "function" &&
    source.crossOriginIsolated === true;
  const deviceBudget = deviceMemoryGb
    ? deviceMemoryGb * 1024 * MIB * 0.2
    : DEFAULT_BUDGET_BYTES;
  const memoryBudgetBytes = Math.round(
    Math.min(MAX_BUDGET_BYTES, Math.max(MIN_BUDGET_BYTES, deviceBudget)),
  );
  return {
    mode: sharedArrayBuffer ? "isolated-worker" : "single-thread-fallback",
    crossOriginIsolated: source.crossOriginIsolated === true,
    sharedArrayBuffer,
    deviceMemoryGb,
    memoryBudgetBytes,
  };
}

export function meshTransferBytes(mesh: TriangleMeshData): number {
  return mesh.positions.byteLength + mesh.indices.byteLength;
}

export function estimateMoldMemory(
  mesh: TriangleMeshData,
  capabilities: RuntimeCapabilities,
): MemoryEstimate {
  const inputBytes = meshTransferBytes(mesh);
  const triangles = mesh.indices.length / 3;
  const estimatedPeakBytes = Math.ceil(
    WASM_BASE_BYTES + inputBytes * 3 + triangles * 320,
  );
  const allowed = estimatedPeakBytes <= capabilities.memoryBudgetBytes;
  return {
    inputBytes,
    estimatedPeakBytes,
    budgetBytes: capabilities.memoryBudgetBytes,
    allowed,
    reason: allowed
      ? null
      : "The model exceeds the conservative local memory budget.",
  };
}

export function estimateModelSplitterMemory(
  mesh: TriangleMeshData,
  capabilities: RuntimeCapabilities,
  partCount: number,
  connectorCount: number,
): MemoryEstimate {
  const base = estimateMoldMemory(mesh, capabilities);
  const partOverheadBytes = Math.max(0, partCount) * 256 * 1024;
  const connectorOverheadBytes = Math.max(0, connectorCount) * 48 * 1024;
  const estimatedPeakBytes = base.estimatedPeakBytes +
    partOverheadBytes +
    connectorOverheadBytes;
  const allowed = estimatedPeakBytes <= capabilities.memoryBudgetBytes;
  return {
    ...base,
    estimatedPeakBytes,
    allowed,
    reason: allowed
      ? null
      : "This mesh and split grid exceed the conservative local memory budget. Reduce mesh detail, disable connectors, or use a browser/device with more memory.",
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < MIB) return Math.ceil(bytes / 1024) + " KB";
  return Math.ceil(bytes / MIB) + " MB";
}

export class GeometryJobCoordinator {
  private active: {
    jobId: string;
    kind: GeometryJobKind;
    state: "running" | "cancelling";
  } | null = null;

  start(jobId: string, kind: GeometryJobKind): void {
    this.active = { jobId, kind, state: "running" };
  }

  requestCancel(): string | null {
    if (!this.active) return null;
    this.active.state = "cancelling";
    return this.active.jobId;
  }

  accepts(response: Pick<WorkerResponse, "jobId">): boolean {
    return this.active?.jobId === response.jobId;
  }

  finish(jobId: string): boolean {
    if (this.active?.jobId !== jobId) return false;
    this.active = null;
    return true;
  }

  get snapshot() {
    return this.active ? { ...this.active } : null;
  }
}

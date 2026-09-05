import { describe, expect, it } from "vitest";
import {
  GeometryJobCoordinator,
  detectRuntimeCapabilities,
  estimateModelSplitterMemory,
  estimateMoldMemory,
  formatBytes,
} from "../../src/workers/orchestration";
import type { TriangleMeshData } from "../../src/workers/protocol";

function mesh(triangles: number): TriangleMeshData {
  return {
    positions: new Float32Array(triangles * 9),
    indices: new Uint32Array(triangles * 3),
  };
}

describe("worker orchestration", () => {
  it("selects a controlled fallback without cross-origin isolation", () => {
    const fallback = detectRuntimeCapabilities({
      crossOriginIsolated: false,
      SharedArrayBuffer,
      navigator: { deviceMemory: 4 },
    });
    expect(fallback.mode).toBe("single-thread-fallback");
    expect(fallback.memoryBudgetBytes).toBe(768 * 1024 * 1024);

    const isolated = detectRuntimeCapabilities({
      crossOriginIsolated: true,
      SharedArrayBuffer,
      navigator: { deviceMemory: 1 },
    });
    expect(isolated.mode).toBe("isolated-worker");
    expect(isolated.memoryBudgetBytes).toBe(256 * 1024 * 1024);
  });

  it("estimates a conservative peak and rejects oversized work", () => {
    const capabilities = detectRuntimeCapabilities({
      navigator: { deviceMemory: 1 },
    });
    expect(estimateMoldMemory(mesh(10_000), capabilities).allowed).toBe(true);
    const large = estimateMoldMemory(mesh(1_000_000), capabilities);
    expect(large.allowed).toBe(false);
    expect(large.estimatedPeakBytes).toBeGreaterThan(large.budgetBytes);
    expect(formatBytes(64 * 1024 * 1024)).toBe("64 MB");
  });

  it("budgets 180-part splitter work from mesh and connector load", () => {
    const capabilities = detectRuntimeCapabilities({
      navigator: { deviceMemory: 1 },
    });
    const safe = estimateModelSplitterMemory(
      mesh(10_000),
      capabilities,
      180,
      888,
    );
    expect(safe.allowed).toBe(true);
    expect(safe.estimatedPeakBytes).toBeGreaterThan(
      estimateMoldMemory(mesh(10_000), capabilities).estimatedPeakBytes,
    );
    const dense = estimateModelSplitterMemory(
      mesh(1_000_000),
      capabilities,
      180,
      888,
    );
    expect(dense.allowed).toBe(false);
    expect(dense.reason).toMatch(/mesh|memory/i);
  });

  it("rejects stale responses and cannot finish a newer job with an old id", () => {
    const coordinator = new GeometryJobCoordinator();
    coordinator.start("old", "import");
    coordinator.start("new", "mold");
    expect(coordinator.accepts({ jobId: "old" })).toBe(false);
    expect(coordinator.finish("old")).toBe(false);
    expect(coordinator.accepts({ jobId: "new" })).toBe(true);
    expect(coordinator.finish("new")).toBe(true);
    expect(coordinator.snapshot).toBeNull();
  });

  it("tracks cancellation only for the active job", () => {
    const coordinator = new GeometryJobCoordinator();
    expect(coordinator.requestCancel()).toBeNull();
    coordinator.start("job-1", "self-test");
    expect(coordinator.requestCancel()).toBe("job-1");
    expect(coordinator.snapshot?.state).toBe("cancelling");
  });
});
import type { Manifold as ManifoldSolid } from "manifold-3d";
import {
  manifoldToTriangleMesh,
  measureSolid,
  meshTopology,
  triangleMeshToManifold,
} from "./adapter";
import { loadManifold } from "./loader";
import { indexedCube, openCube } from "../../testing/fixtures";
import type {
  KernelMetric,
  KernelSelfTestResult,
  WorkerStage,
} from "../../workers/protocol";

const MANIFOLD_VERSION = "3.5.1";

export type SelfTestProgress = {
  stage: WorkerStage;
  progress: number;
  message: string;
};

export type SelfTestOptions = {
  isCancelled?: () => boolean;
  onProgress?: (progress: SelfTestProgress) => void;
};

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function yieldToWorker(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertNotCancelled(options: SelfTestOptions): void {
  if (options.isCancelled?.()) throw new Error("SELF_TEST_CANCELLED");
}

function metric(name: string, solid: ManifoldSolid, startedAt: number): KernelMetric {
  const metrics = measureSolid(solid);
  return {
    name,
    triangles: metrics.triangles,
    volumeMm3: metrics.volumeMm3,
    closed: metrics.closed,
    durationMs: now() - startedAt,
  };
}

export async function runKernelSelfTest(
  options: SelfTestOptions = {},
): Promise<KernelSelfTestResult> {
  const totalStartedAt = now();
  options.onProgress?.({
    stage: "initializing",
    progress: 0.08,
    message: "Initializing Manifold WASM",
  });
  const kernel = await loadManifold();
  assertNotCancelled(options);
  const metrics: KernelMetric[] = [];

  options.onProgress?.({
    stage: "validating",
    progress: 0.2,
    message: "Checking mesh round-trip and cube",
  });
  await yieldToWorker();
  assertNotCancelled(options);
  {
    const startedAt = now();
    const source = triangleMeshToManifold(kernel, indexedCube(20));
    const roundTrip = manifoldToTriangleMesh(source);
    const topology = meshTopology(roundTrip);
    metrics.push({
      name: "indexed-cube-roundtrip",
      triangles: topology.triangles,
      volumeMm3: source.volume(),
      closed: topology.closed,
      durationMs: now() - startedAt,
    });
    source.delete();
  }

  options.onProgress?.({
    stage: "boolean",
    progress: 0.38,
    message: "Splitting cube at the seam plane",
  });
  await yieldToWorker();
  assertNotCancelled(options);
  {
    const source = kernel.Manifold.cube([32, 24, 20], true);
    const startedAt = now();
    const [front, back] = source.splitByPlane([1, 0, 0], 1.5);
    metrics.push(metric("cube-front-half", front, startedAt));
    metrics.push(metric("cube-back-half", back, startedAt));
    front.delete();
    back.delete();
    source.delete();
  }

  options.onProgress?.({
    stage: "boolean",
    progress: 0.54,
    message: "Cutting asymmetric solid",
  });
  await yieldToWorker();
  assertNotCancelled(options);
  {
    const base = kernel.Manifold.cube([34, 22, 18], true);
    const tower = kernel.Manifold.cylinder(28, 5, 8, 48, true).translate([8, 1, 6]);
    const asymmetric = base.add(tower);
    const startedAt = now();
    const [front, back] = asymmetric.splitByPlane([1, 0, 0], 2);
    metrics.push(metric("asymmetric-front-half", front, startedAt));
    metrics.push(metric("asymmetric-back-half", back, startedAt));
    front.delete();
    back.delete();
    asymmetric.delete();
    tower.delete();
    base.delete();
  }

  options.onProgress?.({
    stage: "boolean",
    progress: 0.68,
    message: "Checking hollow solid and Boolean difference",
  });
  await yieldToWorker();
  assertNotCancelled(options);
  {
    const outer = kernel.Manifold.cube([30, 30, 30], true);
    const inner = kernel.Manifold.cube([20, 20, 20], true);
    const hollow = outer.subtract(inner);
    const startedAt = now();
    metrics.push(metric("hollow-boolean", hollow, startedAt));
    hollow.delete();
    inner.delete();
    outer.delete();
  }

  options.onProgress?.({
    stage: "validating",
    progress: 0.76,
    message: "Rejecting open defective mesh",
  });
  await yieldToWorker();
  assertNotCancelled(options);
  {
    const startedAt = now();
    let rejected = false;
    try {
      const invalid = triangleMeshToManifold(kernel, openCube());
      invalid.delete();
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Open cube was unexpectedly accepted.");
    metrics.push({
      name: "open-mesh-expected-rejection",
      triangles: openCube().indices.length / 3,
      volumeMm3: 0,
      closed: false,
      durationMs: now() - startedAt,
    });
  }

  options.onProgress?.({
    stage: "measuring",
    progress: 0.86,
    message: "Measuring dense 100k benchmark solid",
  });
  await yieldToWorker();
  assertNotCancelled(options);
  {
    const startedAt = now();
    const denseSphere = kernel.Manifold.sphere(30, 480);
    metrics.push(metric("dense-sphere-benchmark", denseSphere, startedAt));
    denseSphere.delete();
  }

  if (
    metrics
      .filter((entry) => entry.name !== "open-mesh-expected-rejection")
      .some((entry) => !entry.closed || entry.volumeMm3 <= 0)
  ) {
    throw new Error("Kernel produced a non-closed or zero-volume result.");
  }

  options.onProgress?.({
    stage: "complete",
    progress: 1,
    message: "Local geometry kernel is ready",
  });
  return {
    kind: "kernel-self-test",
    kernel: "manifold-3d",
    version: MANIFOLD_VERSION,
    totalDurationMs: now() - totalStartedAt,
    metrics,
  };
}

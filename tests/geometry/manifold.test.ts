import { describe, expect, it } from "vitest";
import {
  KernelMeshError,
  measureSolid,
  splitTriangleMeshByPlane,
  triangleMeshToManifold,
} from "../../src/geometry/kernel/adapter";
import { loadManifold } from "../../src/geometry/kernel/loader";
import { runKernelSelfTest } from "../../src/geometry/kernel/self-test";
import { indexedCube, openCube } from "../../src/testing/fixtures";

describe("manifold WASM adapter", () => {
  it("round-trips an indexed closed cube with stable volume", async () => {
    const kernel = await loadManifold();
    const solid = triangleMeshToManifold(kernel, indexedCube(20));
    const metrics = measureSolid(solid);
    solid.delete();

    expect(metrics.closed).toBe(true);
    expect(metrics.triangles).toBeGreaterThanOrEqual(12);
    expect(metrics.volumeMm3).toBeCloseTo(8_000, 3);
  });

  it("splits a closed cube into two closed solids", async () => {
    const result = await splitTriangleMeshByPlane(indexedCube(20), [1, 0, 0], 0);

    expect(result.positiveMetrics.closed).toBe(true);
    expect(result.negativeMetrics.closed).toBe(true);
    expect(
      result.positiveMetrics.volumeMm3 + result.negativeMetrics.volumeMm3,
    ).toBeCloseTo(8_000, 3);
  });

  it("rejects an open mesh with a structured kernel error", async () => {
    const kernel = await loadManifold();

    expect(() => triangleMeshToManifold(kernel, openCube())).toThrowError(
      KernelMeshError,
    );
  });

  it("passes boolean, split, defect and dense-mesh acceptance cases", async () => {
    const result = await runKernelSelfTest();
    const dense = result.metrics.find(
      (entry) => entry.name === "dense-sphere-benchmark",
    );
    const asymmetric = result.metrics.filter((entry) =>
      entry.name.startsWith("asymmetric-"),
    );

    expect(result.kernel).toBe("manifold-3d");
    expect(result.metrics).toHaveLength(8);
    expect(dense?.triangles).toBeGreaterThan(90_000);
    expect(asymmetric).toHaveLength(2);
    expect(asymmetric[0]?.volumeMm3).not.toBeCloseTo(
      asymmetric[1]?.volumeMm3 ?? 0,
      3,
    );
  });
});
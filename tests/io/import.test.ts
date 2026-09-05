import { describe, expect, it } from "vitest";
import { importAndNormalizeMesh } from "../../src/io/import";
import { MeshImportError } from "../../src/io/import/types";
import {
  cubeAsciiStl,
  cubeObj,
  cubeThreeMfCentimeters,
  twoCubeObj,
  cubeThreeMfProductionExtension,
} from "../../src/testing/import-fixtures";

const defaults = {
  upAxis: "y" as const,
  scalePercent: 100,
  sourceUnit: "auto" as const,
};

describe("local mesh import and repair", () => {
  it.each([
    ["cube.stl", cubeAsciiStl()],
    ["cube.obj", cubeObj()],
    ["cube.3mf", cubeThreeMfCentimeters()],
  ])("normalizes %s to the same millimeter solid", async (fileName, data) => {
    const result = await importAndNormalizeMesh(data, {
      ...defaults,
      fileName,
    });

    expect(result.measurements.bounds.size).toEqual([20, 20, 20]);
    expect(result.moldReady).toBe(true);
    expect(
      result.diagnostics.some((entry) => entry.code === "MODEL_SMALL"),
    ).toBe(true);
    expect(result.measurements.triangles).toBe(12);
    expect(result.measurements.volumeMm3).toBeCloseTo(8_000, 3);
    expect(result.measurements.boundaryEdges).toBe(0);
    expect(result.measurements.nonManifoldEdges).toBe(0);
  });

  it("can transfer ownership of the prepared manifold to a worker cache", async () => {
    const retained: Array<{ status(): string; delete(): void }> = [];
    const result = await importAndNormalizeMesh(
      cubeAsciiStl(),
      { ...defaults, fileName: "cached-cube.stl" },
      () => false,
      (solid) => retained.push(solid),
    );

    expect(result.moldReady).toBe(true);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.status()).toBe("NoError");
    retained[0]?.delete();
  });

  it("resolves Production Extension model parts and composes transforms", async () => {
    const result = await importAndNormalizeMesh(
      cubeThreeMfProductionExtension(),
      { ...defaults, fileName: "production-extension.3mf" },
    );

    expect(result.measurements.bounds).toMatchObject({
      min: [5, -8, -7],
      max: [25, 12, 13],
      size: [20, 20, 20],
    });
    expect(result.measurements.triangles).toBe(12);
    expect(result.moldReady).toBe(true);
    expect(result.measurements.volumeMm3).toBeCloseTo(8_000, 3);
    expect(result.measurements.boundaryEdges).toBe(0);
    expect(result.measurements.nonManifoldEdges).toBe(0);
  });

  it("removes degenerate triangles and repairs an unambiguous flipped face", async () => {
    const degenerate = await importAndNormalizeMesh(
      cubeAsciiStl({ addDegenerate: true }),
      { ...defaults, fileName: "repair.stl" },
    );
    const winding = await importAndNormalizeMesh(
      cubeObj({ reverseTriangle: 3 }),
      { ...defaults, fileName: "repair.obj" },
    );

    expect(degenerate.measurements.removedDegenerateTriangles).toBe(1);
    expect(
      degenerate.diagnostics.some(
        (entry) => entry.code === "DEGENERATE_TRIANGLES_REMOVED",
      ),
    ).toBe(true);
    expect(winding.measurements.repairedWindingTriangles).toBeGreaterThan(0);
    expect(winding.measurements.volumeMm3).toBeCloseTo(8_000, 3);
  });

  it("applies life-size scale values and Z-up baking", async () => {
    const result = await importAndNormalizeMesh(cubeObj(), {
      fileName: "scaled.obj",
      upAxis: "z",
      scalePercent: 1_000,
      sourceUnit: "cm",
    });

    expect(result.measurements.bounds.size).toEqual([2_000, 2_000, 2_000]);
    expect(result.measurements.volumeMm3).toBeCloseTo(8_000_000_000, 0);
  });

  it("preserves and reports multiple closed components", async () => {
    const result = await importAndNormalizeMesh(twoCubeObj(), {
      ...defaults,
      fileName: "components.obj",
    });

    expect(result.measurements.componentCount).toBe(2);
    expect(result.measurements.volumeMm3).toBeCloseTo(16_000, 3);
    expect(
      result.diagnostics.some((entry) => entry.code === "MULTIPLE_COMPONENTS"),
    ).toBe(true);
  });
  it("repairs closed boundary loops and isolated non-manifold faces", async () => {
    const open = await importAndNormalizeMesh(
      cubeObj({ open: true }),
      { ...defaults, fileName: "open.obj" },
    );
    const nonManifold = await importAndNormalizeMesh(
      cubeObj({ nonManifold: true }),
      { ...defaults, fileName: "non-manifold.obj" },
    );

    for (const result of [open, nonManifold]) {
      expect(result.moldReady).toBe(true);
      expect(result.mesh.indices.length).toBeGreaterThan(0);
      expect(result.measurements.boundaryEdges).toBe(0);
      expect(result.measurements.nonManifoldEdges).toBe(0);
    }
    expect(open.measurements.cappedBoundaryLoops).toBeGreaterThan(0);
    expect(
      open.diagnostics.some((entry) => entry.code === "BOUNDARY_LOOPS_CAPPED"),
    ).toBe(true);
    expect(
      nonManifold.measurements.removedDuplicateTriangles +
        nonManifold.measurements.removedNonManifoldTriangles,
    ).toBeGreaterThan(0);
  });

  it("rejects unsupported formats before parsing", async () => {
    await expect(
      importAndNormalizeMesh(new ArrayBuffer(16), {
        ...defaults,
        fileName: "model.glb",
      }),
    ).rejects.toMatchObject<MeshImportError>({ code: "UNSUPPORTED_FORMAT" });
  });
});

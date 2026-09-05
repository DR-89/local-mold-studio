import { describe, expect, it } from "vitest";
import { createDefaultPressMoldParams } from "../../src/domain/press-mold";
import { findAutomaticPressSeamY, generatePressMold } from "../../src/geometry/press-mold";
import { MoldGenerationError } from "../../src/geometry/mold";
import { manifoldToTriangleMesh } from "../../src/geometry/kernel/adapter";
import { loadManifold } from "../../src/geometry/kernel/loader";
import { indexedCube, openCube } from "../../src/testing/fixtures";

describe("press mold CSG", () => {
  it("creates a closed printable die and piston for a cube", async () => {
    const result = await generatePressMold(indexedCube(20), createDefaultPressMoldParams());
    expect(result.dieMetrics.closed).toBe(true);
    expect(result.pistonMetrics.closed).toBe(true);
    expect(result.dieMetrics.volumeMm3).toBeGreaterThan(0);
    expect(result.pistonMetrics.volumeMm3).toBeGreaterThan(0);
    expect(result.dieMetrics.bedTriangles).toBeGreaterThan(0);
    expect(result.pistonMetrics.bedTriangles).toBeGreaterThan(0);
    expect(result.dieMetrics.bounds.min[1]).toBeCloseTo(0, 5);
    expect(result.pistonMetrics.bounds.min[1]).toBeCloseTo(0, 5);
    expect(result.features.cavityVolumeMm3).toBeCloseTo(8_000, 3);
    expect(result.features.ejectorDiameterMm).toBeGreaterThan(0);
    expect(result.features.guideRails).toMatchObject({ count: 2, clearanceMm: 0.3 });
    expect(result.features.guideRails.widthMm).toBeGreaterThanOrEqual(4);
    expect(result.features.guideRails.depthMm).toBeGreaterThanOrEqual(1.2);
  });

  it("chooses round for a cylinder and rectangular for an asymmetric solid", async () => {
    const kernel = await loadManifold();
    const cylinderBase = kernel.Manifold.cylinder(28, 9, 9, 48, true);
    const cylinder = cylinderBase.rotate([-90, 0, 0]);
    const base = kernel.Manifold.cube([34, 22, 18], true);
    const towerBase = kernel.Manifold.cylinder(24, 5, 7, 48, true);
    const towerRotated = towerBase.rotate([-90, 0, 0]);
    const tower = towerRotated.translate([7, 4, 3]);
    const asymmetric = base.add(tower);
    const cylinderMesh = manifoldToTriangleMesh(cylinder);
    const asymmetricMesh = manifoldToTriangleMesh(asymmetric);
    cylinderBase.delete();
    cylinder.delete();
    asymmetric.delete();
    tower.delete();
    towerRotated.delete();
    towerBase.delete();
    base.delete();
    const cylinderResult = await generatePressMold(cylinderMesh, createDefaultPressMoldParams());
    const asymmetricResult = await generatePressMold(asymmetricMesh, createDefaultPressMoldParams());
    expect(cylinderResult.features.shapeResolved).toBe("round");
    expect(asymmetricResult.features.shapeResolved).toBe("rectangular");
    expect(asymmetricResult.dieMetrics.closed).toBe(true);
    expect(asymmetricResult.pistonMetrics.closed).toBe(true);
  });

  it("finds a deterministic interior seam and supports a manual offset", async () => {
    const mesh = indexedCube(20);
    const automatic = findAutomaticPressSeamY(mesh);
    const params = createDefaultPressMoldParams();
    params.seamOffsetMm = 2;
    const result = await generatePressMold(mesh, params);
    expect(automatic).toBeCloseTo(0, 5);
    expect(result.features.seamYMm).toBeCloseTo(automatic + 2, 5);
  });

  it("uses a compact round sleeve, tall die guide and flanged piston for a sphere", async () => {
    const kernel = await loadManifold();
    const sphere = kernel.Manifold.sphere(30, 48);
    const mesh = manifoldToTriangleMesh(sphere);
    sphere.delete();
    const result = await generatePressMold(mesh, createDefaultPressMoldParams());
    const outerDiameter =
      result.features.outerBounds.max[0] - result.features.outerBounds.min[0];
    const dieHeight = result.dieMetrics.bounds.max[1] - result.dieMetrics.bounds.min[1];
    const pistonHeight =
      result.pistonMetrics.bounds.max[1] - result.pistonMetrics.bounds.min[1];
    expect(result.features.shapeResolved).toBe("round");
    expect(outerDiameter).toBeGreaterThan(74);
    expect(outerDiameter).toBeLessThan(80);
    expect(result.features.guideHeightMm).toBeGreaterThan(20);
    expect(result.features.guideRails.count).toBe(2);
    expect(result.features.guideRails.widthMm).toBeGreaterThan(7);
    expect(dieHeight).toBeGreaterThan(pistonHeight + 15);
    expect(result.dieMetrics.closed).toBe(true);
    expect(result.pistonMetrics.closed).toBe(true);
  });

  it("rejects defective source geometry and cancellation", async () => {
    await expect(
      generatePressMold(openCube(), createDefaultPressMoldParams()),
    ).rejects.toMatchObject<MoldGenerationError>({ code: "INVALID_SOURCE_MESH", feature: "source" });
    await expect(
      generatePressMold(indexedCube(20), createDefaultPressMoldParams(), { isCancelled: () => true }),
    ).rejects.toMatchObject<MoldGenerationError>({ code: "CANCELLED" });
  });
});
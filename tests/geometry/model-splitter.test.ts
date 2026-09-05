import { describe, expect, it } from "vitest";
import { createDefaultModelSplitterParams } from "../../src/domain/model-splitter";
import {
  manifoldToTriangleMesh,
  triangleMeshToManifold,
} from "../../src/geometry/kernel/adapter";
import { loadManifold } from "../../src/geometry/kernel/loader";
import {
  generateModelSplitter,
  ModelSplitterError,
} from "../../src/geometry/model-splitter";
import { indexedCube, openCube } from "../../src/testing/fixtures";

function expectClosedCenteredParts(
  result: Awaited<ReturnType<typeof generateModelSplitter>>,
  count: number,
): void {
  expect(result.parts).toHaveLength(count);
  expect(new Set(result.parts.map((part) => part.id)).size).toBe(count);
  for (const part of result.parts) {
    expect(part.metrics.closed).toBe(true);
    expect(part.metrics.boundaryEdges).toBe(0);
    expect(part.metrics.nonManifoldEdges).toBe(0);
    expect(part.metrics.volumeMm3).toBeGreaterThan(0);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(
        part.metrics.bounds.min[axis] + part.metrics.bounds.max[axis],
      ).toBeCloseTo(0, 4);
    }
  }
}

function expectConnectorEnvelopesInsideSource(
  kernel: Awaited<ReturnType<typeof loadManifold>>,
  result: Awaited<ReturnType<typeof generateModelSplitter>>,
  baseline: Awaited<ReturnType<typeof generateModelSplitter>>,
): void {
  const dimensionByAxis = { x: 0, y: 1, z: 2 } as const;
  for (const connector of result.features.connectors) {
    const dimension = dimensionByAxis[connector.axis];
    const female = baseline.parts.find(
      (part) => part.id === connector.femalePartId,
    );
    const male = baseline.parts.find(
      (part) => part.id === connector.malePartId,
    );
    expect(female).toBeDefined();
    expect(male).toBeDefined();
    if (!female || !male) continue;
    const direction =
      female.gridIndex[dimension] > male.gridIndex[dimension] ? 1 : -1;
    const connectorRadius = connector.diameterMm / 2;
    const radialWall = Math.max(1.2, Math.min(30, connectorRadius * 0.35));
    const endWall = Math.max(1.2, Math.min(30, connector.depthMm * 0.3));
    const guardRadius = connectorRadius + connector.clearanceMm + radialWall;
    const guardLength = connector.depthMm + connector.gluePocketMm + endWall;
    const guardCenter: [number, number, number] = [...connector.centerMm];
    guardCenter[dimension] += (direction * guardLength) / 2;
    const primitive = kernel.Manifold.cylinder(
      guardLength,
      guardRadius,
      guardRadius,
      48,
      true,
    );
    const oriented =
      connector.axis === "x"
        ? primitive.rotate([0, 90, 0])
        : connector.axis === "y"
          ? primitive.rotate([-90, 0, 0])
          : primitive;
    const guard = oriented.translate(guardCenter);
    const centeredFemale = triangleMeshToManifold(kernel, female.mesh);
    const assembledFemale = centeredFemale.translate(female.assemblyCenterMm);
    const outside = guard.subtract(assembledFemale);
    const tolerance = Math.max(1e-7, Math.min(1e-3, guard.volume() * 1e-10));
    expect(outside.volume()).toBeLessThanOrEqual(tolerance);
    outside.delete();
    assembledFemale.delete();
    centeredFemale.delete();
    guard.delete();
    if (oriented !== primitive) oriented.delete();
    primitive.delete();
  }
}

describe("automatic model splitter CSG", () => {
  it("keeps a fitting model whole without inventing eight parts", async () => {
    const result = await generateModelSplitter(
      indexedCube(30),
      createDefaultModelSplitterParams(),
    );
    expectClosedCenteredParts(result, 1);
    expect(result.parts[0].id).toBe("whole");
    expect(result.features.gridCounts).toEqual([1, 1, 1]);
    expect(result.features.connectors).toEqual([]);
    expect(result.features.splitPlanes).toEqual([]);
    expect(result.features.splitPlan.allPartsFit).toBe(true);
  });

  it("optionally halves a round 360-degree part onto stable connector-ready print faces", async () => {
    const kernel = await loadManifold();
    const sphere = kernel.Manifold.sphere(30, 48);
    const mesh = manifoldToTriangleMesh(sphere);
    sphere.delete();

    const params = createDefaultModelSplitterParams();
    params.supportSavingCuts = true;
    params.engravedLabels = false;
    const result = await generateModelSplitter(mesh, params);

    expectClosedCenteredParts(result, 2);
    expect(result.features.gridCounts).toEqual([1, 1, 1]);
    expect(result.features.supportSavingCutCount).toBe(1);
    expect(result.parts.map((part) => part.id).sort()).toEqual([
      "whole_s01",
      "whole_s02",
    ]);
    expect(result.features.connectors.length).toBeGreaterThanOrEqual(1);
    expect(
      result.features.connectors.every((connector) =>
        connector.interfaceId.startsWith("support-whole-"),
      ),
    ).toBe(true);
    expect(new Set(result.parts.map((part) => part.id))).toEqual(
      new Set([
        result.features.connectors[0]?.malePartId,
        result.features.connectors[0]?.femalePartId,
      ]),
    );
  });

  it("does not add a support-saving cut to an already flat printable part", async () => {
    const params = createDefaultModelSplitterParams();
    params.supportSavingCuts = true;
    params.engravedLabels = false;
    const result = await generateModelSplitter(indexedCube(30), params);

    expectClosedCenteredParts(result, 1);
    expect(result.features.supportSavingCutCount).toBe(0);
    expect(result.features.connectors).toEqual([]);
  });

  it("splits by print-bed size and places one large default hex connector per large face", async () => {
    const params = createDefaultModelSplitterParams();
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    params.engravedLabels = false;
    const result = await generateModelSplitter(indexedCube(120), params);
    expectClosedCenteredParts(result, 8);
    expect(result.features.gridCounts).toEqual([2, 2, 2]);
    expect(result.features.activeSplitAxes).toEqual(["x", "y", "z"]);
    expect(result.features.requestedConnectorCount).toBe(12);
    expect(result.features.connectors).toHaveLength(12);
    expect(
      result.features.connectors.every(
        (connector) => connector.style === "hex",
      ),
    ).toBe(true);
    expect(
      result.features.connectors.every(
        (connector) => connector.diameterMm === 21,
      ),
    ).toBe(true);
    const perInterface = Object.values(
      Object.groupBy(
        result.features.connectors,
        (connector) => connector.interfaceId,
      ),
    ).map((connectors) => connectors?.length ?? 0);
    expect(perInterface).toHaveLength(12);
    expect(new Set(perInterface)).toEqual(new Set([1]));
    expect(result.features.splitPlan.allPartsFit).toBe(true);
  });

  it("scales connector diameter down automatically for a small mating face", async () => {
    const kernel = await loadManifold();
    const narrowBeam = kernel.Manifold.cube([120, 8, 8], true);
    const mesh = manifoldToTriangleMesh(narrowBeam);
    narrowBeam.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.connectorSpacingMm = 20;
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const result = await generateModelSplitter(mesh, params);

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expect(result.features.connectors).toHaveLength(1);
    expect(result.features.connectors[0]).toMatchObject({
      diameterMm: 2.5,
      style: "hex",
    });
    expect(result.features.connectors[0]?.diameterMm).toBeLessThan(
      params.connectorDiameterMm,
    );
    expectClosedCenteredParts(result, 2);
  });

  it("falls back to a visible one-millimeter connector on a very small face", async () => {
    const kernel = await loadManifold();
    const tinyBeam = kernel.Manifold.cube([120, 4, 4], true);
    const mesh = manifoldToTriangleMesh(tinyBeam);
    tinyBeam.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const result = await generateModelSplitter(mesh, params);
    const baseline = await generateModelSplitter(mesh, {
      ...params,
      connectors: false,
    });

    expect(result.features.connectors).toHaveLength(1);
    expect(result.features.connectors[0]).toMatchObject({
      diameterMm: 1,
      depthMm: 4,
      style: "hex",
    });
    const connector = result.features.connectors[0]!;
    const resultVolumes = new Map(
      result.parts.map((part) => [part.id, part.metrics.volumeMm3]),
    );
    const baselineVolumes = new Map(
      baseline.parts.map((part) => [part.id, part.metrics.volumeMm3]),
    );
    expect(resultVolumes.get(connector.malePartId)).toBeGreaterThan(
      baselineVolumes.get(connector.malePartId) ?? Infinity,
    );
    expect(resultVolumes.get(connector.femalePartId)).toBeLessThan(
      baselineVolumes.get(connector.femalePartId) ?? -Infinity,
    );
    expectClosedCenteredParts(result, 2);
    expectConnectorEnvelopesInsideSource(kernel, result, baseline);
  });

  it("shrinks connectors to preserve walls around a thin local neck", async () => {
    const kernel = await loadManifold();
    const leftBase = kernel.Manifold.cube([50, 60, 60], true);
    const rightBase = kernel.Manifold.cube([50, 60, 60], true);
    const bridge = kernel.Manifold.cube([20, 6, 6], true);
    const left = leftBase.translate([-35, 0, 0]);
    const right = rightBase.translate([35, 0, 0]);
    const blocks = left.add(right);
    const source = blocks.add(bridge);
    const mesh = manifoldToTriangleMesh(source);
    leftBase.delete();
    rightBase.delete();
    bridge.delete();
    left.delete();
    right.delete();
    blocks.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const result = await generateModelSplitter(mesh, params);
    const baseline = await generateModelSplitter(mesh, {
      ...params,
      connectors: false,
    });

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expect(result.features.connectors.length).toBeGreaterThanOrEqual(1);
    expect(
      result.features.connectors.every(
        (connector) => connector.diameterMm <= 2 && connector.depthMm <= 4,
      ),
    ).toBe(true);
    expectClosedCenteredParts(result, 2);
    expectConnectorEnvelopesInsideSource(kernel, result, baseline);
  });

  it("finds a compact connector on an off-center irregular mating patch", async () => {
    const kernel = await loadManifold();
    const leftBase = kernel.Manifold.cube([50, 60, 60], true);
    const rightBase = kernel.Manifold.cube([50, 60, 60], true);
    const bridgeBase = kernel.Manifold.cube([20, 6, 6], true);
    const left = leftBase.translate([-35, 0, 0]);
    const right = rightBase.translate([35, 0, 0]);
    const bridge = bridgeBase.translate([0, 23, 7]);
    const blocks = left.add(right);
    const source = blocks.add(bridge);
    const mesh = manifoldToTriangleMesh(source);
    leftBase.delete();
    rightBase.delete();
    bridgeBase.delete();
    left.delete();
    right.delete();
    bridge.delete();
    blocks.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const result = await generateModelSplitter(mesh, params);

    expect(result.features.connectors.length).toBeGreaterThanOrEqual(1);
    expect(
      result.features.connectors.every(
        (connector) => connector.diameterMm <= 2,
      ),
    ).toBe(true);
    expect(
      result.features.connectors.some(
        (connector) => connector.centerMm[1] > 18 && connector.centerMm[2] > 2,
      ),
    ).toBe(true);
    expectClosedCenteredParts(result, 2);
  });

  it("connects a tiny occupied bridge instead of leaving only a glue face", async () => {
    const kernel = await loadManifold();
    const leftBase = kernel.Manifold.cube([50, 60, 60], true);
    const rightBase = kernel.Manifold.cube([50, 60, 60], true);
    const bridgeBase = kernel.Manifold.cube([20, 2, 2], true);
    const left = leftBase.translate([-35, 0, 0]);
    const right = rightBase.translate([35, 0, 0]);
    const bridge = bridgeBase.translate([0, 23, 7]);
    const blocks = left.add(right);
    const source = blocks.add(bridge);
    const mesh = manifoldToTriangleMesh(source);
    leftBase.delete();
    rightBase.delete();
    bridgeBase.delete();
    left.delete();
    right.delete();
    bridge.delete();
    blocks.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;

    const result = await generateModelSplitter(mesh, params);

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expectClosedCenteredParts(result, 2);
    expect(result.features.connectors).toHaveLength(1);
    expect(result.features.connectors[0]?.diameterMm).toBeLessThan(1);
    expect(result.parts.some((part) => part.metrics.volumeMm3 > 150_000)).toBe(
      true,
    );
  });
  it("moves an automatic plane to a nearby narrow neck without creating edge slivers", async () => {
    const kernel = await loadManifold();
    const leftBase = kernel.Manifold.cube([35, 60, 60], true);
    const rightBase = kernel.Manifold.cube([65, 60, 60], true);
    const bridgeBase = kernel.Manifold.cube([20, 6, 6], true);
    const left = leftBase.translate([-42.5, 0, 0]);
    const right = rightBase.translate([27.5, 0, 0]);
    const bridge = bridgeBase.translate([-15, 0, 0]);
    const blocks = left.add(right);
    const source = blocks.add(bridge);
    const mesh = manifoldToTriangleMesh(source);
    leftBase.delete();
    rightBase.delete();
    bridgeBase.delete();
    left.delete();
    right.delete();
    bridge.delete();
    blocks.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 90;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const smart = await generateModelSplitter(mesh, {
      ...params,
      splitStrategy: "smart",
    });
    const automatic = await generateModelSplitter(mesh, params);
    const centered = await generateModelSplitter(mesh, {
      ...params,
      splitStrategy: "center",
    });
    const smartPlane = smart.features.splitPlanes.find(
      (plane) => plane.axis === "x",
    );
    const automaticPlane = automatic.features.splitPlanes.find(
      (plane) => plane.axis === "x",
    );
    const centeredPlane = centered.features.splitPlanes.find(
      (plane) => plane.axis === "x",
    );

    expect(smart.features.gridCounts).toEqual([2, 1, 1]);
    expect(smartPlane?.positionMm).toBeLessThan(-5);
    expect(smartPlane?.positionMm).toBeGreaterThan(-25);
    expect(automaticPlane?.positionMm).toBeCloseTo(0);
    expect(centeredPlane?.positionMm).toBeCloseTo(0);
    expect(smart.features.splitPlan.allPartsFit).toBe(true);
    expectClosedCenteredParts(smart, 2);
  });

  it("keeps a head whole by moving a height split into the neck", async () => {
    const kernel = await loadManifold();
    const torsoBase = kernel.Manifold.cube([60, 50, 80], true);
    const neckBase = kernel.Manifold.cube([12, 12, 12], true);
    const headBase = kernel.Manifold.cube([42, 42, 42], true);
    const torso = torsoBase.translate([0, 0, -40]);
    const neck = neckBase.translate([0, 0, 6]);
    const head = headBase.translate([0, 0, 33]);
    const torsoAndNeck = torso.add(neck);
    const source = torsoAndNeck.add(head);
    const mesh = manifoldToTriangleMesh(source);
    torsoBase.delete();
    neckBase.delete();
    headBase.delete();
    torso.delete();
    neck.delete();
    head.delete();
    torsoAndNeck.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 100;
    params.printBedDepthMm = 100;
    params.printBedHeightMm = 110;
    const smart = await generateModelSplitter(mesh, {
      ...params,
      splitStrategy: "smart",
    });
    const automatic = await generateModelSplitter(mesh, params);
    const smartPlane = smart.features.splitPlanes.find(
      (plane) => plane.axis === "z",
    );
    const automaticPlane = automatic.features.splitPlanes.find(
      (plane) => plane.axis === "z",
    );

    expect(smart.features.gridCounts).toEqual([1, 1, 2]);
    expect(smartPlane?.positionMm).toBeGreaterThan(1);
    expect(smartPlane?.positionMm).toBeLessThan(11);
    expect(automaticPlane?.positionMm).toBeLessThan(0);
    expectClosedCenteredParts(smart, 2);
  });

  it("moves a balanced double-leg cut toward the sheltered pelvis transition", async () => {
    const kernel = await loadManifold();
    const leftLegBase = kernel.Manifold.cube([14, 20, 60], true);
    const rightLegBase = kernel.Manifold.cube([14, 20, 60], true);
    const pelvisBase = kernel.Manifold.cube([50, 25, 30], true);
    const leftLeg = leftLegBase.translate([-12, 0, 30]);
    const rightLeg = rightLegBase.translate([12, 0, 30]);
    const pelvis = pelvisBase.translate([0, 0, 70]);
    const legs = leftLeg.add(rightLeg);
    const source = legs.add(pelvis);
    const mesh = manifoldToTriangleMesh(source);
    leftLegBase.delete();
    rightLegBase.delete();
    pelvisBase.delete();
    leftLeg.delete();
    rightLeg.delete();
    pelvis.delete();
    legs.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 60;
    params.printBedDepthMm = 60;
    params.printBedHeightMm = 60;
    const smart = await generateModelSplitter(mesh, {
      ...params,
      splitStrategy: "smart",
    });
    const automatic = await generateModelSplitter(mesh, {
      ...params,
      splitStrategy: "automatic",
    });
    const smartPlane = smart.features.splitPlanes.find(
      (plane) => plane.axis === "z",
    );
    const automaticPlane = automatic.features.splitPlanes.find(
      (plane) => plane.axis === "z",
    );

    expect(smartPlane?.positionMm).toBeGreaterThan(50);
    expect(smartPlane?.positionMm).toBeLessThan(56);
    expect(automaticPlane?.positionMm).toBeCloseTo(42.5);
    expectClosedCenteredParts(smart, smart.parts.length);
  });

  it("separates a broad base and the head at compact anatomical transitions", async () => {
    const kernel = await loadManifold();
    const base = kernel.Manifold.cube([100, 12, 70], true);
    const legBase = kernel.Manifold.cube([16, 60, 20], true);
    const leftLeg = legBase.translate([-18, 35, 0]);
    const rightLeg = legBase.translate([18, 35, 0]);
    const torsoBase = kernel.Manifold.cube([60, 70, 35], true);
    const torso = torsoBase.translate([0, 90, 0]);
    const neckBase = kernel.Manifold.cube([14, 20, 14], true);
    const neck = neckBase.translate([0, 133, 0]);
    const headBase = kernel.Manifold.cube([42, 42, 42], true);
    const head = headBase.translate([0, 162, 0]);
    const source = kernel.Manifold.union([
      base,
      leftLeg,
      rightLeg,
      torso,
      neck,
      head,
    ]);
    const mesh = manifoldToTriangleMesh(source);
    for (const solid of [
      base,
      legBase,
      leftLeg,
      rightLeg,
      torsoBase,
      torso,
      neckBase,
      neck,
      headBase,
      head,
      source,
    ]) {
      solid.delete();
    }

    const params = createDefaultModelSplitterParams();
    params.splitStrategy = "smart";
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 220;
    params.printBedDepthMm = 220;
    params.printBedHeightMm = 220;
    const result = await generateModelSplitter(mesh, params);
    const anatomicalY = result.features.splitPlanes
      .filter(
        (plane) => plane.axis === "y" && plane.reason === "anatomical-joint",
      )
      .map((plane) => plane.positionMm);

    expect(anatomicalY.some((position) => position > 3 && position < 14)).toBe(
      true,
    );
    expect(
      anatomicalY.some((position) => position > 122 && position < 145),
    ).toBe(true);
    expect(result.features.gridCounts[1]).toBeGreaterThanOrEqual(3);
    expect(result.features.splitPlanes.length).toBeGreaterThan(0);
    for (const plane of result.features.splitPlanes) {
      expect(plane.smartQuality).toBeDefined();
      if (!plane.smartQuality) continue;
      expect(plane.smartQuality.seamExposureRatio).toBeGreaterThanOrEqual(0);
      expect(plane.smartQuality.seamExposureRatio).toBeLessThanOrEqual(1);
      expect(plane.smartQuality.geometryShelterRatio).toBeGreaterThanOrEqual(0);
      expect(plane.smartQuality.geometryShelterRatio).toBeLessThanOrEqual(1);
      expect(plane.smartQuality.supportRiskRatio).toBeGreaterThanOrEqual(0);
      expect(plane.smartQuality.supportRiskRatio).toBeLessThanOrEqual(1);
    }
    expect(
      result.features.splitPlanes.some(
        (plane) => (plane.smartQuality?.geometryShelterRatio ?? 0) > 0.15,
      ),
    ).toBe(true);
    expectClosedCenteredParts(result, result.features.partCount);
  });
  it("tilts a compact joint plane to follow a slanted local transition", async () => {
    const kernel = await loadManifold();
    const base = kernel.Manifold.cube([100, 12, 70], true);
    const legBase = kernel.Manifold.cube([16, 60, 20], true);
    const leftLeg = legBase.translate([-18, 35, 0]);
    const rightLeg = legBase.translate([18, 35, 0]);
    const torsoBase = kernel.Manifold.cube([60, 70, 35], true);
    const torso = torsoBase.translate([0, 90, 0]);
    const neckBase = kernel.Manifold.cylinder(28, 7, 7, 36, true);
    const neckAlongY = neckBase.rotate([-90, 0, 0]);
    const neckTilted = neckAlongY.rotate([0, 0, -19]);
    const neck = neckTilted.translate([4.6, 136.4, 0]);
    const headBase = kernel.Manifold.cube([42, 42, 42], true);
    const head = headBase.translate([12.7, 168, 0]);
    const source = kernel.Manifold.union([
      base,
      leftLeg,
      rightLeg,
      torso,
      neck,
      head,
    ]);
    const mesh = manifoldToTriangleMesh(source);
    for (const solid of [
      base,
      legBase,
      leftLeg,
      rightLeg,
      torsoBase,
      torso,
      neckBase,
      neckAlongY,
      neckTilted,
      neck,
      headBase,
      head,
      source,
    ]) {
      solid.delete();
    }

    const params = createDefaultModelSplitterParams();
    params.splitStrategy = "smart";
    params.engravedLabels = false;
    params.printBedWidthMm = 220;
    params.printBedDepthMm = 220;
    params.printBedHeightMm = 220;
    const result = await generateModelSplitter(mesh, params);
    const freeJoint = result.features.splitPlanes.find(
      (plane) =>
        plane.reason === "anatomical-joint" && (plane.tiltDeg ?? 0) > 5,
    );

    expect(freeJoint).toBeDefined();
    expect(freeJoint?.normal).toBeDefined();
    expect(freeJoint?.planeOffsetMm).toBeTypeOf("number");
    expect(freeJoint?.tiltDeg).toBeGreaterThanOrEqual(10);
    expect(freeJoint?.tiltDeg).toBeLessThanOrEqual(26);
    expect(
      result.features.connectors.some(
        (connector) =>
          connector.axis === freeJoint?.axis &&
          connector.normal !== undefined &&
          connector.normal.some(
            (component, dimension) =>
              dimension !==
                ({ x: 0, y: 1, z: 2 } as const)[connector.axis] &&
              Math.abs(component) > 0.1,
          ),
      ),
    ).toBe(true);
    expectClosedCenteredParts(result, result.features.partCount);
  });
  it("prefers a compact butt cut over a tall flat body slice", async () => {
    const kernel = await loadManifold();
    const bodyBase = kernel.Manifold.cube([40, 42, 100], true);
    const tallFinBase = kernel.Manifold.cube([5, 14, 100], true);
    const buttBase = kernel.Manifold.cube([30, 22, 30], true);
    const body = bodyBase.translate([0, -10, 0]);
    const tallFin = tallFinBase.translate([0, 16, 0]);
    const butt = buttBase.translate([0, 20, -20]);
    const bodyWithFin = body.add(tallFin);
    const source = bodyWithFin.add(butt);
    const mesh = manifoldToTriangleMesh(source);
    bodyBase.delete();
    tallFinBase.delete();
    buttBase.delete();
    body.delete();
    tallFin.delete();
    butt.delete();
    bodyWithFin.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 120;
    params.printBedDepthMm = 60;
    params.printBedHeightMm = 60;
    const smart = await generateModelSplitter(mesh, {
      ...params,
      splitStrategy: "smart",
    });
    const automatic = await generateModelSplitter(mesh, {
      ...params,
      splitStrategy: "automatic",
    });
    const smartPlane = smart.features.splitPlanes.find(
      (plane) => plane.axis === "y",
    );
    const automaticPlane = automatic.features.splitPlanes.find(
      (plane) => plane.axis === "z",
    );

    expect(smart.features.gridCounts).toEqual([1, 2, 1]);
    expect(automatic.features.gridCounts).toEqual([1, 1, 2]);
    expect(smartPlane?.positionMm).toBeGreaterThan(22);
    expect(automaticPlane?.positionMm).toBeCloseTo(0);
    expectClosedCenteredParts(smart, smart.parts.length);
  });

  it("adds compact shoulder and neck joint cuts to an already multi-part figure", async () => {
    const kernel = await loadManifold();
    const torso = kernel.Manifold.cube([70, 120, 50], true);
    const neckBase = kernel.Manifold.cube([18, 16, 18], true);
    const headBase = kernel.Manifold.cube([45, 45, 40], true);
    const armBase = kernel.Manifold.cube([70, 20, 20], true);
    const neck = neckBase.translate([0, 68, 0]);
    const head = headBase.translate([0, 98.5, 0]);
    const leftArm = armBase.translate([-65, 25, 0]);
    const rightArm = armBase.translate([65, 25, 0]);
    const source = kernel.Manifold.union([
      torso,
      neck,
      head,
      leftArm,
      rightArm,
    ]);
    const mesh = manifoldToTriangleMesh(source);
    for (const solid of [
      torso,
      neckBase,
      headBase,
      armBase,
      neck,
      head,
      leftArm,
      rightArm,
      source,
    ])
      solid.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.splitStrategy = "smart";
    params.printBedWidthMm = 110;
    params.printBedDepthMm = 90;
    params.printBedHeightMm = 100;
    const result = await generateModelSplitter(mesh, params);
    const xPlanes = result.features.splitPlanes
      .filter((plane) => plane.axis === "x")
      .map((plane) => plane.positionMm);
    const yPlanes = result.features.splitPlanes
      .filter((plane) => plane.axis === "y")
      .map((plane) => plane.positionMm);

    expect(xPlanes.some((position) => position < -28 && position > -45)).toBe(
      true,
    );
    expect(xPlanes.some((position) => position > 28 && position < 45)).toBe(
      true,
    );
    expect(yPlanes.some((position) => position > 55 && position < 82)).toBe(
      true,
    );
    expectClosedCenteredParts(result, result.features.partCount);
  });
  it("moves a smart plane away from a tiny secondary contour that would create a sliver", async () => {
    const kernel = await loadManifold();
    const leftBase = kernel.Manifold.cube([45, 40, 40], true);
    const rightBase = kernel.Manifold.cube([45, 40, 40], true);
    const bridgeBase = kernel.Manifold.cube([30, 8, 8], true);
    const sliverBase = kernel.Manifold.cube([61, 1, 1], true);
    const left = leftBase.translate([-37.5, 0, 0]);
    const right = rightBase.translate([37.5, 0, 0]);
    const bridge = bridgeBase.translate([0, 0, 0]);
    const sliver = sliverBase.translate([29.5, 25, 0]);
    const blocks = left.add(right);
    const body = blocks.add(bridge);
    const source = body.add(sliver);
    const mesh = manifoldToTriangleMesh(source);
    leftBase.delete();
    rightBase.delete();
    bridgeBase.delete();
    sliverBase.delete();
    left.delete();
    right.delete();
    bridge.delete();
    sliver.delete();
    blocks.delete();
    body.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 90;
    params.printBedDepthMm = 100;
    params.printBedHeightMm = 100;
    const smart = await generateModelSplitter(mesh, {
      ...params,
      splitStrategy: "smart",
    });
    const smartPlane = smart.features.splitPlanes.find(
      (plane) => plane.axis === "x",
    );

    expect(smart.features.gridCounts).toEqual([2, 1, 1]);
    expect(smartPlane?.positionMm).toBeLessThan(-1);
    expectClosedCenteredParts(smart, 2);
  });

  it("keeps a small floating foot detail whole across several smart planes", async () => {
    const kernel = await loadManifold();
    const base = kernel.Manifold.cube([120, 120, 20], true);
    const foot = kernel.Manifold.cube([24, 24, 2], true).translate([0, 0, 20]);
    const source = base.add(foot);
    const mesh = manifoldToTriangleMesh(source);
    base.delete();
    foot.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.splitStrategy = "smart";
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const result = await generateModelSplitter(mesh, params);

    expect(result.features.gridCounts).toEqual([2, 2, 1]);
    expectClosedCenteredParts(result, 4);
    const componentSizes: Array<[number, number, number]> = [];
    for (const part of result.parts) {
      const centered = triangleMeshToManifold(kernel, part.mesh);
      const assembled = centered.translate(part.assemblyCenterMm);
      const components = assembled.decompose();
      for (const component of components) {
        const componentBounds = component.boundingBox();
        componentSizes.push(
          [0, 1, 2].map(
            (axis) => componentBounds.max[axis] - componentBounds.min[axis],
          ) as [number, number, number],
        );
        component.delete();
      }
      assembled.delete();
      centered.delete();
    }
    const thinFootComponents = componentSizes.filter(
      (size) => size[2] <= 2.1,
    );
    expect(thinFootComponents).toHaveLength(1);
    expect(thinFootComponents[0]?.[0]).toBeCloseTo(24, 1);
    expect(thinFootComponents[0]?.[1]).toBeCloseTo(24, 1);
  });

  it("preserves hollow contours without adding stacked cut seals", async () => {
    const kernel = await loadManifold();
    const outer = kernel.Manifold.cube([120, 80, 80], true);
    const tunnel = kernel.Manifold.cube([140, 20, 20], true);
    const hollowBeam = outer.subtract(tunnel);
    const sourceVolumeMm3 = hollowBeam.volume();
    const mesh = manifoldToTriangleMesh(hollowBeam);
    outer.delete();
    tunnel.delete();
    hollowBeam.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.splitStrategy = "smart";
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 100;
    params.printBedHeightMm = 100;
    const result = await generateModelSplitter(mesh, params);

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expectClosedCenteredParts(result, 2);
    expect(
      result.parts.reduce((total, part) => total + part.metrics.volumeMm3, 0),
    ).toBeCloseTo(sourceVolumeMm3, 3);
  });

  it("adds a mating connector for every disconnected component crossing a cut", async () => {
    const kernel = await loadManifold();
    const beam = kernel.Manifold.cube([120, 18, 18], true);
    const lower = beam.translate([0, -22, 0]);
    const upper = beam.translate([0, 22, 0]);
    const source = lower.add(upper);
    const mesh = manifoldToTriangleMesh(source);
    beam.delete();
    lower.delete();
    upper.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const result = await generateModelSplitter(mesh, params);

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expectClosedCenteredParts(result, 2);
    expect(result.features.connectors).toHaveLength(2);
    expect(
      result.features.connectors.some((connector) => connector.centerMm[1] < 0),
    ).toBe(true);
    expect(
      result.features.connectors.some((connector) => connector.centerMm[1] > 0),
    ).toBe(true);
    expect(
      new Set(
        result.features.connectors.map((connector) => connector.malePartId),
      ).size,
    ).toBe(1);
    expect(
      new Set(
        result.features.connectors.map((connector) => connector.femalePartId),
      ).size,
    ).toBe(1);
  });
  it("gives a tiny disconnected cut detail its own connector pair", async () => {
    const kernel = await loadManifold();
    const body = kernel.Manifold.cube([80, 40, 40], true);
    const detail = kernel.Manifold.cube([30, 2, 2], true).translate([0, 30, 0]);
    const source = body.add(detail);
    const mesh = manifoldToTriangleMesh(source);
    body.delete();
    detail.delete();
    source.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.splitStrategy = "center";
    params.printBedWidthMm = 50;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const result = await generateModelSplitter(mesh, params);

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expectClosedCenteredParts(result, 2);
    expect(result.features.connectors).toHaveLength(2);
    expect(
      result.features.connectors.some(
        (connector) => connector.diameterMm < 1 && connector.style === "hex",
      ),
    ).toBe(true);

    const componentSizes: Array<[number, number, number]> = [];
    for (const part of result.parts) {
      const solid = triangleMeshToManifold(kernel, part.mesh);
      const components = solid.decompose();
      for (const component of components) {
        const bounds = component.boundingBox();
        componentSizes.push(
          [0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis]) as [
            number,
            number,
            number,
          ],
        );
        component.delete();
      }
      solid.delete();
    }
    const thinDetails = componentSizes.filter(
      (size) => size[1] <= 2.1 && size[2] <= 2.1,
    );
    expect(thinDetails).toHaveLength(2);
    expect(
      thinDetails.reduce((total, size) => total + size[0], 0),
    ).toBeGreaterThanOrEqual(30);
    expect(
      thinDetails.reduce((total, size) => total + size[0], 0),
    ).toBeLessThan(32);
  });

  it("adds a micro hex connector when a tiny detail is the entire interface", async () => {
    const kernel = await loadManifold();
    const beam = kernel.Manifold.cube([80, 2, 2], true);
    const mesh = manifoldToTriangleMesh(beam);
    beam.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.splitStrategy = "center";
    params.printBedWidthMm = 50;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const result = await generateModelSplitter(mesh, params);

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expectClosedCenteredParts(result, 2);
    expect(result.features.connectors).toHaveLength(1);
    expect(result.features.connectors[0]).toMatchObject({ style: "hex" });
    expect(result.features.connectors[0]?.diameterMm).toBeLessThan(1);
    expect(result.parts.every((part) => part.mesh.indices.length > 0)).toBe(
      true,
    );
  });
  it("supports arbitrary three-segment axes and stable grid names", async () => {
    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 50;
    params.printBedDepthMm = 50;
    params.printBedHeightMm = 50;
    const result = await generateModelSplitter(indexedCube(120), params);
    expectClosedCenteredParts(result, 27);
    expect(result.features.gridCounts).toEqual([3, 3, 3]);
    expect(result.parts[0].id).toBe("x01_y01_z01");
    expect(result.parts.at(-1)?.id).toBe("x03_y03_z03");
    expect(result.features.splitPlanes).toHaveLength(6);
  });

  it("keeps all calculated planes movable and still emits watertight parts", async () => {
    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    params.splitStrategy = "manual";
    params.manualSplitPlaneMm["x-1"] = 10;
    params.manualSplitPlaneMm["y-1"] = -5;
    const result = await generateModelSplitter(indexedCube(120), params);
    expectClosedCenteredParts(result, 8);
    expect(
      result.features.splitPlanes.find((plane) => plane.id === "x-1")
        ?.positionMm,
    ).toBeCloseTo(8);
    expect(
      result.features.splitPlanes.find((plane) => plane.id === "y-1")
        ?.positionMm,
    ).toBeCloseTo(-5);
  });

  it("skips geometrically empty cells in an automatic sparse grid", async () => {
    const kernel = await loadManifold();
    const base = kernel.Manifold.cube([150, 80, 18], true);
    const diagonal = base.rotate([0, 0, 45]);
    const mesh = manifoldToTriangleMesh(diagonal);
    base.delete();
    diagonal.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.connectorSpacingMm = 20;
    params.printBedWidthMm = 50;
    params.printBedDepthMm = 50;
    params.printBedHeightMm = 50;
    const result = await generateModelSplitter(mesh, params);
    const baseline = await generateModelSplitter(mesh, {
      ...params,
      connectors: false,
    });

    expect(result.features.gridCounts).toEqual([4, 4, 1]);
    expect(result.features.splitPlan.partCount).toBe(16);
    expect(result.features.partCount).toBeLessThan(16);
    expect(result.features.connectorPolicy.interfaceCount).toBeLessThan(24);
    expect(result.features.connectorPolicy.maxPerInterface).toBeGreaterThan(9);
    expect(result.features.connectorPolicy.maxPerInterface).toBeLessThanOrEqual(
      64,
    );
    expect(result.features.connectors.length).toBeGreaterThanOrEqual(
      result.features.connectorPolicy.interfaceCount,
    );

    expectClosedCenteredParts(result, result.features.partCount);
    expect(result.features.splitPlan.allPartsFit).toBe(true);
    expectConnectorEnvelopesInsideSource(kernel, result, baseline);
  });

  it("creates a watertight flexible dovetail snap-fit pair", async () => {
    const kernel = await loadManifold();
    const solid = kernel.Manifold.cube([180, 100, 100], true);
    const mesh = manifoldToTriangleMesh(solid);
    solid.delete();

    const params = createDefaultModelSplitterParams();
    params.connectorStyle = "dovetail";
    params.engravedLabels = false;
    params.printBedWidthMm = 110;
    params.printBedDepthMm = 120;
    params.printBedHeightMm = 120;
    const result = await generateModelSplitter(mesh, params);
    const baseline = await generateModelSplitter(mesh, {
      ...params,
      connectors: false,
    });

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expect(result.features.connectors).toHaveLength(1);
    expect(result.features.connectors[0]).toMatchObject({ style: "dovetail" });
    expectClosedCenteredParts(result, 2);
    expectConnectorEnvelopesInsideSource(kernel, result, baseline);
  });
  it("uses one compact area-scaled connector when it is sufficient", async () => {
    const kernel = await loadManifold();
    const solid = kernel.Manifold.cube([180, 100, 100], true);
    const mesh = manifoldToTriangleMesh(solid);
    solid.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.connectorSpacingMm = 20;
    params.printBedWidthMm = 110;
    params.printBedDepthMm = 120;
    params.printBedHeightMm = 120;
    const result = await generateModelSplitter(mesh, params);
    const baseline = await generateModelSplitter(mesh, {
      ...params,
      connectors: false,
    });

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expect(result.features.connectorPolicy.maxPerInterface).toBe(64);
    expect(result.features.connectors).toHaveLength(1);
    expect(result.features.connectors[0]).toMatchObject({
      diameterMm: 35,
      style: "hex",
    });
    const connector = result.features.connectors[0];
    expect(connector).toBeDefined();
    if (!connector) throw new Error("Expected a connector report.");
    const resultVolumes = new Map(
      result.parts.map((part) => [part.id, part.metrics.volumeMm3]),
    );
    const baselineVolumes = new Map(
      baseline.parts.map((part) => [part.id, part.metrics.volumeMm3]),
    );
    expect(resultVolumes.get(connector.malePartId)).toBeGreaterThan(
      baselineVolumes.get(connector.malePartId) ?? Infinity,
    );
    expect(resultVolumes.get(connector.femalePartId)).toBeLessThan(
      baselineVolumes.get(connector.femalePartId) ?? -Infinity,
    );
    const femaleVolumeRemoved =
      (baselineVolumes.get(connector.femalePartId) ?? 0) -
      (resultVolumes.get(connector.femalePartId) ?? 0);
    const socketDiameter = connector.diameterMm + connector.clearanceMm * 2;
    const hexCrossSectionArea = (3 * Math.sqrt(3) * socketDiameter ** 2) / 8;
    const expectedSocketVolume =
      hexCrossSectionArea * (connector.depthMm + connector.gluePocketMm + 0.12);
    expect(femaleVolumeRemoved).toBeGreaterThan(expectedSocketVolume * 0.8);
    const malePartIds = new Set(
      result.features.connectors.map((connector) => connector.malePartId),
    );
    const femalePartIds = new Set(
      result.features.connectors.map((connector) => connector.femalePartId),
    );
    expect(malePartIds).toHaveLength(1);
    expect(femalePartIds).toHaveLength(1);
    expect([...malePartIds][0]).not.toBe([...femalePartIds][0]);
    expectClosedCenteredParts(result, 2);
  });
  it("prefers one protected large connector over many small connectors", async () => {
    const kernel = await loadManifold();
    const solid = kernel.Manifold.cube([1700, 400, 400], true);
    const mesh = manifoldToTriangleMesh(solid);
    solid.delete();

    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.printBedWidthMm = 1000;
    params.printBedDepthMm = 500;
    params.printBedHeightMm = 500;
    const result = await generateModelSplitter(mesh, params);
    const baseline = await generateModelSplitter(mesh, {
      ...params,
      connectors: false,
    });

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expect(result.features.connectors).toHaveLength(1);
    expect(
      result.features.connectors.every(
        (connector) =>
          connector.style === "hex" &&
          connector.diameterMm <= 120 &&
          connector.depthMm === 80,
      ),
    ).toBe(true);
    expectClosedCenteredParts(result, 2);
    expectConnectorEnvelopesInsideSource(kernel, result, baseline);
  });

  it("fills internal cavity contours on both sides of every model cut", async () => {
    const kernel = await loadManifold();
    const outer = kernel.Manifold.cube([120, 40, 40], true);
    const inner = kernel.Manifold.cube([100, 20, 20], true);
    const hollow = outer.subtract(inner);
    const mesh = manifoldToTriangleMesh(hollow);
    outer.delete();
    inner.delete();
    hollow.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.splitStrategy = "center";
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 100;
    params.printBedHeightMm = 100;
    const result = await generateModelSplitter(mesh, params);

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expectClosedCenteredParts(result, 2);
    const plane = result.features.splitPlanes.find(
      (candidate) => candidate.axis === "x",
    );
    expect(plane).toBeDefined();
    if (!plane) return;
    for (const part of result.parts) {
      const centered = triangleMeshToManifold(kernel, part.mesh);
      const assembled = centered.translate(part.assemblyCenterMm);
      const side = part.gridIndex[0] === 0 ? -1 : 1;
      const probe = kernel.Manifold.cube([0.2, 4, 4], true).translate([
        plane.positionMm + side * 0.2,
        0,
        0,
      ]);
      const filled = assembled.intersect(probe);
      expect(filled.volume()).toBeCloseTo(probe.volume(), 3);
      filled.delete();
      probe.delete();
      assembled.delete();
      centered.delete();
    }
  });

  it("unions overlapping imported components before creating split caps", async () => {
    const kernel = await loadManifold();
    const leftBase = kernel.Manifold.cube([100, 80, 80], true);
    const rightBase = kernel.Manifold.cube([100, 80, 80], true);
    const left = leftBase.translate([-20, 0, 0]);
    const right = rightBase.translate([20, 0, 0]);
    const overlapping = kernel.Manifold.compose([left, right]);
    const expected = kernel.Manifold.union([left, right]);
    const mesh = manifoldToTriangleMesh(overlapping);
    const expectedVolume = expected.volume();
    leftBase.delete();
    rightBase.delete();
    left.delete();
    right.delete();
    overlapping.delete();
    expected.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 90;
    params.printBedDepthMm = 100;
    params.printBedHeightMm = 100;
    const result = await generateModelSplitter(mesh, params);

    expect(result.features.gridCounts).toEqual([2, 1, 1]);
    expectClosedCenteredParts(result, 2);
    expect(
      result.parts.reduce((sum, part) => sum + part.metrics.volumeMm3, 0),
    ).toBeCloseTo(expectedVolume, 2);
  });

  it("handles curved and asymmetric closed solids deterministically", async () => {
    const kernel = await loadManifold();
    const cylinderBase = kernel.Manifold.cylinder(80, 30, 30, 48, true);
    const cylinder = cylinderBase.rotate([-90, 0, 0]);
    const lobeBase = kernel.Manifold.cube([80, 50, 40], true);
    const lobe = lobeBase.translate([18, 0, 0]);
    const asymmetric = cylinder.add(lobe);
    const mesh = manifoldToTriangleMesh(asymmetric);
    cylinderBase.delete();
    cylinder.delete();
    lobeBase.delete();
    lobe.delete();
    asymmetric.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 60;
    params.printBedDepthMm = 60;
    params.printBedHeightMm = 60;
    const first = await generateModelSplitter(mesh, params);
    const second = await generateModelSplitter(mesh, params);
    expect(first.features.gridCounts).toEqual(second.features.gridCounts);
    expect(first.parts.map((part) => part.id)).toEqual(
      second.parts.map((part) => part.id),
    );
    expectClosedCenteredParts(first, first.features.partCount);
  });

  it("generates a watertight 5 x 6 x 6 large job in batches", async () => {
    const kernel = await loadManifold();
    const solid = kernel.Manifold.cube([200, 250, 250], true);
    const mesh = manifoldToTriangleMesh(solid);
    solid.delete();

    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 50;
    params.printBedDepthMm = 50;
    params.printBedHeightMm = 50;
    const progress: string[] = [];
    const result = await generateModelSplitter(mesh, params, {
      onProgress: ({ message }) => progress.push(message),
    });
    expectClosedCenteredParts(result, 180);
    expect(result.features.gridCounts).toEqual([5, 6, 6]);
    expect(result.features.connectorPolicy).toEqual({
      interfaceCount: 444,
      maxPerInterface: 2,
      totalBudget: 1_200,
    });
    expect(
      progress.some((message) => message.includes("Mesh batch 176/180")),
    ).toBe(true);
  });

  it("rejects open meshes and automatic plans above the browser safety limit", async () => {
    await expect(
      generateModelSplitter(openCube(), createDefaultModelSplitterParams()),
    ).rejects.toMatchObject<ModelSplitterError>({
      code: "INVALID_SOURCE_MESH",
    });

    const params = createDefaultModelSplitterParams();
    params.printBedWidthMm = 50;
    params.printBedDepthMm = 50;
    params.printBedHeightMm = 50;
    await expect(
      generateModelSplitter(indexedCube(500), params),
    ).rejects.toMatchObject<ModelSplitterError>({
      code: "PART_LIMIT_EXCEEDED",
    });
  });
});

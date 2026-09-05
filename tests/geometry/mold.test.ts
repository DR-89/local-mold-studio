import { describe, expect, it } from "vitest";
import { createDefaultParams, setPourGateCount } from "../../src/domain/mold";
import {
  generateTwoPartMold,
  MoldGenerationError,
  registrationComponentCountsAreSafe,
  transformPreparedSourceForPlacement,
} from "../../src/geometry/mold";
import {
  placeMeshOnPlate,
  type ModelPlacement,
} from "../../src/domain/placement";
import {
  manifoldToTriangleMesh,
  splitMeshIntoConnectedComponents,
  triangleMeshToManifold,
} from "../../src/geometry/kernel/adapter";
import { loadManifold } from "../../src/geometry/kernel/loader";
import { indexedCube, openCube } from "../../src/testing/fixtures";
import {
  CONNECTOR_MIN_WEB_MM,
  planMultiSideSegmentConnectorSites,
} from "../../src/geometry/mold/generate";
import type { TriangleMeshData } from "../../src/workers/protocol";

function restoreMoldPartToAssembly(
  mesh: TriangleMeshData,
  side: "front" | "back",
  bounds: { min: [number, number, number]; max: [number, number, number] },
): TriangleMeshData {
  const positions = new Float32Array(mesh.positions.length);
  for (let index = 0; index < positions.length; index += 3) {
    const printX = mesh.positions[index]!;
    const printY = mesh.positions[index + 1]!;
    const printZ = mesh.positions[index + 2]!;
    positions[index] =
      side === "front" ? bounds.max[0] - printY : bounds.min[0] + printY;
    positions[index + 1] =
      side === "front" ? bounds.min[1] + printX : bounds.max[1] - printX;
    positions[index + 2] = bounds.min[2] + printZ;
  }
  return { positions, indices: mesh.indices };
}

describe("two-part box mold CSG", () => {
  it("rejects only connector-created component increases", () => {
    expect(registrationComponentCountsAreSafe([1, 2], [1, 2])).toBe(true);
    expect(registrationComponentCountsAreSafe([2, 2], [1, 2])).toBe(true);
    expect(registrationComponentCountsAreSafe([1, 2], [2, 2])).toBe(false);
  });
  it("plans every segment interface across three distinct face sides", () => {
    const sites = planMultiSideSegmentConnectorSites(0, 40, 0, 15, 5, 1.4);
    expect(sites).toHaveLength(5);
    expect(new Set(sites.map((site) => site.side))).toEqual(
      new Set(["outer", "minimum", "maximum", "inner"]),
    );
    expect(sites.filter((site) => site.side === "outer")).toHaveLength(2);
    expect(sites[0]!.transverse).toBeCloseTo(2.5, 6);
    expect(sites[1]!.transverse).toBeCloseTo(2.5, 6);
    expect(sites[2]!.transverse).toBeCloseTo(7.5, 6);
    expect(sites[3]!.transverse).toBeCloseTo(7.5, 6);
    expect(sites[2]!.transverse - sites[0]!.transverse).toBeGreaterThan(4);
    expect(sites[3]!.transverse - sites[1]!.transverse).toBeGreaterThan(4);
    expect(sites[4]).toMatchObject({
      longitudinal: 20,
      transverse: 12.5,
      side: "inner",
    });

    const lowerLane = planMultiSideSegmentConnectorSites(
      0,
      40,
      0,
      15,
      5,
      1.4,
      -1,
    );
    const upperLane = planMultiSideSegmentConnectorSites(
      0,
      40,
      0,
      15,
      5,
      1.4,
      1,
    );
    const femaleDiameter = 1.4 * 2;
    const laneWeb =
      upperLane[2]!.transverse -
      lowerLane[2]!.transverse -
      femaleDiameter;
    expect(laneWeb).toBeCloseTo(CONNECTOR_MIN_WEB_MM, 6);
  });

  it("creates two closed printable cube mold halves with all default features", async () => {
    const params = createDefaultParams();
    const result = await generateTwoPartMold(indexedCube(20), params);

    expect(result.frontMetrics.closed).toBe(true);
    expect(result.backMetrics.closed).toBe(true);
    expect(result.frontMetrics.boundaryEdges).toBe(0);
    expect(result.backMetrics.boundaryEdges).toBe(0);
    expect(result.frontMetrics.volumeMm3).toBeGreaterThan(0);
    expect(result.backMetrics.volumeMm3).toBeGreaterThan(0);
    expect(result.frontMetrics.bedTriangles).toBeGreaterThan(0);
    expect(result.backMetrics.bedTriangles).toBeGreaterThan(0);
    expect(result.frontMetrics.bounds.min[1]).toBeCloseTo(0, 5);
    expect(result.backMetrics.bounds.min[1]).toBeCloseTo(0, 5);
    expect(result.features.cavityVolumeMm3).toBeCloseTo(8_000, 3);
    expect(result.features.materialEstimate.filling.estimatedMassG).toBeCloseTo(
      7.2,
      6,
    );
    expect(result.features.materialEstimate.filament.estimatedMassG).toBeGreaterThan(0);
    expect(result.features.gates).toHaveLength(1);
    expect(result.features.registration.count).toBe(6);
    expect(result.features.registration).toMatchObject({
      style: "hex",
      widthAcrossFlatsMm: params.segmentConnectorWidthMm,
      pocketWidthAcrossFlatsMm:
        params.segmentConnectorWidthMm + params.fitClearanceMm * 2,
      depthMm: params.segmentConnectorDepthMm,
      clearanceMm: params.fitClearanceMm,
    });
    expect(result.features.rubberBandGrooves.count).toBe(2);
    expect(result.features.pryPockets.count).toBe(2);
    expect(result.features.estimatedMinimumWallMm).toBeGreaterThan(0.5);
    expect(result.features.wallSampleCount).toBeGreaterThan(0);

    const kernel = await loadManifold();
    const frontSolid = triangleMeshToManifold(kernel, result.front);
    const backSolid = triangleMeshToManifold(kernel, result.back);
    const frontComponents = frontSolid.decompose();
    const backComponents = backSolid.decompose();
    expect(frontComponents).toHaveLength(1);
    expect(backComponents).toHaveLength(1);

    const frontAssembly = triangleMeshToManifold(
      kernel,
      restoreMoldPartToAssembly(
        result.front,
        "front",
        result.features.outerBounds,
      ),
    );
    const backAssembly = triangleMeshToManifold(
      kernel,
      restoreMoldPartToAssembly(
        result.back,
        "back",
        result.features.outerBounds,
      ),
    );
    const probeGap = 0.75;
    const probeDepth = params.segmentConnectorDepthMm - probeGap;
    const bounds = result.features.outerBounds;
    const probeSize: [number, number, number] = [
      probeDepth,
      bounds.max[1] - bounds.min[1] + 2,
      bounds.max[2] - bounds.min[2] + 2,
    ];
    const probeCenterY = (bounds.min[1] + bounds.max[1]) / 2;
    const probeCenterZ = (bounds.min[2] + bounds.max[2]) / 2;
    const frontPinProbe = kernel.Manifold.cube(probeSize, true).translate([
      result.features.seamXMm - probeGap - probeDepth / 2,
      probeCenterY,
      probeCenterZ,
    ]);
    const backPinProbe = kernel.Manifold.cube(probeSize, true).translate([
      result.features.seamXMm + probeGap + probeDepth / 2,
      probeCenterY,
      probeCenterZ,
    ]);
    const frontPinVolume = frontAssembly.intersect(frontPinProbe);
    const backPinVolume = backAssembly.intersect(backPinProbe);
    expect(frontPinVolume.volume()).toBeGreaterThan(1);
    expect(backPinVolume.volume()).toBeGreaterThan(1);
    frontPinVolume.delete();
    backPinVolume.delete();
    frontPinProbe.delete();
    backPinProbe.delete();
    frontAssembly.delete();
    backAssembly.delete();
    frontComponents.forEach((part) => part.delete());
    backComponents.forEach((part) => part.delete());
    frontSolid.delete();
    backSolid.delete();
  });

  it("applies the shared hex width and insertion depth to the inner seam connectors", async () => {
    const compact = await generateTwoPartMold(indexedCube(20), {
      ...createDefaultParams(),
      segmentConnectorWidthMm: 1.5,
      segmentConnectorDepthMm: 2,
    });
    const large = await generateTwoPartMold(indexedCube(20), {
      ...createDefaultParams(),
      segmentConnectorWidthMm: 2.5,
      segmentConnectorDepthMm: 5,
    });

    expect(compact.features.registration).toMatchObject({
      style: "hex",
      widthAcrossFlatsMm: 1.5,
      pocketWidthAcrossFlatsMm: 1.9,
      depthMm: 2,
    });
    expect(large.features.registration).toMatchObject({
      style: "hex",
      widthAcrossFlatsMm: 2.5,
      pocketWidthAcrossFlatsMm: 2.9,
      depthMm: 5,
    });
    expect(
      large.frontMetrics.volumeMm3 + large.backMetrics.volumeMm3,
    ).not.toBeCloseTo(
      compact.frontMetrics.volumeMm3 + compact.backMetrics.volumeMm3,
      5,
    );
    for (const part of [...compact.parts, ...large.parts]) {
      expect(part.metrics.closed).toBe(true);
      expect(part.metrics.nonManifoldEdges).toBe(0);
    }
  });

  it("moves seam connectors completely clear of a centered pour channel", async () => {
    const params = createDefaultParams();
    params.pourGates = [
      {
        id: "center-gate",
        diameterMm: 12,
        xMm: 0,
        zMm: 0,
        placement: "manual",
      },
    ];
    const result = await generateTwoPartMold(indexedCube(20), params);
    const gate = result.features.gates[0]!;
    const kernel = await loadManifold();
    const frontAssembly = triangleMeshToManifold(
      kernel,
      restoreMoldPartToAssembly(
        result.front,
        "front",
        result.features.outerBounds,
      ),
    );
    const backAssembly = triangleMeshToManifold(
      kernel,
      restoreMoldPartToAssembly(
        result.back,
        "back",
        result.features.outerBounds,
      ),
    );
    const channelBottom = gate.surfaceYMm - 0.5;
    const channelHeight = result.features.outerBounds.max[1] - channelBottom;
    const channelSource = kernel.Manifold.cylinder(
      channelHeight,
      gate.diameterMm / 2,
      gate.diameterMm / 2,
      32,
      true,
    );
    const channelRotated = channelSource.rotate([-90, 0, 0]);
    const channel = channelRotated.translate([
      gate.centerXMm,
      channelBottom + channelHeight / 2,
      gate.centerZMm,
    ]);
    channelSource.delete();
    channelRotated.delete();
    const frontObstruction = frontAssembly.intersect(channel);
    const backObstruction = backAssembly.intersect(channel);
    try {
      expect(frontObstruction.volume()).toBeLessThanOrEqual(1e-5);
      expect(backObstruction.volume()).toBeLessThanOrEqual(1e-5);
      expect(result.features.registration.count).toBe(6);
    } finally {
      frontObstruction.delete();
      backObstruction.delete();
      channel.delete();
      frontAssembly.delete();
      backAssembly.delete();
    }
  });

  it("reuses the imported source solid after model placement", async () => {
    const kernel = await loadManifold();
    const mesh = indexedCube(20);
    const cachedSource = triangleMeshToManifold(kernel, mesh);
    const placement: ModelPlacement = {
      positionMm: [7, 3, -4],
      rotationDeg: [90, 0, 90],
    };
    const placedMesh = placeMeshOnPlate(mesh, placement);
    const baseline = await generateTwoPartMold(
      placedMesh,
      createDefaultParams(),
    );
    const cached = await generateTwoPartMold(
      placedMesh,
      createDefaultParams(),
      {
        preparedSourceFactory: () =>
          transformPreparedSourceForPlacement(cachedSource, placement),
      },
    );

    expect(cached.frontMetrics.bounds).toEqual(baseline.frontMetrics.bounds);
    expect(cached.backMetrics.bounds).toEqual(baseline.backMetrics.bounds);
    expect(cached.frontMetrics.volumeMm3).toBeCloseTo(
      baseline.frontMetrics.volumeMm3,
      3,
    );
    expect(cached.backMetrics.volumeMm3).toBeCloseTo(
      baseline.backMetrics.volumeMm3,
      3,
    );
    cachedSource.delete();
  });

  it("works for a cylinder and an asymmetric generated solid", async () => {
    const kernel = await loadManifold();
    const cylinder = kernel.Manifold.cylinder(28, 9, 9, 48, true);
    const base = kernel.Manifold.cube([34, 22, 18], true);
    const tower = kernel.Manifold.cylinder(24, 5, 7, 48, true).translate([
      7, 0, 8,
    ]);
    const asymmetric = base.add(tower);
    const cylinderMesh = manifoldToTriangleMesh(cylinder);
    const asymmetricMesh = manifoldToTriangleMesh(asymmetric);
    cylinder.delete();
    asymmetric.delete();
    tower.delete();
    base.delete();

    const cylinderParams = createDefaultParams("resin");
    cylinderParams.seamOffsetMm = 0;
    const asymmetricParams = createDefaultParams("plaster");
    asymmetricParams.seamOffsetMm = 1;

    const cylinderMold = await generateTwoPartMold(
      cylinderMesh,
      cylinderParams,
    );
    const asymmetricMold = await generateTwoPartMold(
      asymmetricMesh,
      asymmetricParams,
    );

    expect(cylinderMold.frontMetrics.closed).toBe(true);
    expect(cylinderMold.backMetrics.closed).toBe(true);
    expect(asymmetricMold.frontMetrics.closed).toBe(true);
    expect(asymmetricMold.backMetrics.closed).toBe(true);
    expect(asymmetricMold.features.vent).not.toBeNull();
  });

  it("supports one through four collision-free gates on a large fixture", async () => {
    for (const count of [1, 2, 3, 4]) {
      let params = createDefaultParams();
      params = setPourGateCount(params, count);
      const result = await generateTwoPartMold(indexedCube(80), params);
      expect(result.features.gates).toHaveLength(count);
      expect(result.frontMetrics.closed).toBe(true);
      expect(result.backMetrics.closed).toBe(true);
    }
  });

  it("keeps optional exterior operations deterministic and watertight", async () => {
    const plain = createDefaultParams();
    plain.pourGates = plain.pourGates.map((gate) => ({
      ...gate,
      diameterMm: 0,
    }));
    plain.rubberBandGrooves = false;
    plain.pryPockets = false;
    const featured = {
      ...plain,
      rubberBandGrooves: true,
      pryPockets: true,
    };

    const withoutExterior = await generateTwoPartMold(indexedCube(24), plain);
    const withExterior = await generateTwoPartMold(indexedCube(24), featured);
    const plainVolume =
      withoutExterior.frontMetrics.volumeMm3 +
      withoutExterior.backMetrics.volumeMm3;
    const featuredVolume =
      withExterior.frontMetrics.volumeMm3 + withExterior.backMetrics.volumeMm3;

    expect(featuredVolume).toBeLessThan(plainVolume);
    expect(withExterior.frontMetrics.closed).toBe(true);
    expect(withExterior.backMetrics.closed).toBe(true);
  });

  it("keeps a near-edge but valid seam closed and opens real gate channels", async () => {
    const nearEdge = createDefaultParams();
    nearEdge.seamOffsetMm = 8.5;
    const nearEdgeResult = await generateTwoPartMold(indexedCube(20), nearEdge);
    expect(nearEdgeResult.frontMetrics.closed).toBe(true);
    expect(nearEdgeResult.backMetrics.closed).toBe(true);

    const withoutGate = createDefaultParams();
    withoutGate.pourGates = withoutGate.pourGates.map((gate) => ({
      ...gate,
      diameterMm: 0,
    }));
    withoutGate.rubberBandGrooves = false;
    withoutGate.pryPockets = false;
    const withGate = {
      ...withoutGate,
      pourGates: [{ ...withoutGate.pourGates[0], diameterMm: 8 }],
    };
    const closed = await generateTwoPartMold(indexedCube(24), withoutGate);
    const opened = await generateTwoPartMold(indexedCube(24), withGate);
    function voidVolume(result: typeof opened): number {
      const size = result.features.outerBounds.max.map(
        (value, index) => value - result.features.outerBounds.min[index],
      );
      return (
        size[0] * size[1] * size[2] -
        result.frontMetrics.volumeMm3 -
        result.backMetrics.volumeMm3
      );
    }
    expect(voidVolume(opened)).toBeGreaterThan(voidVolume(closed));
  });
  it("optionally closes isolated whisker-thin cavity branches and reports removed detail", async () => {
    const kernel = await loadManifold();
    const body = kernel.Manifold.cube([24, 24, 24], true);
    const whiskerBase = kernel.Manifold.cylinder(12, 0.4, 0.4, 12, true);
    const whiskerAlongX = whiskerBase.rotate([0, 90, 0]);
    const whisker = whiskerAlongX.translate([18.5, 0, 0]);
    const source = kernel.Manifold.compose([body, whisker]);
    const mesh = manifoldToTriangleMesh(source);
    body.delete();
    whiskerBase.delete();
    whiskerAlongX.delete();
    whisker.delete();
    source.delete();

    const plainParams = createDefaultParams();
    plainParams.rubberBandGrooves = false;
    plainParams.pryPockets = false;
    const plain = await generateTwoPartMold(mesh, plainParams);
    const filtered = await generateTwoPartMold(mesh, {
      ...plainParams,
      closeNarrowOpenings: true,
      narrowOpeningThresholdMm: 2,
    });

    expect(plain.features.narrowOpenings).toMatchObject({
      enabled: false,
      thresholdMm: 2,
      removedVolumeMm3: 0,
    });
    expect(filtered.features.narrowOpenings.enabled).toBe(true);
    expect(filtered.features.narrowOpenings.thresholdMm).toBe(2);
    expect(filtered.features.narrowOpenings.removedVolumeMm3).toBeGreaterThan(
      1,
    );
    expect(filtered.features.cavityVolumeMm3).toBeLessThan(
      plain.features.cavityVolumeMm3,
    );
    for (const part of filtered.parts) {
      expect(part.metrics.closed).toBe(true);
      expect(part.metrics.boundaryEdges).toBe(0);
      expect(part.metrics.nonManifoldEdges).toBe(0);
    }
  });
  it("creates up to eight closed printable segments and resolves auto deterministically", async () => {
    for (const pieceMode of [4, 6, 8] as const) {
      const result = await generateTwoPartMold(indexedCube(40), {
        ...createDefaultParams(),
        pieceMode,
      });
      expect(result.resolvedPieceCount).toBe(pieceMode);
      expect(result.parts).toHaveLength(pieceMode);
      const segmentsPerSide = pieceMode / 2;
      expect(result.features.registration.count).toBe(segmentsPerSide * 6);
      expect(result.features.segmentConnectors).toMatchObject({
        style: "hex",
        count: (segmentsPerSide - 1) * 10,
        depthPerInterface: 5,
        depthSidesPerInterface: 4,
      });
      for (const part of result.parts) {
        expect(part.metrics.closed).toBe(true);
        expect(part.metrics.boundaryEdges).toBe(0);
        expect(part.metrics.nonManifoldEdges).toBe(0);
        expect(part.metrics.volumeMm3).toBeGreaterThan(0);
        expect(part.metrics.bedTriangles).toBeGreaterThan(0);
        expect(splitMeshIntoConnectedComponents(part.mesh)).toHaveLength(1);
      }
      for (const side of ["front", "back"] as const) {
        const sideParts = result.parts.filter((part) => part.side === side);
        const fullBounds =
          side === "front"
            ? result.frontMetrics.bounds
            : result.backMetrics.bounds;
        for (let boundary = 0; boundary < sideParts.length - 1; boundary += 1) {
          const planeZ =
            fullBounds.min[2] +
            ((fullBounds.max[2] - fullBounds.min[2]) * (boundary + 1)) /
              sideParts.length;
          expect(sideParts[boundary]!.metrics.bounds.max[2]).toBeGreaterThan(
            planeZ,
          );
          expect(sideParts[boundary + 1]!.metrics.bounds.min[2]).toBeLessThan(
            planeZ,
          );
        }
      }
    }

    const automaticCube = await generateTwoPartMold(indexedCube(40), {
      ...createDefaultParams(),
      pieceMode: "auto",
    });
    expect(automaticCube.resolvedPieceCount).toBe(2);

    const kernel = await loadManifold();
    for (const [depth, expected] of [
      [60, 4],
      [70, 6],
      [100, 8],
    ] as const) {
      const elongatedSolid = kernel.Manifold.cube([30, 30, depth], true);
      const elongatedMesh = manifoldToTriangleMesh(elongatedSolid);
      elongatedSolid.delete();
      const automatic = await generateTwoPartMold(elongatedMesh, {
        ...createDefaultParams(),
        pieceMode: "auto",
      });
      expect(automatic.resolvedPieceCount).toBe(expected);
    }
  });
  it("splits an oversized mold into print-bed-fitting height rows with configurable hex connectors", async () => {
    const kernel = await loadManifold();
    const tallSolid = kernel.Manifold.cube([30, 700, 30], true);
    const tallMesh = manifoldToTriangleMesh(tallSolid);
    tallSolid.delete();
    const params = {
      ...createDefaultParams(),
      pieceMode: 2 as const,
      segmentConnectorWidthMm: 2,
      segmentConnectorDepthMm: 6,
    };

    const result = await generateTwoPartMold(tallMesh, params);

    expect(result.features.printVolume).toMatchObject({
      buildVolumeMm: [340, 320, 340],
      depthSegmentCount: 1,
      heightSegmentCount: 3,
      fittingPartCount: 6,
      allPartsFit: true,
    });
    expect(result.resolvedPieceCount).toBe(6);
    expect(result.features.registration.count).toBe(14);
    expect(result.features.segmentConnectors).toMatchObject({
      style: "hex",
      count: 20,
      depthPerInterface: 5,
      heightPerInterface: 5,
      depthSidesPerInterface: 4,
      heightSidesPerInterface: 4,
      widthAcrossFlatsMm: 2,
      depthMm: 6,
    });
    expect(new Set(result.parts.map((part) => part.heightSegmentIndex))).toEqual(
      new Set([0, 1, 2]),
    );
    for (const part of result.parts) {
      expect(part.metrics.closed).toBe(true);
      expect(part.metrics.boundaryEdges).toBe(0);
      expect(part.metrics.nonManifoldEdges).toBe(0);
      expect(part.metrics.bedTriangles).toBeGreaterThan(0);
      expect(splitMeshIntoConnectedComponents(part.mesh)).toHaveLength(1);
    }
    const narrowSolid = kernel.Manifold.cube([30, 700, 10], true);
    const narrowMesh = manifoldToTriangleMesh(narrowSolid);
    narrowSolid.delete();
    await expect(
      generateTwoPartMold(narrowMesh, {
        ...params,
        segmentConnectorWidthMm: 4,
      }),
    ).rejects.toMatchObject<MoldGenerationError>({
      code: "FEATURE_COLLISION",
      feature: "registration",
    });
  });
  it("anchors connectors on a combined height and depth grid", async () => {
    const kernel = await loadManifold();
    const oversizedSolid = kernel.Manifold.cube([30, 700, 700], true);
    const oversizedMesh = manifoldToTriangleMesh(oversizedSolid);
    oversizedSolid.delete();

    const result = await generateTwoPartMold(oversizedMesh, {
      ...createDefaultParams(),
      pieceMode: "auto",
    });

    expect(result.features.printVolume.heightSegmentCount).toBeGreaterThan(1);
    expect(result.features.printVolume.depthSegmentCount).toBeGreaterThan(1);
    for (const part of result.parts) {
      expect(part.metrics.closed).toBe(true);
      expect(part.metrics.nonManifoldEdges).toBe(0);
      expect(splitMeshIntoConnectedComponents(part.mesh)).toHaveLength(1);
    }
    const assemblySolids = result.parts.map((part) => {
      const positions = new Float32Array(part.mesh.positions.length);
      for (let index = 0; index < positions.length; index += 3) {
        const printX = part.mesh.positions[index]!;
        const printY = part.mesh.positions[index + 1]!;
        const printZ = part.mesh.positions[index + 2]!;
        positions[index] =
          part.side === "front"
            ? result.features.outerBounds.max[0] - printY
            : result.features.outerBounds.min[0] + printY;
        positions[index + 1] =
          part.side === "front"
            ? result.features.outerBounds.min[1] + printX
            : result.features.outerBounds.max[1] - printX;
        positions[index + 2] = result.features.outerBounds.min[2] + printZ;
      }
      return triangleMeshToManifold(kernel, {
        positions,
        indices: part.mesh.indices,
      });
    });
    try {
      for (let first = 0; first < assemblySolids.length; first += 1) {
        for (let second = first + 1; second < assemblySolids.length; second += 1) {
          const overlap = assemblySolids[first]!.intersect(assemblySolids[second]!);
          try {
            expect(
              overlap.volume(),
              `${result.parts[first]!.id} overlaps ${result.parts[second]!.id}`,
            ).toBeLessThanOrEqual(1e-5);
          } finally {
            overlap.delete();
          }
        }
      }
    } finally {
      assemblySolids.forEach((solid) => solid.delete());
    }
  });
  it("rejects unsafe seam, colliding gates, defective source and cancellation", async () => {
    const seamParams = createDefaultParams();
    seamParams.seamOffsetMm = 9.95;
    await expect(
      generateTwoPartMold(indexedCube(20), seamParams),
    ).rejects.toMatchObject<MoldGenerationError>({
      code: "SEAM_OUTSIDE_MODEL",
      feature: "seam",
    });

    const collisionParams = createDefaultParams();
    collisionParams.pourGates = [
      { id: "gate-a", diameterMm: 8, xMm: 0, zMm: 0 },
      { id: "gate-b", diameterMm: 8, xMm: 1, zMm: 0 },
    ];
    await expect(
      generateTwoPartMold(indexedCube(40), collisionParams),
    ).rejects.toMatchObject<MoldGenerationError>({
      code: "FEATURE_COLLISION",
      feature: "gate",
      featureId: "gate-b",
    });

    await expect(
      generateTwoPartMold(openCube(), createDefaultParams()),
    ).rejects.toMatchObject<MoldGenerationError>({
      code: "INVALID_SOURCE_MESH",
      feature: "source",
    });

    await expect(
      generateTwoPartMold(indexedCube(20), createDefaultParams(), {
        isCancelled: () => true,
      }),
    ).rejects.toMatchObject<MoldGenerationError>({ code: "CANCELLED" });
  });
});

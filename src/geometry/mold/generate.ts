import type { Manifold as ManifoldSolid, ManifoldToplevel } from "manifold-3d";
import {
  MAX_MOLD_PARTS,
  estimateMoldMaterialUsage,
  validateMoldParams,
  type TwoPartMoldParams,
} from "../../domain/mold";
import type { ModelPlacement } from "../../domain/placement";
import {
  manifoldToTriangleMesh,
  measureSolid,
  splitTriangleMeshIntoSegments,
  triangleMeshToManifold,
  type MultiSplitPart,
} from "../kernel/adapter";
import { loadManifold } from "../kernel/loader";
import type { TriangleMeshData } from "../../workers/protocol";
import { calculateMeshBounds, placePourGates, placeVent } from "./placement";
import type {
  MoldFeatureReport,
  MoldGenerationOptions,
  MoldGenerationResult,
  MoldPartMetrics,
} from "./types";
import { MoldGenerationError } from "./types";

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function makeBox(
  kernel: ManifoldToplevel,
  min: [number, number, number],
  max: [number, number, number],
): ManifoldSolid {
  const primitive = kernel.Manifold.cube([
    max[0] - min[0],
    max[1] - min[1],
    max[2] - min[2],
  ]);
  const translated = primitive.translate(min);
  primitive.delete();
  return translated;
}

function rotateAndTranslate(
  source: ManifoldSolid,
  rotation: [number, number, number],
  translation: [number, number, number],
): ManifoldSolid {
  const rotated = source.rotate(rotation);
  source.delete();
  const translated = rotated.translate(translation);
  rotated.delete();
  return translated;
}

export function transformPreparedSourceForPlacement(
  source: ManifoldSolid,
  placement: ModelPlacement,
): ManifoldSolid {
  const bounds = source.boundingBox();
  const centered = source.translate([
    -(bounds.min[0] + bounds.max[0]) / 2,
    -(bounds.min[1] + bounds.max[1]) / 2,
    -(bounds.min[2] + bounds.max[2]) / 2,
  ]);
  const rotated = centered.rotate(placement.rotationDeg);
  centered.delete();
  const rotatedBounds = rotated.boundingBox();
  const placed = rotated.translate([
    placement.positionMm[0] - (rotatedBounds.min[0] + rotatedBounds.max[0]) / 2,
    placement.positionMm[1] - rotatedBounds.min[1],
    placement.positionMm[2] - (rotatedBounds.min[2] + rotatedBounds.max[2]) / 2,
  ]);
  rotated.delete();
  return placed;
}

function makeCylinderY(
  kernel: ManifoldToplevel,
  height: number,
  radiusLow: number,
  radiusHigh: number,
  center: [number, number, number],
  segments = 32,
): ManifoldSolid {
  const primitive = kernel.Manifold.cylinder(
    height,
    radiusLow,
    radiusHigh,
    segments,
    true,
  );
  return rotateAndTranslate(primitive, [-90, 0, 0], center);
}

function makeCylinderX(
  kernel: ManifoldToplevel,
  height: number,
  radiusLow: number,
  radiusHigh: number,
  center: [number, number, number],
  segments = 28,
): ManifoldSolid {
  const primitive = kernel.Manifold.cylinder(
    height,
    radiusLow,
    radiusHigh,
    segments,
    true,
  );
  return rotateAndTranslate(primitive, [0, 90, 0], center);
}

function makeCylinderZ(
  kernel: ManifoldToplevel,
  height: number,
  radiusLow: number,
  radiusHigh: number,
  center: [number, number, number],
  segments = 28,
): ManifoldSolid {
  const primitive = kernel.Manifold.cylinder(
    height,
    radiusLow,
    radiusHigh,
    segments,
    true,
  );
  const translated = primitive.translate(center);
  primitive.delete();
  return translated;
}

export type MultiSideSegmentConnectorSite = {
  longitudinal: number;
  transverse: number;
  side: "outer" | "minimum" | "maximum" | "inner";
};

export const CONNECTOR_MIN_WEB_MM = 1;
const CONNECTOR_EDGE_MARGIN_MM = 0.2;
const INNER_CROSS_LANE_MARGIN_MM = CONNECTOR_EDGE_MARGIN_MM;

function segmentConnectorLaneOffset(
  pocketRadiusMm: number,
  direction: -1 | 0 | 1,
): number {
  if (direction === 0) return 0;
  const margin =
    direction > 0
      ? INNER_CROSS_LANE_MARGIN_MM
      : CONNECTOR_MIN_WEB_MM - INNER_CROSS_LANE_MARGIN_MM;
  return direction * (pocketRadiusMm + margin);
}

export function planMultiSideSegmentConnectorSites(
  longitudinalMin: number,
  longitudinalMax: number,
  transverseMin: number,
  transverseMax: number,
  wallMm: number,
  pocketRadiusMm: number,
  sideLaneDirection: -1 | 0 | 1 = 0,
  innerLongitudinalFraction = 0.5,
): MultiSideSegmentConnectorSite[] {
  const longitudinalSpan = longitudinalMax - longitudinalMin;
  const transverseSpan = transverseMax - transverseMin;
  const edgeInset = pocketRadiusMm + CONNECTOR_EDGE_MARGIN_MM;
  const outerWall =
    transverseMin + Math.min(wallMm / 2, transverseSpan / 2);
  const innerWall =
    transverseMax - Math.min(wallMm / 2, transverseSpan / 2);
  // Keep the longitudinal-wall sites away from the outer transverse wall.
  // Their material anchoring is validated separately and may still move them
  // to a safe fallback when the midpoint contains no mold material.
  const sideWall =
    transverseMin +
    transverseSpan / 2 +
    segmentConnectorLaneOffset(pocketRadiusMm, sideLaneDirection);
  return [
    {
      longitudinal: longitudinalMin + longitudinalSpan * 0.3,
      transverse: outerWall,
      side: "outer",
    },
    {
      longitudinal: longitudinalMin + longitudinalSpan * 0.7,
      transverse: outerWall,
      side: "outer",
    },
    {
      longitudinal: longitudinalMin + edgeInset,
      transverse: sideWall,
      side: "minimum",
    },
    {
      longitudinal: longitudinalMax - edgeInset,
      transverse: sideWall,
      side: "maximum",
    },
    {
      longitudinal:
        longitudinalMin + longitudinalSpan * innerLongitudinalFraction,
      transverse: innerWall,
      side: "inner",
    },
  ];
}

function solidHexRootCoverage(
  solid: ManifoldSolid,
  probe: ManifoldSolid,
): number {
  const expectedVolume = probe.volume();
  const intersection = solid.intersect(probe);
  try {
    return expectedVolume > 0 ? intersection.volume() / expectedVolume : 0;
  } finally {
    intersection.delete();
    probe.delete();
  }
}

function depthInterfaceHasAnchoredHexRoot(
  kernel: ManifoldToplevel,
  lower: ManifoldSolid,
  upper: ManifoldSolid,
  planeZ: number,
  site: MultiSideSegmentConnectorSite,
  pocketRadius: number,
): number {
  const rootDepth = 0.25;
  return Math.min(
    solidHexRootCoverage(
      lower,
      makeCylinderZ(
        kernel,
        rootDepth,
        pocketRadius,
        pocketRadius,
        [site.longitudinal, site.transverse, planeZ - rootDepth / 2],
        6,
      ),
    ),
    solidHexRootCoverage(
      upper,
      makeCylinderZ(
        kernel,
        rootDepth,
        pocketRadius,
        pocketRadius,
        [site.longitudinal, site.transverse, planeZ + rootDepth / 2],
        6,
      ),
    )
  );
}

function heightInterfaceHasAnchoredHexRoot(
  kernel: ManifoldToplevel,
  lower: ManifoldSolid,
  upper: ManifoldSolid,
  planeX: number,
  site: MultiSideSegmentConnectorSite,
  pocketRadius: number,
): number {
  const rootDepth = 0.25;
  return Math.min(
    solidHexRootCoverage(
      lower,
      makeCylinderX(
        kernel,
        rootDepth,
        pocketRadius,
        pocketRadius,
        [planeX - rootDepth / 2, site.transverse, site.longitudinal],
        6,
      ),
    ),
    solidHexRootCoverage(
      upper,
      makeCylinderX(
        kernel,
        rootDepth,
        pocketRadius,
        pocketRadius,
        [planeX + rootDepth / 2, site.transverse, site.longitudinal],
        6,
      ),
    )
  );
}

function seamRegistrationHasSolidCorridor(
  kernel: ManifoldToplevel,
  front: ManifoldSolid,
  back: ManifoldSolid,
  seamX: number,
  y: number,
  z: number,
  corridorDepth: number,
  pocketRadius: number,
): number {
  return Math.min(
    solidHexRootCoverage(
      front,
      makeCylinderX(
        kernel,
        corridorDepth,
        pocketRadius,
        pocketRadius,
        [seamX + corridorDepth / 2, y, z],
        6,
      ),
    ),
    solidHexRootCoverage(
      back,
      makeCylinderX(
        kernel,
        corridorDepth,
        pocketRadius,
        pocketRadius,
        [seamX - corridorDepth / 2, y, z],
        6,
      ),
    ),
  );
}

function manifoldComponentCount(solid: ManifoldSolid): number {
  const components = solid.decompose();
  try {
    return components.length;
  } finally {
    components.forEach((component) => component.delete());
  }
}

export function registrationComponentCountsAreSafe(
  before: readonly number[],
  after: readonly number[],
): boolean {
  return (
    before.length === after.length &&
    after.every((count, index) => count <= (before[index] ?? 0))
  );
}

function assertRegistrationAddedNoBodies(
  solids: ManifoldSolid[],
  baselineComponentCounts: readonly number[],
  interfaceType: "depth" | "height",
): void {
  const finalComponentCounts = solids.map(manifoldComponentCount);
  if (
    registrationComponentCountsAreSafe(
      baselineComponentCounts,
      finalComponentCounts,
    )
  ) {
    return;
  }
  const segmentIndex = finalComponentCounts.findIndex(
    (count, index) => count > (baselineComponentCounts[index] ?? 0),
  );
  throw new MoldGenerationError(
    "FEATURE_COLLISION",
    `A ${interfaceType} connector created an additional unanchored body.`,
    "registration",
    `${interfaceType}-segment-${segmentIndex + 1}`,
  );
}

function resolveAnchoredConnectorSites(
  plannedSites: MultiSideSegmentConnectorSite[],
  longitudinalMin: number,
  longitudinalMax: number,
  pocketRadius: number,
  coverageAt: (site: MultiSideSegmentConnectorSite) => number,
  interfaceType: "depth" | "height",
  boundaryIndex: number,
  allowOuterFallback = true,
  forbiddenTransverse?: number,
  outerFallbackBoundaryClearance = 0,
): MultiSideSegmentConnectorSite[] {
  const minimumSpacing = pocketRadius * 2 + CONNECTOR_MIN_WEB_MM;
  const edgeInset = pocketRadius + CONNECTOR_EDGE_MARGIN_MM;
  const span = longitudinalMax - longitudinalMin;
  const outerTransverse = plannedSites.find((site) => site.side === "outer")!
    .transverse;
  const innerTransverse = plannedSites.find((site) => site.side === "inner")!
    .transverse;
  const selected: MultiSideSegmentConnectorSite[] = [];

  for (const [siteIndex, planned] of plannedSites.entries()) {
    const candidates: MultiSideSegmentConnectorSite[] = [planned];
    if (planned.side === "outer" || planned.side === "inner") {
      for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
        candidates.push({
          ...planned,
          longitudinal: longitudinalMin + span * fraction,
        });
      }
      if (planned.side === "inner") {
        const innerLongitudinalCandidates = [
          planned.longitudinal,
          ...[0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85].map(
            (fraction) => longitudinalMin + span * fraction,
          ),
          longitudinalMin + edgeInset,
          longitudinalMax - edgeInset,
        ];
        if (planned.longitudinal > longitudinalMin + span / 2) {
          innerLongitudinalCandidates.reverse();
        }
        const innerTransverseCandidates = [
          planned.transverse,
          planned.transverse + (outerTransverse - planned.transverse) * 0.18,
          planned.transverse + (outerTransverse - planned.transverse) * 0.33,
        ];
        for (const transverse of innerTransverseCandidates) {
          for (const longitudinal of innerLongitudinalCandidates) {
            candidates.push({ ...planned, longitudinal, transverse });
          }
        }
      }
    } else {
      for (const fraction of [0.2, 0.35, 0.65, 0.8]) {
        candidates.push({
          ...planned,
          transverse:
            outerTransverse +
            (innerTransverse - outerTransverse) * fraction,
        });
      }
      const direction = planned.side === "minimum" ? 1 : -1;
      const candidateStep = pocketRadius * 2 + CONNECTOR_EDGE_MARGIN_MM;
      const maximumSteps = Math.max(1, Math.floor(span / candidateStep));
      for (let step = 1; step <= maximumSteps; step += 1) {
        const longitudinal =
          planned.longitudinal + direction * candidateStep * step;
        if (
          longitudinal < longitudinalMin + edgeInset ||
          longitudinal > longitudinalMax - edgeInset
        ) {
          break;
        }
        if (
          (planned.side === "minimum" &&
            longitudinal > longitudinalMin + span / 2) ||
          (planned.side === "maximum" &&
            longitudinal < longitudinalMin + span / 2)
        ) {
          break;
        }
        candidates.push({ ...planned, longitudinal });
        if (
          allowOuterFallback &&
          Math.min(
            longitudinal - longitudinalMin,
            longitudinalMax - longitudinal,
          ) >= outerFallbackBoundaryClearance
        ) {
          candidates.push({
            ...planned,
            longitudinal,
            transverse: outerTransverse,
          });
        }
      }
    }

    let bestCoverage = 0;
    const resolved = candidates.find((candidate) => {
      if (
        (planned.side === "minimum" || planned.side === "maximum") &&
        forbiddenTransverse !== undefined &&
        Math.abs(candidate.transverse - forbiddenTransverse) < minimumSpacing
      ) {
        return false;
      }
      const closestSpacing = selected.reduce(
        (closest, other) =>
          Math.min(
            closest,
            Math.hypot(
              candidate.longitudinal - other.longitudinal,
              candidate.transverse - other.transverse,
            ),
          ),
        Infinity,
      );
      if (closestSpacing < minimumSpacing) {
        return false;
      }
      const coverage = coverageAt(candidate);
      bestCoverage = Math.max(bestCoverage, coverage);
      return coverage >= 0.98;
    });
    if (!resolved) {
      throw new MoldGenerationError(
        "FEATURE_COLLISION",
        `The ${planned.side} ${interfaceType} connector ${siteIndex + 1} cannot be fully anchored in both neighboring mold segments (${Math.round(bestCoverage * 100)}% root coverage).`,
        "registration",
        `${interfaceType}-interface-${boundaryIndex + 1}-${planned.side}-${siteIndex + 1}`,
      );
    }
    selected.push(resolved);
  }
  return selected;
}

function addInterSegmentRegistration(
  kernel: ManifoldToplevel,
  segments: MultiSplitPart[],
  planeOffsets: number[],
  wallMm: number,
  connectorWidth: number,
  connectorDepth: number,
  clearance: number,
  sideOffset: number,
  sideLaneDirection: -1 | 0 | 1 = 0,
): MultiSplitPart[] {
  const solids = segments.map((segment) =>
    triangleMeshToManifold(kernel, segment.mesh),
  );
  const baselineComponentCounts = solids.map(manifoldComponentCount);
  const overlap = 0.3;
  const pinRadius = connectorWidth / Math.sqrt(3);
  const pocketRadius = (connectorWidth + clearance * 2) / Math.sqrt(3);
  try {
    planeOffsets.forEach((planeZ, boundaryIndex) => {
      const lowerBounds = solids[boundaryIndex]!.boundingBox();
      const upperBounds = solids[boundaryIndex + 1]!.boundingBox();
      const minX = Math.max(lowerBounds.min[0], upperBounds.min[0]);
      const maxX = Math.min(lowerBounds.max[0], upperBounds.max[0]);
      const minY = Math.max(lowerBounds.min[1], upperBounds.min[1]);
      const maxY = Math.min(lowerBounds.max[1], upperBounds.max[1]);
      const spanX = maxX - minX;
      const edgeInset = pocketRadius + CONNECTOR_EDGE_MARGIN_MM;
      const plannedSites = planMultiSideSegmentConnectorSites(
        minX,
        maxX,
        minY,
        maxY,
        wallMm,
        pocketRadius,
        sideLaneDirection,
        sideOffset % 2 === 0 ? 0.35 : 0.65,
      );
      if (
        spanX * 0.4 < pocketRadius * 2 + CONNECTOR_MIN_WEB_MM ||
        spanX - edgeInset * 2 < pocketRadius * 2 + CONNECTOR_MIN_WEB_MM
      ) {
        throw new MoldGenerationError(
          "FEATURE_COLLISION",
          "The configured hex connectors do not fit on multiple sides of the depth segment face.",
          "registration",
          `depth-interface-${boundaryIndex + 1}`,
        );
      }
      const sites = resolveAnchoredConnectorSites(
        plannedSites,
        minX,
        maxX,
        pocketRadius,
        (site) =>
          depthInterfaceHasAnchoredHexRoot(
            kernel,
            solids[boundaryIndex]!,
            solids[boundaryIndex + 1]!,
            planeZ,
            site,
            pocketRadius,
          ),
        "depth",
        boundaryIndex,
        true,
        sideLaneDirection === 0
          ? undefined
          : minY +
            (maxY - minY) / 2 +
            segmentConnectorLaneOffset(
              pocketRadius,
              sideLaneDirection > 0 ? -1 : 1,
            ),
      );
      for (const [siteIndex, site] of sites.entries()) {
        const lowerIsMale = (boundaryIndex + siteIndex + sideOffset) % 2 === 0;
        const direction = lowerIsMale ? 1 : -1;
        const pinCenterZ = planeZ + (direction * (connectorDepth - overlap)) / 2;
        const pocketCenterZ =
          planeZ + (direction * (connectorDepth + clearance - overlap)) / 2;
        const pin = makeCylinderZ(
          kernel,
          connectorDepth + overlap,
          pinRadius,
          pinRadius,
          [site.longitudinal, site.transverse, pinCenterZ],
          6,
        );
        const pocket = makeCylinderZ(
          kernel,
          connectorDepth + overlap + clearance,
          pocketRadius,
          pocketRadius,
          [site.longitudinal, site.transverse, pocketCenterZ],
          6,
        );
        if (lowerIsMale) {
          solids[boundaryIndex] = addOwned(solids[boundaryIndex]!, pin);
          solids[boundaryIndex + 1] = subtractOwned(
            solids[boundaryIndex + 1]!,
            pocket,
          );
        } else {
          solids[boundaryIndex + 1] = addOwned(solids[boundaryIndex + 1]!, pin);
          solids[boundaryIndex] = subtractOwned(solids[boundaryIndex]!, pocket);
        }
      }
    });
    assertRegistrationAddedNoBodies(solids, baselineComponentCounts, "depth");
    return solids.map((solid) => ({
      mesh: manifoldToTriangleMesh(solid),
      metrics: measureSolid(solid),
    }));
  } finally {
    solids.forEach((solid) => solid.delete());
  }
}

function addInterHeightRegistration(
  kernel: ManifoldToplevel,
  segments: MultiSplitPart[],
  planeOffsets: number[],
  wallMm: number,
  connectorWidth: number,
  connectorDepth: number,
  clearance: number,
  sideOffset: number,
  sideLaneDirection: -1 | 0 | 1 = 0,
): MultiSplitPart[] {
  const solids = segments.map((segment) => triangleMeshToManifold(kernel, segment.mesh));
  const baselineComponentCounts = solids.map(manifoldComponentCount);
  const overlap = 0.3;
  const pinRadius = connectorWidth / Math.sqrt(3);
  const pocketRadius = (connectorWidth + clearance * 2) / Math.sqrt(3);
  try {
    planeOffsets.forEach((planeX, boundaryIndex) => {
      const lowerBounds = solids[boundaryIndex]!.boundingBox();
      const upperBounds = solids[boundaryIndex + 1]!.boundingBox();
      const minY = Math.max(lowerBounds.min[1], upperBounds.min[1]);
      const maxY = Math.min(lowerBounds.max[1], upperBounds.max[1]);
      const minZ = Math.max(lowerBounds.min[2], upperBounds.min[2]);
      const maxZ = Math.min(lowerBounds.max[2], upperBounds.max[2]);
      const spanZ = maxZ - minZ;
      const edgeInset = pocketRadius + CONNECTOR_EDGE_MARGIN_MM;
      const plannedSites = planMultiSideSegmentConnectorSites(
        minZ,
        maxZ,
        minY,
        maxY,
        wallMm,
        pocketRadius,
        sideLaneDirection,
        sideOffset % 2 === 0 ? 0.35 : 0.65,
      );
      if (
        spanZ * 0.4 < pocketRadius * 2 + CONNECTOR_MIN_WEB_MM ||
        spanZ - edgeInset * 2 < pocketRadius * 2 + CONNECTOR_MIN_WEB_MM
      ) {
        throw new MoldGenerationError(
          "FEATURE_COLLISION",
          "The configured hex connectors do not fit on multiple sides of the horizontal segment face.",
          "registration",
          `height-interface-${boundaryIndex + 1}`,
        );
      }
      const sites = resolveAnchoredConnectorSites(
        plannedSites,
        minZ,
        maxZ,
        pocketRadius,
        (site) =>
          heightInterfaceHasAnchoredHexRoot(
            kernel,
            solids[boundaryIndex]!,
            solids[boundaryIndex + 1]!,
            planeX,
            site,
            pocketRadius,
          ),
        "height",
        boundaryIndex,
        true,
        undefined,
        sideLaneDirection === 0
          ? 0
          : connectorDepth + pocketRadius + CONNECTOR_MIN_WEB_MM,
      );
      for (const [siteIndex, site] of sites.entries()) {
        const lowerIsMale = (boundaryIndex + siteIndex + sideOffset) % 2 === 0;
        const direction = lowerIsMale ? 1 : -1;
        const pinCenterX = planeX + (direction * (connectorDepth - overlap)) / 2;
        const pocketCenterX =
          planeX + (direction * (connectorDepth + clearance - overlap)) / 2;
        const pin = makeCylinderX(
          kernel,
          connectorDepth + overlap,
          pinRadius,
          pinRadius,
          [pinCenterX, site.transverse, site.longitudinal],
          6,
        );
        const pocket = makeCylinderX(
          kernel,
          connectorDepth + overlap + clearance,
          pocketRadius,
          pocketRadius,
          [pocketCenterX, site.transverse, site.longitudinal],
          6,
        );
        if (lowerIsMale) {
          solids[boundaryIndex] = addOwned(solids[boundaryIndex]!, pin);
          solids[boundaryIndex + 1] = subtractOwned(solids[boundaryIndex + 1]!, pocket);
        } else {
          solids[boundaryIndex + 1] = addOwned(solids[boundaryIndex + 1]!, pin);
          solids[boundaryIndex] = subtractOwned(solids[boundaryIndex]!, pocket);
        }
      }
    });
    assertRegistrationAddedNoBodies(solids, baselineComponentCounts, "height");
    return solids.map((solid) => ({
      mesh: manifoldToTriangleMesh(solid),
      metrics: measureSolid(solid),
    }));
  } finally {
    solids.forEach((solid) => solid.delete());
  }
}

function makeSphere(
  kernel: ManifoldToplevel,
  radius: number,
  center: [number, number, number],
): ManifoldSolid {
  const primitive = kernel.Manifold.sphere(radius, 24);
  const translated = primitive.translate(center);
  primitive.delete();
  return translated;
}

function subtractOwned(
  source: ManifoldSolid,
  tool: ManifoldSolid,
): ManifoldSolid {
  const result = source.subtract(tool);
  source.delete();
  tool.delete();
  return result;
}

function addOwned(source: ManifoldSolid, tool: ManifoldSolid): ManifoldSolid {
  const result = source.add(tool);
  source.delete();
  tool.delete();
  return result;
}

function subtractFromBoth(
  front: ManifoldSolid,
  back: ManifoldSolid,
  tool: ManifoldSolid,
): [ManifoldSolid, ManifoldSolid] {
  const nextFront = front.subtract(tool);
  const nextBack = back.subtract(tool);
  front.delete();
  back.delete();
  tool.delete();
  return [nextFront, nextBack];
}

async function checkpoint(
  options: MoldGenerationOptions,
  stage: Parameters<
    NonNullable<MoldGenerationOptions["onProgress"]>
  >[0]["stage"],
  progress: number,
  message: string,
): Promise<void> {
  if (options.isCancelled?.()) {
    throw new MoldGenerationError(
      "CANCELLED",
      "Mold generation cancelled.",
      "source",
    );
  }
  options.onProgress?.({ stage, progress, message });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (options.isCancelled?.()) {
    throw new MoldGenerationError(
      "CANCELLED",
      "Mold generation cancelled.",
      "source",
    );
  }
}

function makeGateTool(
  kernel: ManifoldToplevel,
  gate: {
    centerXMm: number;
    centerZMm: number;
    surfaceYMm: number;
    diameterMm: number;
  },
  outerTop: number,
  funnelHeight: number,
): ManifoldSolid {
  const radius = gate.diameterMm / 2;
  const channelBottom = gate.surfaceYMm - 0.5;
  const channelHeight = outerTop - channelBottom + 0.5;
  let channel = makeCylinderY(kernel, channelHeight, radius, radius, [
    gate.centerXMm,
    channelBottom + channelHeight / 2,
    gate.centerZMm,
  ]);
  const funnel = makeCylinderY(
    kernel,
    funnelHeight + 0.5,
    radius,
    radius * 1.5,
    [gate.centerXMm, outerTop - funnelHeight / 2, gate.centerZMm],
  );
  channel = addOwned(channel, funnel);
  return channel;
}

function makeGrooveShell(
  kernel: ManifoldToplevel,
  outerMin: [number, number, number],
  outerMax: [number, number, number],
  centerY: number,
  width: number,
  depth: number,
): ManifoldSolid {
  const outerBand = makeBox(
    kernel,
    [outerMin[0] - 0.1, centerY - width / 2, outerMin[2] - 0.1],
    [outerMax[0] + 0.1, centerY + width / 2, outerMax[2] + 0.1],
  );
  const innerBand = makeBox(
    kernel,
    [outerMin[0] + depth, centerY - width / 2 - 0.1, outerMin[2] + depth],
    [outerMax[0] - depth, centerY + width / 2 + 0.1, outerMax[2] - depth],
  );
  return subtractOwned(outerBand, innerBand);
}

function sampleAxisWallDistances(
  mesh: TriangleMeshData,
  outerMin: [number, number, number],
  outerMax: [number, number, number],
): number[] {
  const vertexCount = mesh.positions.length / 3;
  const stride = Math.max(1, Math.floor(vertexCount / 128));
  const samples: number[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex += stride) {
    const offset = vertex * 3;
    const x = mesh.positions[offset];
    const y = mesh.positions[offset + 1];
    const z = mesh.positions[offset + 2];
    samples.push(
      Math.min(
        x - outerMin[0],
        outerMax[0] - x,
        y - outerMin[1],
        outerMax[1] - y,
        z - outerMin[2],
        outerMax[2] - z,
      ),
    );
  }
  return samples;
}
function orientForPrinting(
  part: ManifoldSolid,
  side: "front" | "back",
  outerMinX: number,
  outerMaxX: number,
): ManifoldSolid {
  const referenceX = side === "front" ? outerMaxX : outerMinX;
  const shifted = part.translate([-referenceX, 0, 0]);
  part.delete();
  const rotated = shifted.rotate([0, 0, side === "front" ? -90 : 90]);
  shifted.delete();
  const bounds = rotated.boundingBox();
  const translated = rotated.translate([
    -bounds.min[0],
    -bounds.min[1],
    -bounds.min[2],
  ]);
  rotated.delete();
  return translated;
}

function measurePart(
  part: ManifoldSolid,
  feature: "front" | "back",
  mesh = manifoldToTriangleMesh(part),
): MoldPartMetrics {
  const metrics = measureSolid(part);
  const tolerance = 1e-4;
  let bedTriangles = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset] * 3 + 1;
    const b = mesh.indices[offset + 1] * 3 + 1;
    const c = mesh.indices[offset + 2] * 3 + 1;
    if (
      Math.abs(mesh.positions[a]) <= tolerance &&
      Math.abs(mesh.positions[b]) <= tolerance &&
      Math.abs(mesh.positions[c]) <= tolerance
    ) {
      bedTriangles += 1;
    }
  }
  if (!metrics.closed || metrics.volumeMm3 <= 0) {
    throw new MoldGenerationError(
      "TOPOLOGY_INVALID",
      "A mold half is not closed or has no volume.",
      feature,
    );
  }
  if (bedTriangles === 0) {
    throw new MoldGenerationError(
      "NO_FLAT_PRINT_FACE",
      "A mold half has no flat print surface.",
      feature,
    );
  }
  return { ...metrics, bedTriangles };
}

function printableMetrics(
  mesh: TriangleMeshData,
  metrics: Omit<MoldPartMetrics, "bedTriangles">,
): MoldPartMetrics {
  const tolerance = 1e-4;
  let bedTriangles = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset] * 3 + 1;
    const b = mesh.indices[offset + 1] * 3 + 1;
    const c = mesh.indices[offset + 2] * 3 + 1;
    if (
      Math.abs(mesh.positions[a]) <= tolerance &&
      Math.abs(mesh.positions[b]) <= tolerance &&
      Math.abs(mesh.positions[c]) <= tolerance
    )
      bedTriangles += 1;
  }
  if (!metrics.closed || metrics.volumeMm3 <= 0 || bedTriangles === 0) {
    throw new MoldGenerationError(
      metrics.closed && metrics.volumeMm3 > 0
        ? "NO_FLAT_PRINT_FACE"
        : "TOPOLOGY_INVALID",
      "A multipart mold segment is not closed, has no volume, or lacks a flat print surface.",
      "seam",
    );
  }
  return { ...metrics, bedTriangles };
}

function resolvePieceCount(
  mode: TwoPartMoldParams["pieceMode"],
  size: [number, number, number],
): 2 | 4 | 6 | 8 {
  if (mode !== "auto") return mode;
  const depthMm = size[2];
  const depthRatio = depthMm / Math.max(size[0], 0.001);
  if (depthMm >= 90 && depthRatio >= 2.4) return 8;
  if (depthMm >= 65 && depthRatio >= 1.8) return 6;
  if (depthMm >= 35 && depthRatio >= 1.15) return 4;
  return 2;
}

function partFitsPrintVolume(
  metrics: MoldPartMetrics,
  buildVolume: [number, number, number],
): boolean {
  const size = metrics.bounds.max.map(
    (maximum, axis) => maximum - metrics.bounds.min[axis],
  ) as [number, number, number];
  return (
    size[1] <= buildVolume[2] + 1e-6 &&
    ((size[0] <= buildVolume[0] + 1e-6 && size[2] <= buildVolume[1] + 1e-6) ||
      (size[0] <= buildVolume[1] + 1e-6 && size[2] <= buildVolume[0] + 1e-6))
  );
}

function resolveSegmentation(
  params: TwoPartMoldParams,
  outerSize: [number, number, number],
  halfThicknessMm: number,
): { depthSegmentCount: number; heightSegmentCount: number } {
  const buildVolume: [number, number, number] = [
    params.printBedWidthMm,
    params.printBedDepthMm,
    params.printBedHeightMm,
  ];
  let depthSegmentCount = resolvePieceCount(params.pieceMode, outerSize) / 2;
  const connectorAllowance = params.segmentConnectorDepthMm + params.fitClearanceMm + 1;

  if (params.pieceMode === "auto" && params.splitOversizedByHeight) {
    for (let candidate = 1; candidate <= 4; candidate += 1) {
      const depth = outerSize[2] / candidate + connectorAllowance;
      if (depth <= Math.max(buildVolume[0], buildVolume[1])) {
        depthSegmentCount = Math.max(depthSegmentCount, candidate);
        break;
      }
    }
  }

  if (!params.splitOversizedByHeight) {
    return { depthSegmentCount, heightSegmentCount: 1 };
  }
  if (halfThicknessMm > buildVolume[2] + 1e-6) {
    throw new MoldGenerationError(
      "PRINT_VOLUME_EXCEEDED",
      "The mold half is thicker than the configured print height.",
      "seam",
    );
  }
  const depthSpan = outerSize[2] / depthSegmentCount + connectorAllowance;
  const usableHeightSpans: number[] = [];
  if (depthSpan <= buildVolume[1]) usableHeightSpans.push(buildVolume[0]);
  if (depthSpan <= buildVolume[0]) usableHeightSpans.push(buildVolume[1]);
  if (usableHeightSpans.length === 0) {
    throw new MoldGenerationError(
      "PRINT_VOLUME_EXCEEDED",
      "The mold depth does not fit the configured print bed. Choose more mold pieces or a larger bed.",
      "seam",
    );
  }
  const usableHeight = Math.max(...usableHeightSpans) - connectorAllowance;
  const heightSegmentCount = Math.max(1, Math.ceil(outerSize[1] / usableHeight));
  if (heightSegmentCount > 16 || heightSegmentCount * depthSegmentCount * 2 > MAX_MOLD_PARTS) {
    throw new MoldGenerationError(
      "PRINT_VOLUME_EXCEEDED",
      `The requested print volume would require more than ${MAX_MOLD_PARTS} mold parts.`,
      "seam",
    );
  }
  return { depthSegmentCount, heightSegmentCount };
}

async function splitMeshGrid(
  base: MultiSplitPart,
  heightOffsets: number[],
  depthOffsets: number[],
): Promise<MultiSplitPart[][]> {
  const depthSegments = depthOffsets.length > 0
    ? await splitTriangleMeshIntoSegments(base.mesh, [0, 0, 1], depthOffsets)
    : [base];
  return Promise.all(
    depthSegments.map(async (segment) =>
      heightOffsets.length > 0
        ? splitTriangleMeshIntoSegments(segment.mesh, [1, 0, 0], heightOffsets)
        : [segment],
    ),
  );
}
export async function generateTwoPartMold(
  mesh: TriangleMeshData,
  params: TwoPartMoldParams,
  options: MoldGenerationOptions = {},
): Promise<MoldGenerationResult> {
  const startedAt = now();
  const issues = validateMoldParams(params);
  if (issues.length > 0) {
    throw new MoldGenerationError(
      "INVALID_PARAMETERS",
      "At least one mold parameter is outside the supported range.",
      "source",
      issues[0]?.field,
      issues[0]?.message,
    );
  }

  await checkpoint(
    options,
    "validating",
    0.04,
    options.preparedSourceFactory
      ? "Reusing the imported source solid"
      : "Building the reusable source solid",
  );
  const kernel = await loadManifold();
  const bounds = calculateMeshBounds(mesh);
  const seamX = bounds.center[0] + params.seamOffsetMm;
  const seamTolerance = Math.max(0.1, bounds.size[0] * 0.002);
  if (
    seamX <= bounds.min[0] + seamTolerance ||
    seamX >= bounds.max[0] - seamTolerance
  ) {
    throw new MoldGenerationError(
      "SEAM_OUTSIDE_MODEL",
      "The seam must divide the model into two non-empty regions.",
      "seam",
    );
  }

  let source: ManifoldSolid;
  try {
    source =
      options.preparedSourceFactory?.() ?? triangleMeshToManifold(kernel, mesh);
  } catch (error) {
    throw new MoldGenerationError(
      "INVALID_SOURCE_MESH",
      "The source model is not a closed, oriented solid.",
      "source",
      undefined,
      error instanceof Error ? error.message : String(error),
    );
  }

  let narrowOpeningRemovedVolumeMm3 = 0;
  if (params.closeNarrowOpenings) {
    const components = source.decompose();
    try {
      if (components.length > 0) {
        const largest = components.reduce((best, component) =>
          component.volume() > best.volume() ? component : best,
        );
        const kept = components.filter((component) => {
          if (component === largest) return true;
          const componentBounds = component.boundingBox();
          const spans = componentBounds.max
            .map((maximum, axis) => maximum - componentBounds.min[axis])
            .sort((left, right) => left - right);
          const remove =
            spans[0] < params.narrowOpeningThresholdMm &&
            spans[1] < params.narrowOpeningThresholdMm;
          if (remove) narrowOpeningRemovedVolumeMm3 += component.volume();
          return !remove;
        });
        if (kept.length < components.length) {
          const filtered = kernel.Manifold.compose(kept);
          source.delete();
          source = filtered;
        }
      }
    } finally {
      components.forEach((component) => component.delete());
    }
  }

  const gates = placePourGates(mesh, params.pourGates, bounds);
  const ventPoint = placeVent(mesh, params.ventDiameterMm, gates);
  const maximumFunnelRadius = Math.max(
    params.ventDiameterMm / 2,
    ...gates.map((gate) => gate.funnelDiameterMm / 2),
    0,
  );
  const sideMargin = Math.max(params.wallMm + 2, maximumFunnelRadius + 1.5);
  const funnelHeight = Math.max(4, Math.min(10, params.wallMm + 3));
  const outerMin: [number, number, number] = [
    bounds.min[0] - sideMargin,
    bounds.min[1] - params.wallMm,
    bounds.min[2] - sideMargin,
  ];
  const outerMax: [number, number, number] = [
    bounds.max[0] + sideMargin,
    bounds.max[1] + params.wallMm + funnelHeight,
    bounds.max[2] + sideMargin,
  ];
  const outerSize: [number, number, number] = outerMax.map(
    (maximum, axis) => maximum - outerMin[axis],
  ) as [number, number, number];
  const halfThicknessMm = Math.max(outerMax[0] - seamX, seamX - outerMin[0]);
  const { depthSegmentCount, heightSegmentCount } = resolveSegmentation(
    params,
    outerSize,
    halfThicknessMm,
  );
  const segmentsPerSide = depthSegmentCount * heightSegmentCount;
  const resolvedPieceCount = segmentsPerSide * 2;
  if (
    params.segmentConnectorWidthMm + params.fitClearanceMm * 2 + 0.4 > params.wallMm
  ) {
    throw new MoldGenerationError(
      "FEATURE_COLLISION",
      "The hex connector is wider than the safe outer wall. Reduce connector width or increase wall thickness.",
      "registration",
    );
  }

  await checkpoint(options, "shell", 0.14, "Creating the outer box");
  const shell = makeBox(kernel, outerMin, outerMax);

  await checkpoint(
    options,
    "cavity",
    0.28,
    "Subtracting the model cavity once",
  );
  const cavityVolumeMm3 = source.volume();
  const cavityShell = shell.subtract(source);
  shell.delete();
  source.delete();
  const [first, second] = cavityShell.splitByPlane([1, 0, 0], seamX);
  cavityShell.delete();
  if (first.isEmpty() || second.isEmpty()) {
    first.delete();
    second.delete();
    throw new MoldGenerationError(
      "EMPTY_MOLD_HALF",
      "The outer box could not be split into two mold halves.",
      "seam",
    );
  }
  const firstBounds = first.boundingBox();
  let front = first;
  let back = second;
  if (firstBounds.max[0] <= seamX + seamTolerance) {
    front = second;
    back = first;
  }

  await checkpoint(
    options,
    "channels",
    0.43,
    "Adding pour channels and funnels",
  );
  for (const gate of gates) {
    const tool = makeGateTool(kernel, gate, outerMax[1], funnelHeight);
    [front, back] = subtractFromBoth(front, back, tool);
  }
  let ventReport: MoldFeatureReport["vent"] = null;
  if (ventPoint && params.ventDiameterMm > 0) {
    const bottom = ventPoint.y - 0.4;
    const height = outerMax[1] - bottom + 0.4;
    const ventTool = makeCylinderY(
      kernel,
      height,
      params.ventDiameterMm / 2,
      params.ventDiameterMm / 2,
      [ventPoint.x, bottom + height / 2, ventPoint.z],
      24,
    );
    [front, back] = subtractFromBoth(front, back, ventTool);
    ventReport = {
      centerXMm: ventPoint.x,
      centerZMm: ventPoint.z,
      surfaceYMm: ventPoint.y,
      diameterMm: params.ventDiameterMm,
    };
  }

  await checkpoint(
    options,
    "registration",
    0.58,
    "Creating registration pins and pockets on every mold piece",
  );
  const pinWidthAcrossFlats = params.segmentConnectorWidthMm;
  const pocketWidthAcrossFlats =
    pinWidthAcrossFlats + params.fitClearanceMm * 2;
  const pinRadius = pinWidthAcrossFlats / Math.sqrt(3);
  const pocketRadius = pocketWidthAcrossFlats / Math.sqrt(3);
  const availableDepth = Math.min(outerMax[0] - seamX, seamX - outerMin[0]);
  const pinDepth = params.segmentConnectorDepthMm;
  const overlap = 0.35;
  if (pinDepth + params.fitClearanceMm + 0.5 > availableDepth) {
    front.delete();
    back.delete();
    throw new MoldGenerationError(
      "FEATURE_COLLISION",
      "The configured hex connector depth exceeds the available inner mold-half depth.",
      "registration",
    );
  }

  // Keep registration features in the solid walls below and above the cavity.
  // Three alternating pin/socket pairs per row and depth segment prevent both
  // the lower and upper edges of every mold piece from sliding.
  const registrationY = bounds.min[1] - params.wallMm * 0.5;
  const upperRegistrationY = bounds.max[1] + params.wallMm * 0.5;
  const segmentSpanZ = (outerMax[2] - outerMin[2]) / depthSegmentCount;
  const registrationRows = [registrationY, upperRegistrationY];
  const registrationSites: Array<{
    y: number;
    z: number;
    frontIsMale: boolean;
  }> = [];
  const baseFractions = [0.22, 0.5, 0.78];
  const fallbackFractions = [
    0.08, 0.12, 0.16, 0.22, 0.28, 0.34, 0.4, 0.46, 0.5, 0.54, 0.6,
    0.66, 0.72, 0.78, 0.84, 0.88, 0.92,
  ];
  const minimumBaseSpacing = pocketRadius * 2 + CONNECTOR_MIN_WEB_MM;
  const corridorDepth = pinDepth + params.fitClearanceMm;
  for (let segmentIndex = 0; segmentIndex < depthSegmentCount; segmentIndex += 1) {
    const segmentMinZ = outerMin[2] + segmentSpanZ * segmentIndex;
    const segmentMaxZ = segmentMinZ + segmentSpanZ;
    const edgeInset = pocketRadius + CONNECTOR_EDGE_MARGIN_MM;
    for (let rowIndex = 0; rowIndex < registrationRows.length; rowIndex += 1) {
      const y = registrationRows[rowIndex]!;
      const selectedZ: number[] = [];
      for (let siteIndex = 0; siteIndex < baseFractions.length; siteIndex += 1) {
        const target = baseFractions[siteIndex]!;
        const candidates = [...new Set([target, ...fallbackFractions])].sort(
          (left, right) => Math.abs(left - target) - Math.abs(right - target),
        );
        const z = candidates
          .map((fraction) => segmentMinZ + segmentSpanZ * fraction)
          .find(
            (candidateZ) =>
              candidateZ >= segmentMinZ + edgeInset &&
              candidateZ <= segmentMaxZ - edgeInset &&
              selectedZ.every(
                (otherZ) => Math.abs(candidateZ - otherZ) >= minimumBaseSpacing,
              ) &&
              seamRegistrationHasSolidCorridor(
                kernel,
                front,
                back,
                seamX,
                y,
                candidateZ,
                corridorDepth,
                pocketRadius,
              ) >= 0.98,
          );
        if (z === undefined) {
          front.delete();
          back.delete();
          throw new MoldGenerationError(
            "FEATURE_COLLISION",
            "A seam connector cannot be placed clear of the pour channel or cavity.",
            "registration",
            `seam-row-${rowIndex + 1}-segment-${segmentIndex + 1}`,
          );
        }
        registrationSites.push({
          y,
          z,
          frontIsMale: (segmentIndex + rowIndex + siteIndex) % 2 === 0,
        });
        selectedZ.push(z);
      }
    }
  }
  if (heightSegmentCount > 1) {
    const heightSpan = outerMax[1] - outerMin[1];
    // Supplemental seam registrations must clear the height-interface pins,
    // which extend by pinDepth on either side of the split plane.
    const rowInset = pinDepth + pocketRadius + CONNECTOR_MIN_WEB_MM;
    const minimumSiteSpacing = pocketRadius * 2 + CONNECTOR_MIN_WEB_MM;
    const candidateFractions = [0.18, 0.32, 0.5, 0.68, 0.82];
    for (
      let boundaryIndex = 0;
      boundaryIndex < heightSegmentCount - 1;
      boundaryIndex += 1
    ) {
      const planeY =
        outerMin[1] +
        (heightSpan * (boundaryIndex + 1)) / heightSegmentCount;
      for (const rowDirection of [-1, 1] as const) {
        const y = planeY + rowDirection * rowInset;
        for (
          let depthIndex = 0;
          depthIndex < depthSegmentCount;
          depthIndex += 1
        ) {
          const segmentMinZ = outerMin[2] + segmentSpanZ * depthIndex;
          const segmentMaxZ = segmentMinZ + segmentSpanZ;
          const selectedZ: number[] = [];
          const candidateZ = [
            segmentMinZ + Math.min(params.wallMm / 2, segmentSpanZ / 2),
            segmentMaxZ - Math.min(params.wallMm / 2, segmentSpanZ / 2),
            ...candidateFractions.map(
              (fraction) => segmentMinZ + segmentSpanZ * fraction,
            ),
          ];
          for (const z of candidateZ) {
            if (
              selectedZ.some(
                (otherZ) => Math.abs(z - otherZ) < minimumSiteSpacing,
              )
            ) {
              continue;
            }
            const coverage = heightInterfaceHasAnchoredHexRoot(
              kernel,
              back,
              front,
              seamX,
              { longitudinal: z, transverse: y, side: "inner" },
              pocketRadius,
            );
            if (coverage < 0.98) continue;
            registrationSites.push({
              y,
              z,
              frontIsMale:
                (boundaryIndex +
                  (rowDirection > 0 ? 1 : 0) +
                  depthIndex +
                  selectedZ.length) %
                  2 ===
                0,
            });
            selectedZ.push(z);
            if (selectedZ.length === 2) break;
          }
        }
      }
    }
  }
  const registrationWeb = Math.min(
    ...registrationRows.flatMap((y) => [
      Math.min(Math.abs(y - bounds.min[1]), Math.abs(y - bounds.max[1])) -
        pocketRadius,
      Math.min(Math.abs(y - outerMin[1]), Math.abs(y - outerMax[1])) -
        pocketRadius,
    ]),
  );
  if (registrationWeb <= 0.5) {
    front.delete();
    back.delete();
    throw new MoldGenerationError(
      "FEATURE_COLLISION",
      "Registration features violate the safe distance to the cavity or outer edge.",
      "registration",
    );
  }
  for (const site of registrationSites) {
    // Front occupies +X and back occupies -X in assembly coordinates. A male
    // registration body must therefore grow across the seam toward the other
    // half, not back into the half that owns it.
    const direction = site.frontIsMale ? -1 : 1;
    const maleCenterX = seamX + (direction * (pinDepth - overlap)) / 2;
    const socketCenterX =
      seamX +
      (direction * (pinDepth + params.fitClearanceMm - overlap)) / 2;
    const pin = makeCylinderX(
      kernel,
      pinDepth + overlap,
      pinRadius,
      pinRadius,
      [maleCenterX, site.y, site.z],
      6,
    );
    const pocket = makeCylinderX(
      kernel,
      pinDepth + overlap + params.fitClearanceMm,
      pocketRadius,
      pocketRadius,
      [socketCenterX, site.y, site.z],
      6,
    );
    if (site.frontIsMale) {
      front = addOwned(front, pin);
      back = subtractOwned(back, pocket);
    } else {
      back = addOwned(back, pin);
      front = subtractOwned(front, pocket);
    }
  }

  await checkpoint(
    options,
    "exterior",
    0.72,
    "Applying exterior grooves and pry pockets",
  );
  const grooveDepth = params.rubberBandGrooves
    ? Math.min(0.8, params.wallMm * 0.15)
    : 0;
  const grooveWidth = Math.min(2.4, params.wallMm * 0.7);
  let grooveCount = 0;
  if (params.rubberBandGrooves) {
    for (const fraction of [0.34, 0.66]) {
      const centerY = bounds.min[1] + bounds.size[1] * fraction;
      const groove = makeGrooveShell(
        kernel,
        outerMin,
        outerMax,
        centerY,
        grooveWidth,
        grooveDepth,
      );
      [front, back] = subtractFromBoth(front, back, groove);
      grooveCount += 1;
    }
  }

  const pryDepth = params.pryPockets
    ? Math.min(3, Math.max(1, params.wallMm * 0.3))
    : 0;
  let pryCount = 0;
  if (params.pryPockets) {
    for (const z of [outerMin[2], outerMax[2]]) {
      const pry = makeSphere(kernel, pryDepth, [seamX, bounds.center[1], z]);
      [front, back] = subtractFromBoth(front, back, pry);
      pryCount += 1;
    }
  }

  const wallSamples = sampleAxisWallDistances(mesh, outerMin, outerMax);
  const estimatedMinimumWallMm = Math.min(
    ...wallSamples,
    params.wallMm - grooveDepth,
    registrationWeb,
    sideMargin - pryDepth,
  );
  if (estimatedMinimumWallMm <= 0.5) {
    front.delete();
    back.delete();
    throw new MoldGenerationError(
      "FEATURE_COLLISION",
      "An exterior feature violates the safe remaining wall.",
      params.rubberBandGrooves ? "rubber-band-groove" : "pry-pocket",
    );
  }

  await checkpoint(
    options,
    "orienting",
    0.87,
    "Orienting mold halves onto flat print surfaces",
  );
  front = orientForPrinting(front, "front", outerMin[0], outerMax[0]);
  back = orientForPrinting(back, "back", outerMin[0], outerMax[0]);
  const frontMesh = manifoldToTriangleMesh(front);
  const backMesh = manifoldToTriangleMesh(back);
  const frontMetrics = measurePart(front, "front", frontMesh);
  const backMetrics = measurePart(back, "back", backMesh);
  front.delete();
  back.delete();

  let parts: MoldGenerationResult["parts"] = [
    {
      id: "front",
      side: "front",
      mesh: frontMesh,
      metrics: frontMetrics,
      segmentIndex: 0,
      segmentCount: 1,
      heightSegmentIndex: 0,
      heightSegmentCount: 1,
      depthSegmentIndex: 0,
      depthSegmentCount: 1,
    },
    {
      id: "back",
      side: "back",
      mesh: backMesh,
      metrics: backMetrics,
      segmentIndex: 0,
      segmentCount: 1,
      heightSegmentIndex: 0,
      heightSegmentCount: 1,
      depthSegmentIndex: 0,
      depthSegmentCount: 1,
    },
  ];
  if (resolvedPieceCount > 2) {
    const minX = Math.min(frontMetrics.bounds.min[0], backMetrics.bounds.min[0]);
    const maxX = Math.max(frontMetrics.bounds.max[0], backMetrics.bounds.max[0]);
    const minZ = Math.min(
      frontMetrics.bounds.min[2],
      backMetrics.bounds.min[2],
    );
    const maxZ = Math.max(
      frontMetrics.bounds.max[2],
      backMetrics.bounds.max[2],
    );
    const depthOffsets = Array.from(
      { length: depthSegmentCount - 1 },
      (_, index) => minZ + ((maxZ - minZ) * (index + 1)) / depthSegmentCount,
    );
    const heightOffsets = Array.from(
      { length: heightSegmentCount - 1 },
      (_, index) => minX + ((maxX - minX) * (index + 1)) / heightSegmentCount,
    );
    let [frontGrid, backGrid] = await Promise.all([
      splitMeshGrid({ mesh: frontMesh, metrics: frontMetrics }, heightOffsets, depthOffsets),
      splitMeshGrid({ mesh: backMesh, metrics: backMetrics }, heightOffsets, depthOffsets),
    ]);

    const addConnectors = (grid: MultiSplitPart[][], sideOffset: number): MultiSplitPart[][] => {
      const hasCrossingInterfaces =
        heightOffsets.length > 0 && depthOffsets.length > 0;
      if (heightOffsets.length > 0) {
        grid = grid.map((column, depthIndex) =>
          addInterHeightRegistration(
            kernel,
            column,
            heightOffsets,
            params.wallMm,
            params.segmentConnectorWidthMm,
            params.segmentConnectorDepthMm,
            params.fitClearanceMm,
            sideOffset + depthIndex,
            hasCrossingInterfaces ? 1 : 0,
          ),
        );
      }
      if (depthOffsets.length > 0) {
        for (let heightIndex = 0; heightIndex < heightSegmentCount; heightIndex += 1) {
          const row = grid.map((column) => column[heightIndex]!);
          const connected = addInterSegmentRegistration(
            kernel,
            row,
            depthOffsets,
            params.wallMm,
            params.segmentConnectorWidthMm,
            params.segmentConnectorDepthMm,
            params.fitClearanceMm,
            sideOffset + heightIndex,
            hasCrossingInterfaces ? -1 : 0,
          );
          connected.forEach((segment, depthIndex) => {
            grid[depthIndex]![heightIndex] = segment;
          });
        }
      }
      return grid;
    };
    frontGrid = addConnectors(frontGrid, 0);
    backGrid = addConnectors(backGrid, 1);

    const makeParts = (
      side: "front" | "back",
      grid: MultiSplitPart[][],
    ): MoldGenerationResult["parts"] =>
      grid.flatMap((column, depthIndex) =>
        column.map((segment, heightIndex) => ({
          id: `${side}-h${String(heightIndex + 1).padStart(2, "0")}-d${String(depthIndex + 1).padStart(2, "0")}` as MoldGenerationResult["parts"][number]["id"],
          side,
          mesh: segment.mesh,
          metrics: printableMetrics(segment.mesh, segment.metrics),
          segmentIndex: depthIndex * heightSegmentCount + heightIndex,
          segmentCount: segmentsPerSide,
          heightSegmentIndex: heightIndex,
          heightSegmentCount,
          depthSegmentIndex: depthIndex,
          depthSegmentCount,
        })),
      );
    parts = [...makeParts("front", frontGrid), ...makeParts("back", backGrid)];
  }

  const buildVolume: [number, number, number] = [
    params.printBedWidthMm,
    params.printBedDepthMm,
    params.printBedHeightMm,
  ];
  const fittingPartCount = parts.filter((part) =>
    partFitsPrintVolume(part.metrics, buildVolume),
  ).length;
  const allPartsFit = fittingPartCount === parts.length;
  if (params.splitOversizedByHeight && !allPartsFit) {
    throw new MoldGenerationError(
      "PRINT_VOLUME_EXCEEDED",
      "At least one mold segment still exceeds the configured print volume.",
      "seam",
    );
  }
  const segmentConnectorCount =
    10 *
    (depthSegmentCount * Math.max(0, heightSegmentCount - 1) +
      heightSegmentCount * Math.max(0, depthSegmentCount - 1));
  const materialEstimate = estimateMoldMaterialUsage(
    parts.map((part) => part.metrics),
    cavityVolumeMm3,
    params.material,
    params.infillPercent,
    params.wallLoops,
  );

  await checkpoint(
    options,
    "complete",
    1,
    `${resolvedPieceCount}-part mold generated locally`,
  );
  return {
    kind: "mold",
    front: frontMesh,
    back: backMesh,
    frontMetrics,
    backMetrics,
    parts,
    resolvedPieceCount,
    features: {
      seamXMm: seamX,
      cavityVolumeMm3,
      outerBounds: { min: outerMin, max: outerMax },
      gates,
      vent: ventReport,
      registration: {
        style: "hex",
        count: registrationSites.length,
        widthAcrossFlatsMm: pinWidthAcrossFlats,
        pocketWidthAcrossFlatsMm: pocketWidthAcrossFlats,
        depthMm: pinDepth,
        clearanceMm: params.fitClearanceMm,
      },
      segmentConnectors: {
        style: "hex",
        count: segmentConnectorCount,
        depthPerInterface: 5,
        heightPerInterface: 5,
        depthSidesPerInterface: 4,
        heightSidesPerInterface: 4,
        widthAcrossFlatsMm: params.segmentConnectorWidthMm,
        depthMm: params.segmentConnectorDepthMm,
        clearanceMm: params.fitClearanceMm,
      },
      printVolume: {
        buildVolumeMm: buildVolume,
        depthSegmentCount,
        heightSegmentCount,
        fittingPartCount,
        allPartsFit,
      },
      materialEstimate,
      rubberBandGrooves: {
        enabled: params.rubberBandGrooves,
        count: grooveCount,
        depthMm: grooveDepth,
      },
      pryPockets: {
        enabled: params.pryPockets,
        count: pryCount,
        depthMm: pryDepth,
      },
      narrowOpenings: {
        enabled: params.closeNarrowOpenings,
        thresholdMm: params.narrowOpeningThresholdMm,
        removedVolumeMm3: narrowOpeningRemovedVolumeMm3,
      },
      estimatedMinimumWallMm,
      wallSampleCount: wallSamples.length,
    },
    params: structuredClone(params),
    totalDurationMs: now() - startedAt,
  };
}

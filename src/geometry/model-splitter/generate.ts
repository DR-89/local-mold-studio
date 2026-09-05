import type {
  Manifold as ManifoldSolid,
  ManifoldToplevel,
  Mat4,
} from "manifold-3d";
import {
  estimateFilamentUsage,
  modelSplitterConnectorPolicy,
  MODEL_SPLITTER_LIMITS,
  MODEL_SPLITTER_MAX_PARTS,
  MODEL_SPLITTER_MAX_SEGMENTS_PER_AXIS,
  validateModelSplitterParams,
  type ModelSplitterConnectorStyle,
  type ModelSplitterParams,
} from "../../domain/model-splitter";
import {
  manifoldToTriangleMesh,
  measureSolid,
  triangleMeshToManifold,
} from "../kernel/adapter";
import { loadManifold } from "../kernel/loader";
import { calculateMeshBounds } from "../mold/placement";
import { createSplitPlan, dimensionsFitBuildVolume } from "./planner";
import type { TriangleMeshData } from "../../workers/protocol";
import {
  ModelSplitterError,
  type ModelSplitAxis,
  type ModelSplitConnectorReport,
  type ModelSplitPartId,
  type ModelSplitterGenerationOptions,
  type ModelSplitterGenerationResult,
  type SmartCutQuality,
} from "./types";

type SplitSign = -1 | 1;
type GridIndex = [number, number, number];
type Direction = { x: -1 | 0 | 1; y: -1 | 0 | 1; z: -1 | 0 | 1 };
type WorkingPart = {
  id: ModelSplitPartId;
  gridIndex: GridIndex;
  direction: Direction;
  solid: ManifoldSolid;
};

type Vector3Tuple = [number, number, number];

type AxisDefinition = {
  axis: ModelSplitAxis;
  normal: Vector3Tuple;
  dimension: 0 | 1 | 2;
};

type PlaneFrame = {
  normal: Vector3Tuple;
  worldToPlane: Mat4;
  planeToWorld: Mat4;
};

function dotVector(
  left: Readonly<Vector3Tuple>,
  right: Readonly<Vector3Tuple>,
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function normalizeVector(vector: Readonly<Vector3Tuple>): Vector3Tuple {
  const length = Math.hypot(...vector);
  if (length <= 1e-9) return [0, 0, 1];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function crossVector(
  left: Readonly<Vector3Tuple>,
  right: Readonly<Vector3Tuple>,
): Vector3Tuple {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function offsetPoint(
  point: Readonly<Vector3Tuple>,
  normal: Readonly<Vector3Tuple>,
  distance: number,
): Vector3Tuple {
  return [
    point[0] + normal[0] * distance,
    point[1] + normal[1] * distance,
    point[2] + normal[2] * distance,
  ];
}

function planeFrame(normalInput: Readonly<Vector3Tuple>): PlaneFrame {
  const normal = normalizeVector(normalInput);
  const reference: Vector3Tuple =
    Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalizeVector(crossVector(reference, normal));
  const v = normalizeVector(crossVector(normal, u));
  return {
    normal,
    worldToPlane: [
      u[0],
      v[0],
      normal[0],
      0,
      u[1],
      v[1],
      normal[1],
      0,
      u[2],
      v[2],
      normal[2],
      0,
      0,
      0,
      0,
      1,
    ],
    planeToWorld: [
      u[0],
      u[1],
      u[2],
      0,
      v[0],
      v[1],
      v[2],
      0,
      normal[0],
      normal[1],
      normal[2],
      0,
      0,
      0,
      0,
      1,
    ],
  };
}

function transformPoint(
  point: Readonly<Vector3Tuple>,
  matrix: Readonly<Mat4>,
): Vector3Tuple {
  return [
    matrix[0] * point[0] +
      matrix[4] * point[1] +
      matrix[8] * point[2] +
      matrix[12],
    matrix[1] * point[0] +
      matrix[5] * point[1] +
      matrix[9] * point[2] +
      matrix[13],
    matrix[2] * point[0] +
      matrix[6] * point[1] +
      matrix[10] * point[2] +
      matrix[14],
  ];
}

function isAxisAlignedDefinition(definition: AxisDefinition): boolean {
  const expected = AXES.find((entry) => entry.axis === definition.axis)?.normal;
  return Boolean(
    expected &&
      Math.abs(definition.normal[0] - expected[0]) <= 1e-7 &&
      Math.abs(definition.normal[1] - expected[1]) <= 1e-7 &&
      Math.abs(definition.normal[2] - expected[2]) <= 1e-7,
  );
}

type LabelAnchor = {
  axis: ModelSplitAxis;
  center: [number, number, number];
  inwardDirection: SplitSign;
};

const AXES: AxisDefinition[] = [
  { axis: "x", normal: [1, 0, 0], dimension: 0 },
  { axis: "y", normal: [0, 1, 0], dimension: 1 },
  { axis: "z", normal: [0, 0, 1], dimension: 2 },
];
function splitPlaneDefinition(
  definition: AxisDefinition,
  plane: { normal?: Vector3Tuple },
): AxisDefinition {
  return plane.normal
    ? { ...definition, normal: normalizeVector(plane.normal) }
    : definition;
}

function splitPlaneOffset(
  plane: { positionMm: number; planeOffsetMm?: number },
): number {
  return plane.planeOffsetMm ?? plane.positionMm;
}
const MAX_AUTOMATIC_CONNECTOR_SCALE = 20;
const AUTOMATIC_CONNECTOR_SPACING_DIAMETERS = 8;
const MICRO_CONNECTOR_DIAMETER_MM = 0.8;
const MICRO_CONNECTOR_STEP_MM = 0.1;
const MICRO_CONNECTOR_WALL_MM = 0.2;

function polygonSignedArea(
  polygon: ReadonlyArray<Readonly<[number, number]>>,
): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function partId(index: GridIndex, counts: GridIndex): ModelSplitPartId {
  if (counts[0] * counts[1] * counts[2] === 1) return "whole";
  return `x${String(index[0] + 1).padStart(2, "0")}_y${String(index[1] + 1).padStart(2, "0")}_z${String(index[2] + 1).padStart(2, "0")}`;
}

function partKey(index: GridIndex): string {
  return `${index[0]}:${index[1]}:${index[2]}`;
}

function directionFor(index: GridIndex, counts: GridIndex): Direction {
  const sign = (value: number, count: number): -1 | 0 | 1 => {
    const offset = value - (count - 1) / 2;
    return offset < 0 ? -1 : offset > 0 ? 1 : 0;
  };
  return {
    x: sign(index[0], counts[0]),
    y: sign(index[1], counts[1]),
    z: sign(index[2], counts[2]),
  };
}

function assemblyLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function axisValue(
  point: [number, number, number],
  dimension: 0 | 1 | 2,
): number {
  return point[dimension];
}

function withAxis(
  point: [number, number, number],
  dimension: 0 | 1 | 2,
  value: number,
): [number, number, number] {
  const next: [number, number, number] = [...point];
  next[dimension] = value;
  return next;
}

function orientAlongAxis(
  primitive: ManifoldSolid,
  axis: ModelSplitAxis,
): ManifoldSolid {
  if (axis === "x") return primitive.rotate([0, 90, 0]);
  if (axis === "y") return primitive.rotate([-90, 0, 0]);
  return primitive;
}

function orientAlongPlaneNormal(
  primitive: ManifoldSolid,
  axisOrNormal: ModelSplitAxis | Readonly<Vector3Tuple>,
): ManifoldSolid {
  if (typeof axisOrNormal === "string") {
    return orientAlongAxis(primitive, axisOrNormal);
  }
  return primitive.transform(planeFrame(axisOrNormal).planeToWorld);
}

type ConnectorSolidRole = "solid" | "male" | "socket";

function makeConnectorSolid(
  kernel: ManifoldToplevel,
  axisOrNormal: ModelSplitAxis | Readonly<Vector3Tuple>,
  length: number,
  diameter: number,
  center: [number, number, number],
  style: ModelSplitterConnectorStyle,
  role: ConnectorSolidRole = "solid",
  direction: SplitSign = 1,
): ManifoldSolid {
  let primitive: ManifoldSolid;
  if (style === "dovetail" && role === "male" && diameter >= 4) {
    const gap = Math.max(0.8, diameter * 0.12);
    const barbExtension = Math.min(diameter * 0.1, (diameter - gap) * 0.1);
    const armWidth = Math.max(0.8, (diameter - gap) / 2 - barbExtension);
    const barbWidth = armWidth + barbExtension;
    const height = diameter * 0.5;
    const rootLength = Math.max(1, Math.min(length * 0.22, diameter * 0.3));
    const barbLength = Math.max(1, Math.min(length * 0.2, diameter * 0.25));
    const armOffset = gap / 2 + armWidth / 2;
    const barbOffset = gap / 2 + barbWidth / 2;
    const parts = [
      kernel.Manifold.cube([armWidth, height, length], true).translate([
        -armOffset,
        0,
        0,
      ]),
      kernel.Manifold.cube([armWidth, height, length], true).translate([
        armOffset,
        0,
        0,
      ]),
      kernel.Manifold.cube(
        [diameter - gap, height, rootLength],
        true,
      ).translate([0, 0, -length / 2 + rootLength / 2]),
      kernel.Manifold.cube(
        [barbWidth, height * 1.08, barbLength],
        true,
      ).translate([-barbOffset, 0, length / 2 - barbLength / 2]),
      kernel.Manifold.cube(
        [barbWidth, height * 1.08, barbLength],
        true,
      ).translate([barbOffset, 0, length / 2 - barbLength / 2]),
    ];
    primitive = kernel.Manifold.union(parts);
    parts.forEach((part) => part.delete());
  } else if (style === "dovetail" && role === "socket" && diameter >= 4) {
    // The enlarged rectangular pocket gives both arms room to flex inward
    // during insertion and retains their two outward-facing snap barbs.
    primitive = kernel.Manifold.cube([diameter, diameter * 0.56, length], true);
  } else if (style === "dovetail") {
    const halfWidth = diameter / 2;
    const halfHeight = diameter * 0.32;
    const neckWidth = halfWidth * 0.58;
    const section = new kernel.CrossSection([
      [
        [-halfWidth, -halfHeight],
        [halfWidth, -halfHeight],
        [neckWidth, halfHeight],
        [-neckWidth, halfHeight],
      ],
    ]);
    primitive = section.extrude(length, 0, 0, [1, 1], true);
    section.delete();
  } else {
    const circularSegments = style === "hex" ? 6 : 48;
    primitive = kernel.Manifold.cylinder(
      length,
      diameter / 2,
      diameter / 2,
      circularSegments,
      true,
    );
  }
  const directed =
    role === "male" && direction < 0
      ? primitive.rotate([0, 180, 0])
      : primitive;
  if (directed !== primitive) primitive.delete();
  const oriented = orientAlongPlaneNormal(directed, axisOrNormal);
  if (oriented !== directed) directed.delete();
  const result = oriented.translate(center);
  oriented.delete();
  return result;
}

async function checkpoint(
  options: ModelSplitterGenerationOptions,
  stage: Parameters<
    NonNullable<ModelSplitterGenerationOptions["onProgress"]>
  >[0]["stage"],
  progress: number,
  message: string,
): Promise<void> {
  if (options.isCancelled?.()) {
    throw new ModelSplitterError("CANCELLED", "Model splitting cancelled.");
  }
  options.onProgress?.({ stage, progress, message });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (options.isCancelled?.()) {
    throw new ModelSplitterError("CANCELLED", "Model splitting cancelled.");
  }
}

function percentValue(min: number, max: number, percent: number): number {
  return min + (max - min) * (0.5 + percent / 200);
}

function evenlySpaced(min: number, max: number, count: number): number[] {
  if (count <= 1) return [(min + max) / 2];
  return Array.from(
    { length: count },
    (_, index) => min + ((max - min) * (index + 1)) / (count + 1),
  );
}

function connectorSafetyWall(
  connectorRadius: number,
  connectorDepth: number,
): {
  radial: number;
  end: number;
} {
  return {
    radial:
      connectorRadius * 2 < MODEL_SPLITTER_LIMITS.connectorDiameterMm.min
        ? Math.max(MICRO_CONNECTOR_WALL_MM, connectorRadius * 0.35)
        : Math.max(1.2, Math.min(30, connectorRadius * 0.35)),
    end: Math.max(1.2, Math.min(30, connectorDepth * 0.3)),
  };
}

function connectorGuardTolerance(guardVolume: number): number {
  // A relative tolerance of 1e-7 allowed visible pinholes for very large
  // connectors because their guard volumes can reach several million mm³.
  // Keep only a tiny numerical tolerance so a socket can never consume the
  // exterior shell, regardless of model scale.
  return Math.max(1e-7, Math.min(1e-3, guardVolume * 1e-10));
}

function makeConnectorGuard(
  kernel: ManifoldToplevel,
  definition: AxisDefinition,
  center: [number, number, number],
  direction: SplitSign,
  connectorRadius: number,
  connectorDepth: number,
  clearance: number,
  gluePocket: number,
): ManifoldSolid {
  const { radial: radialWall, end: endWall } = connectorSafetyWall(
    connectorRadius,
    connectorDepth,
  );
  const guardRadius = connectorRadius + clearance + radialWall;
  const guardLength = connectorDepth + gluePocket + endWall;
  const guardCenter = offsetPoint(
    center,
    definition.normal,
    (direction * guardLength) / 2,
  );
  // Always use a round guard. It fully encloses hex and dovetail sockets and
  // protects the shell in the corners between their profile vertices as well.
  return makeConnectorSolid(
    kernel,
    definition.normal,
    guardLength,
    guardRadius * 2,
    guardCenter,
    "pin",
  );
}

function isSafeConnectorSide(
  kernel: ManifoldToplevel,
  solid: ManifoldSolid,
  definition: AxisDefinition,
  center: [number, number, number],
  direction: SplitSign,
  connectorRadius: number,
  connectorDepth: number,
  clearance: number,
  gluePocket: number,
): boolean {
  const guard = makeConnectorGuard(
    kernel,
    definition,
    center,
    direction,
    connectorRadius,
    connectorDepth,
    clearance,
    gluePocket,
  );
  const guardVolume = guard.volume();
  const outside = guard.subtract(solid);
  const outsideToleranceMm3 = connectorGuardTolerance(guardVolume);
  const supported = outside.volume() <= outsideToleranceMm3;
  outside.delete();
  guard.delete();
  return supported;
}

function hasProtectedConnectorCollar(
  kernel: ManifoldToplevel,
  original: ManifoldSolid,
  withSocket: ManifoldSolid,
  socket: ManifoldSolid,
  definition: AxisDefinition,
  center: [number, number, number],
  direction: SplitSign,
  connectorRadius: number,
  connectorDepth: number,
  clearance: number,
  gluePocket: number,
): boolean {
  const guard = makeConnectorGuard(
    kernel,
    definition,
    center,
    direction,
    connectorRadius,
    connectorDepth,
    clearance,
    gluePocket,
  );
  const outsideBefore = guard.subtract(original);
  const collar = guard.subtract(socket);
  const missingAfter = collar.subtract(withSocket);
  const tolerance = connectorGuardTolerance(guard.volume());
  const protectedShell =
    outsideBefore.volume() <= tolerance && missingAfter.volume() <= tolerance;
  outsideBefore.delete();
  missingAfter.delete();
  collar.delete();
  guard.delete();
  return protectedShell;
}

function isSafeConnectorCenter(
  kernel: ManifoldToplevel,
  negative: ManifoldSolid,
  positive: ManifoldSolid,
  definition: AxisDefinition,
  center: [number, number, number],
  connectorRadius: number,
  connectorDepth: number,
  clearance: number,
  gluePocket: number,
): boolean {
  return (
    isSafeConnectorSide(
      kernel,
      negative,
      definition,
      center,
      -1,
      connectorRadius,
      connectorDepth,
      clearance,
      gluePocket,
    ) &&
    isSafeConnectorSide(
      kernel,
      positive,
      definition,
      center,
      1,
      connectorRadius,
      connectorDepth,
      clearance,
      gluePocket,
    )
  );
}
function hasMatingInterface(
  negative: ManifoldSolid,
  positive: ManifoldSolid,
  definition: AxisDefinition,
): boolean {
  const probeDepth = 0.2;
  const translation: [number, number, number] = [0, 0, 0];
  translation[definition.dimension] = probeDepth;
  const shiftedNegative = negative.translate(translation);
  const overlap = shiftedNegative.intersect(positive);
  const hasArea = overlap.volume() > 1e-4;
  overlap.delete();
  shiftedNegative.delete();
  return hasArea;
}
function squaredDistance(
  left: readonly number[],
  right: readonly number[],
): number {
  return left.reduce(
    (sum, value, index) => sum + (value - (right[index] ?? 0)) ** 2,
    0,
  );
}

function selectDistributedCenters(
  candidates: Array<[number, number, number]>,
  maximum: number,
): Array<[number, number, number]> {
  const limit = Math.max(0, Math.min(maximum, candidates.length));
  if (limit === 0) return [];
  if (candidates.length <= limit) return candidates;
  if (limit === 1) {
    const centroid = [0, 1, 2].map(
      (dimension) =>
        candidates.reduce((sum, center) => sum + center[dimension], 0) /
        candidates.length,
    );
    return [
      candidates.reduce((best, center) =>
        squaredDistance(center, centroid) < squaredDistance(best, centroid)
          ? center
          : best,
      ),
    ];
  }

  let firstIndex = 0;
  let secondIndex = 1;
  let greatestDistance = -1;
  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      const distance = squaredDistance(candidates[first], candidates[second]);
      if (distance > greatestDistance) {
        firstIndex = first;
        secondIndex = second;
        greatestDistance = distance;
      }
    }
  }
  const selectedIndices = [firstIndex, secondIndex];
  while (selectedIndices.length < limit) {
    let bestIndex = -1;
    let bestDistance = -1;
    for (
      let candidateIndex = 0;
      candidateIndex < candidates.length;
      candidateIndex += 1
    ) {
      if (selectedIndices.includes(candidateIndex)) continue;
      const nearestSelected = Math.min(
        ...selectedIndices.map((selectedIndex) =>
          squaredDistance(
            candidates[candidateIndex],
            candidates[selectedIndex],
          ),
        ),
      );
      if (nearestSelected > bestDistance) {
        bestIndex = candidateIndex;
        bestDistance = nearestSelected;
      }
    }
    if (bestIndex < 0) break;
    selectedIndices.push(bestIndex);
  }
  return selectedIndices.map((index) => candidates[index]);
}

function cutFaceCandidateCenters(
  solid: ManifoldSolid,
  definition: AxisDefinition,
  planeOffset: number,
): {
  centers: Array<[number, number, number]>;
  totalArea: number;
} {
  const mesh = solid.getMesh();
  const transverse = ([0, 1, 2] as const).filter(
    (dimension) => dimension !== definition.dimension,
  );
  const triangleCenters: Array<{
    center: [number, number, number];
    area: number;
  }> = [];
  const weightedCenter: [number, number, number] = [0, 0, 0];
  let totalArea = 0;
  const point = (vertex: number): [number, number, number] => {
    const offset = vertex * mesh.numProp;
    return [
      mesh.vertProperties[offset] ?? 0,
      mesh.vertProperties[offset + 1] ?? 0,
      mesh.vertProperties[offset + 2] ?? 0,
    ];
  };
  for (let triangle = 0; triangle < mesh.triVerts.length; triangle += 3) {
    const points = [
      point(mesh.triVerts[triangle] ?? 0),
      point(mesh.triVerts[triangle + 1] ?? 0),
      point(mesh.triVerts[triangle + 2] ?? 0),
    ] as const;
    if (
      points.some(
        (candidate) =>
          Math.abs(candidate[definition.dimension] - planeOffset) > 1e-4,
      )
    )
      continue;
    const first = points[0];
    const second = points[1];
    const third = points[2];
    const area =
      Math.abs(
        (second[transverse[0]] - first[transverse[0]]) *
          (third[transverse[1]] - first[transverse[1]]) -
          (second[transverse[1]] - first[transverse[1]]) *
            (third[transverse[0]] - first[transverse[0]]),
      ) / 2;
    if (area <= 1e-8) continue;
    const center: [number, number, number] = [
      (first[0] + second[0] + third[0]) / 3,
      (first[1] + second[1] + third[1]) / 3,
      (first[2] + second[2] + third[2]) / 3,
    ];
    center[definition.dimension] = planeOffset;
    triangleCenters.push({ center, area });
    totalArea += area;
    for (let dimension = 0; dimension < 3; dimension += 1) {
      weightedCenter[dimension] += center[dimension] * area;
    }
  }
  if (totalArea <= 0) return { centers: [], totalArea: 0 };
  for (let dimension = 0; dimension < 3; dimension += 1) {
    weightedCenter[dimension] /= totalArea;
  }
  weightedCenter[definition.dimension] = planeOffset;
  return {
    centers: [
      weightedCenter,
      ...triangleCenters
        .sort((left, right) => right.area - left.area)
        .slice(0, 12)
        .map((candidate) => candidate.center),
    ],
    totalArea,
  };
}
function findConnectorCenters(
  kernel: ManifoldToplevel,
  negative: ManifoldSolid,
  positive: ManifoldSolid,
  definition: AxisDefinition,
  planeOffset: number,
  connectorRadius: number,
  connectorDepth: number,
  clearance: number,
  gluePocket: number,
  spacing: number,
  manualPosition: [number, number] | null,
  maxConnectors: number,
  cutFaceCenters: readonly [number, number, number][],
): { centers: Array<[number, number, number]>; requested: number } {
  const negativeBounds = negative.boundingBox();
  const positiveBounds = positive.boundingBox();
  const dimensions = ([0, 1, 2] as const).filter(
    (dimension) => dimension !== definition.dimension,
  );
  const inset =
    connectorRadius +
    clearance +
    (connectorRadius * 2 < MODEL_SPLITTER_LIMITS.connectorDiameterMm.min
      ? MICRO_CONNECTOR_WALL_MM
      : 0.5);
  const firstMin =
    Math.max(
      negativeBounds.min[dimensions[0]],
      positiveBounds.min[dimensions[0]],
    ) + inset;
  const firstMax =
    Math.min(
      negativeBounds.max[dimensions[0]],
      positiveBounds.max[dimensions[0]],
    ) - inset;
  const secondMin =
    Math.max(
      negativeBounds.min[dimensions[1]],
      positiveBounds.min[dimensions[1]],
    ) + inset;
  const secondMax =
    Math.min(
      negativeBounds.max[dimensions[1]],
      positiveBounds.max[dimensions[1]],
    ) - inset;
  if (firstMax < firstMin || secondMax < secondMin)
    return { centers: [], requested: 1 };

  const firstSpan = Math.max(0, firstMax - firstMin);
  const secondSpan = Math.max(0, secondMax - secondMin);
  let firstCount = manualPosition
    ? 1
    : Math.max(1, Math.ceil((firstSpan + connectorRadius * 2) / spacing));
  let secondCount = manualPosition
    ? 1
    : Math.max(1, Math.ceil((secondSpan + connectorRadius * 2) / spacing));
  const faceBudget = Math.max(1, maxConnectors);
  while (firstCount * secondCount > 64) {
    const firstCellSpan = firstSpan / Math.max(1, firstCount);
    const secondCellSpan = secondSpan / Math.max(1, secondCount);
    if (
      firstCount > 1 &&
      (firstCellSpan <= secondCellSpan || secondCount === 1)
    ) {
      firstCount -= 1;
    } else if (secondCount > 1) {
      secondCount -= 1;
    } else {
      break;
    }
  }
  const requested = Math.min(firstCount * secondCount, faceBudget);
  let firstSearchCount = manualPosition
    ? 1
    : Math.max(firstCount, firstSpan > 0 ? 5 : 1);
  let secondSearchCount = manualPosition
    ? 1
    : Math.max(secondCount, secondSpan > 0 ? 5 : 1);
  while (firstSearchCount * secondSearchCount > 64) {
    if (firstSearchCount >= secondSearchCount && firstSearchCount > 1) {
      firstSearchCount -= 1;
    } else if (secondSearchCount > 1) {
      secondSearchCount -= 1;
    } else {
      break;
    }
  }
  const firstValues = manualPosition
    ? [percentValue(firstMin, firstMax, manualPosition[0])]
    : evenlySpaced(firstMin, firstMax, firstSearchCount);
  const secondValues = manualPosition
    ? [percentValue(secondMin, secondMax, manualPosition[1])]
    : evenlySpaced(secondMin, secondMax, secondSearchCount);
  const centers: Array<[number, number, number]> = [];
  const alreadySelected = (center: readonly number[]) =>
    centers.some((selected) => squaredDistance(selected, center) < 1e-6);
  for (const center of cutFaceCenters) {
    if (alreadySelected(center)) continue;
    if (
      isSafeConnectorCenter(
        kernel,
        negative,
        positive,
        definition,
        center,
        connectorRadius,
        connectorDepth,
        clearance,
        gluePocket,
      )
    ) {
      centers.push(center);
      if (centers.length >= requested) {
        return {
          centers: selectDistributedCenters(centers, requested),
          requested,
        };
      }
    }
  }

  for (const first of firstValues) {
    for (const second of secondValues) {
      let center: [number, number, number] = [0, 0, 0];
      center = withAxis(center, definition.dimension, planeOffset);
      center = withAxis(center, dimensions[0], first);
      center = withAxis(center, dimensions[1], second);
      if (alreadySelected(center)) continue;
      if (
        isSafeConnectorCenter(
          kernel,
          negative,
          positive,
          definition,
          center,
          connectorRadius,
          connectorDepth,
          clearance,
          gluePocket,
        )
      ) {
        centers.push(center);
        if (centers.length >= requested) {
          return {
            centers: selectDistributedCenters(centers, requested),
            requested,
          };
        }
      }
    }
  }
  return { centers: selectDistributedCenters(centers, requested), requested };
}

type ConnectorPlacement = {
  center: [number, number, number];
  diameterMm: number;
  depthMm: number;
};

function adaptiveConnectorDiameter(
  negative: ManifoldSolid,
  positive: ManifoldSolid,
  definition: AxisDefinition,
  baseDiameter: number,
  clearance: number,
): number {
  const negativeBounds = negative.boundingBox();
  const positiveBounds = positive.boundingBox();
  const dimensions = ([0, 1, 2] as const).filter(
    (dimension) => dimension !== definition.dimension,
  );
  const spans = dimensions.map((dimension) =>
    Math.max(
      0,
      Math.min(negativeBounds.max[dimension], positiveBounds.max[dimension]) -
        Math.max(negativeBounds.min[dimension], positiveBounds.min[dimension]),
    ),
  );
  const minorSpan = Math.min(...spans);
  const limits = MODEL_SPLITTER_LIMITS.connectorDiameterMm;
  const maximumThatFits = minorSpan - 2 * (clearance + 0.5);
  const maximumAutomaticDiameter = Math.max(
    baseDiameter,
    Math.min(limits.max, baseDiameter * MAX_AUTOMATIC_CONNECTOR_SCALE),
  );
  const areaScaledTarget = Math.min(
    maximumAutomaticDiameter,
    Math.max(limits.min, minorSpan * 0.35),
  );
  const safeTarget = Math.min(areaScaledTarget, maximumThatFits);
  const quantizedTarget =
    Math.floor((safeTarget + 1e-6) / limits.step) * limits.step;

  return Math.min(limits.max, Math.max(limits.min, quantizedTarget));
}

function adaptiveConnectorDepth(
  negative: ManifoldSolid,
  positive: ManifoldSolid,
  definition: AxisDefinition,
  planeOffset: number,
  diameter: number,
  baseDepth: number,
  maximumDepth: number,
  gluePocket: number,
  interfaceAreaScale: number,
): number {
  const negativeBounds = negative.boundingBox();
  const positiveBounds = positive.boundingBox();
  const negativeThickness = Math.max(
    0,
    planeOffset - negativeBounds.min[definition.dimension],
  );
  const positiveThickness = Math.max(
    0,
    positiveBounds.max[definition.dimension] - planeOffset,
  );

  const limits = MODEL_SPLITTER_LIMITS.connectorDepthMm;
  const materialLimit = Math.max(
    limits.min,
    Math.min(negativeThickness, positiveThickness) - Math.max(0.5, gluePocket),
  );
  const preferred =
    diameter < MODEL_SPLITTER_LIMITS.connectorDiameterMm.min
      ? Math.max(limits.min, diameter * 1.25)
      : Math.max(baseDepth, diameter * 0.9, interfaceAreaScale * 0.25);
  const safeTarget = Math.min(
    limits.max,
    materialLimit,
    maximumDepth,
    preferred,
  );
  const quantized = Math.floor((safeTarget + 1e-6) / limits.step) * limits.step;
  return Math.min(limits.max, Math.max(limits.min, quantized));
}

function connectorDiameterCandidates(
  preferred: number,
  baseDiameter: number,
  microDiameter: number | null,
): number[] {
  const limits = MODEL_SPLITTER_LIMITS.connectorDiameterMm;
  const candidates = [
    preferred,
    preferred - limits.step,
    preferred * 0.75,
    preferred * 0.5,
    Math.min(baseDiameter, preferred),
    limits.min,
  ].map((value) =>
    Math.min(
      limits.max,
      Math.max(
        limits.min,
        Math.floor((value + 1e-6) / limits.step) * limits.step,
      ),
    ),
  );
  if (microDiameter !== null) candidates.push(microDiameter);
  return [...new Set(candidates)].sort((left, right) => right - left);
}

function connectorDepthCandidates(preferred: number): number[] {
  const limits = MODEL_SPLITTER_LIMITS.connectorDepthMm;
  const candidates = [preferred, preferred * 0.5, limits.min].map((value) =>
    Math.min(
      limits.max,
      Math.max(
        limits.min,
        Math.floor((value + 1e-6) / limits.step) * limits.step,
      ),
    ),
  );
  return [...new Set(candidates)].sort((left, right) => right - left);
}

type ConnectorFallback = {
  negativeComponent: ManifoldSolid;
  positiveComponent: ManifoldSolid;
  whole: ManifoldSolid;
  target: "negative" | "positive";
};

type ComponentConnectorPlan = {
  placements: ConnectorPlacement[];
  requested: number;
  fallbacks: ConnectorFallback[];
  skippedPairCount: number;
};

function shouldKeepComponentWhole(
  whole: ManifoldSolid,
  definition: AxisDefinition,
  clearance: number,
): boolean {
  const bounds = whole.boundingBox();
  const transverseDimensions = ([0, 1, 2] as const).filter(
    (dimension) => dimension !== definition.dimension,
  );
  const minorSpan = Math.min(
    ...transverseDimensions.map((dimension) =>
      Math.max(0, bounds.max[dimension] - bounds.min[dimension]),
    ),
  );
  const minimumDiameter = MODEL_SPLITTER_LIMITS.connectorDiameterMm.min;
  const minimumDepth = MODEL_SPLITTER_LIMITS.connectorDepthMm.min;
  const minimumWall = connectorSafetyWall(
    minimumDiameter / 2,
    minimumDepth,
  ).radial;
  const minimumSafeSpan = minimumDiameter + 2 * (clearance + minimumWall);
  return minorSpan < minimumSafeSpan * 1.1 || whole.volume() <= 8_000;
}

function findComponentConnectorCenters(
  kernel: ManifoldToplevel,
  negative: ManifoldSolid,
  positive: ManifoldSolid,
  definition: AxisDefinition,
  planeOffset: number,
  baseDiameter: number,
  connectorDepth: number,
  maximumDepth: number,
  gluePocket: number,
  clearance: number,
  style: ModelSplitterConnectorStyle,
  spacing: number,
  manualPosition: [number, number] | null,
  maxConnectors: number,
  preserveUnconnectableDetails: boolean,
): ComponentConnectorPlan {
  const negativeComponents = negative.decompose();
  const positiveComponents = positive.decompose();
  const retainedComponents = new Set<ManifoldSolid>();
  let completed = false;
  try {
    const matingPairs: Array<{
      negativeComponent: ManifoldSolid;
      positiveComponent: ManifoldSolid;
      negativeBounds: ReturnType<ManifoldSolid["boundingBox"]>;
      positiveBounds: ReturnType<ManifoldSolid["boundingBox"]>;
    }> = [];
    for (const negativeComponent of negativeComponents) {
      const negativeBounds = negativeComponent.boundingBox();
      if (negativeBounds.max[definition.dimension] < planeOffset - 0.1)
        continue;
      for (const positiveComponent of positiveComponents) {
        const positiveBounds = positiveComponent.boundingBox();
        if (positiveBounds.min[definition.dimension] > planeOffset + 0.1)
          continue;
        if (
          !hasMatingInterface(negativeComponent, positiveComponent, definition)
        )
          continue;
        matingPairs.push({
          negativeComponent,
          positiveComponent,
          negativeBounds,
          positiveBounds,
        });
      }
    }

    const negativePairCounts = new Map<ManifoldSolid, number>();
    const positivePairCounts = new Map<ManifoldSolid, number>();
    for (const pair of matingPairs) {
      negativePairCounts.set(
        pair.negativeComponent,
        (negativePairCounts.get(pair.negativeComponent) ?? 0) + 1,
      );
      positivePairCounts.set(
        pair.positiveComponent,
        (positivePairCounts.get(pair.positiveComponent) ?? 0) + 1,
      );
    }

    const groups: Array<{
      placements: ConnectorPlacement[];
      requested: number;
    }> = [];
    const fallbacks: ConnectorFallback[] = [];
    let skippedPairCount = 0;
    for (const pair of matingPairs) {
      const {
        negativeComponent,
        positiveComponent,
        negativeBounds,
        positiveBounds,
      } = pair;
      const preferredDiameter = adaptiveConnectorDiameter(
        negativeComponent,
        positiveComponent,
        definition,
        baseDiameter,
        clearance,
      );
      const negativeCutFace = cutFaceCandidateCenters(
        negativeComponent,
        definition,
        planeOffset,
      );
      const positiveCutFace = cutFaceCandidateCenters(
        positiveComponent,
        definition,
        planeOffset,
      );
      const interfaceAreaScale = Math.sqrt(
        Math.max(
          0,
          Math.min(negativeCutFace.totalArea, positiveCutFace.totalArea),
        ),
      );
      const diameterStep = MODEL_SPLITTER_LIMITS.connectorDiameterMm.step;
      const cutFaceCenters = [
        ...negativeCutFace.centers,
        ...positiveCutFace.centers,
      ];
      const transverseDimensions = ([0, 1, 2] as const).filter(
        (dimension) => dimension !== definition.dimension,
      );
      const localMinorSpan = Math.min(
        ...transverseDimensions.map((dimension) =>
          Math.max(
            0,
            Math.min(
              negativeBounds.max[dimension],
              positiveBounds.max[dimension],
            ) -
              Math.max(
                negativeBounds.min[dimension],
                positiveBounds.min[dimension],
              ),
          ),
        ),
      );
      const maximumMicroDiameter =
        localMinorSpan - 2 * (clearance + MICRO_CONNECTOR_WALL_MM);
      const microDiameter =
        manualPosition === null &&
        maximumMicroDiameter >= MICRO_CONNECTOR_DIAMETER_MM
          ? Math.min(
              MODEL_SPLITTER_LIMITS.connectorDiameterMm.min -
                MICRO_CONNECTOR_STEP_MM,
              Math.floor(
                (maximumMicroDiameter + 1e-6) / MICRO_CONNECTOR_STEP_MM,
              ) * MICRO_CONNECTOR_STEP_MM,
            )
          : null;
      let placement: ReturnType<typeof findConnectorCenters> = {
        centers: [],
        requested: 1,
      };
      let appliedDiameter = preferredDiameter;
      let appliedDepth = connectorDepth;
      connectorCandidate: for (const candidateDiameter of connectorDiameterCandidates(
        preferredDiameter,
        baseDiameter,
        microDiameter,
      )) {
        const preferredDepth = adaptiveConnectorDepth(
          negativeComponent,
          positiveComponent,
          definition,
          planeOffset,
          candidateDiameter,
          connectorDepth,
          maximumDepth,
          gluePocket,
          interfaceAreaScale,
        );
        for (const candidateDepth of connectorDepthCandidates(preferredDepth)) {
          const prefersSingleLargeConnector =
            manualPosition === null &&
            candidateDiameter > baseDiameter + diameterStep / 2 &&
            candidateDiameter >= localMinorSpan * 0.25;
          const candidateGluePocket = Math.min(
            gluePocket,
            candidateDepth * 0.25,
          );
          const candidatePlacement = findConnectorCenters(
            kernel,
            negativeComponent,
            positiveComponent,
            definition,
            planeOffset,
            candidateDiameter / 2,
            candidateDepth,
            clearance,
            candidateGluePocket,
            manualPosition === null
              ? Math.max(
                  spacing,
                  candidateDiameter * AUTOMATIC_CONNECTOR_SPACING_DIAMETERS,
                )
              : spacing,
            manualPosition,
            prefersSingleLargeConnector ? 1 : Math.max(1, maxConnectors),
            cutFaceCenters,
          );
          if (candidatePlacement.centers.length === 0) continue;
          placement = candidatePlacement;
          appliedDiameter = candidateDiameter;
          appliedDepth = candidateDepth;
          break connectorCandidate;
        }
      }
      if (placement.centers.length > 0) {
        groups.push({
          placements: placement.centers.map((center) => ({
            center,
            diameterMm: appliedDiameter,
            depthMm: appliedDepth,
          })),
          requested: placement.requested,
        });
        continue;
      }

      const uniquePair =
        negativePairCounts.get(negativeComponent) === 1 &&
        positivePairCounts.get(positiveComponent) === 1;
      const whole = negativeComponent.add(positiveComponent);
      if (
        preserveUnconnectableDetails &&
        uniquePair &&
        shouldKeepComponentWhole(whole, definition, clearance)
      ) {
        retainedComponents.add(negativeComponent);
        retainedComponents.add(positiveComponent);
        fallbacks.push({
          negativeComponent,
          positiveComponent,
          whole,
          target:
            negativeComponent.volume() >= positiveComponent.volume()
              ? "negative"
              : "positive",
        });
      } else {
        whole.delete();
        if (preserveUnconnectableDetails) {
          // Keep a clean, watertight glue face whenever no protected connector
          // can be placed. One unsafe interface must never abort the whole job.
          skippedPairCount += 1;
        }
      }
    }

    const requested =
      groups.reduce((sum, group) => sum + group.requested, 0) +
      skippedPairCount;
    const budget = Math.max(groups.length, maxConnectors);
    const placements = groups
      .map((group) => group.placements[0])
      .filter(
        (placement): placement is ConnectorPlacement => placement !== undefined,
      );
    for (let offset = 1; placements.length < budget; offset += 1) {
      let added = false;
      for (const group of groups) {
        const placement = group.placements[offset];
        if (!placement) continue;
        placements.push(placement);
        added = true;
        if (placements.length >= budget) break;
      }
      if (!added) break;
    }
    completed = true;
    return { placements, requested, fallbacks, skippedPairCount };
  } finally {
    negativeComponents.forEach((component) => {
      if (!completed || !retainedComponents.has(component)) component.delete();
    });
    positiveComponents.forEach((component) => {
      if (!completed || !retainedComponents.has(component)) component.delete();
    });
  }
}
function findPlaneConnectorCenters(
  kernel: ManifoldToplevel,
  negative: ManifoldSolid,
  positive: ManifoldSolid,
  definition: AxisDefinition,
  planeOffset: number,
  baseDiameter: number,
  connectorDepth: number,
  maximumDepth: number,
  gluePocket: number,
  clearance: number,
  style: ModelSplitterConnectorStyle,
  spacing: number,
  manualPosition: [number, number] | null,
  maxConnectors: number,
  preserveUnconnectableDetails: boolean,
): ComponentConnectorPlan {
  if (isAxisAlignedDefinition(definition)) {
    return findComponentConnectorCenters(
      kernel,
      negative,
      positive,
      definition,
      planeOffset,
      baseDiameter,
      connectorDepth,
      maximumDepth,
      gluePocket,
      clearance,
      style,
      spacing,
      manualPosition,
      maxConnectors,
      preserveUnconnectableDetails,
    );
  }
  const frame = planeFrame(definition.normal);
  const alignedNegative = negative.transform(frame.worldToPlane);
  const alignedPositive = positive.transform(frame.worldToPlane);
  try {
    const local = findComponentConnectorCenters(
      kernel,
      alignedNegative,
      alignedPositive,
      { axis: "z", normal: [0, 0, 1], dimension: 2 },
      planeOffset,
      baseDiameter,
      connectorDepth,
      maximumDepth,
      gluePocket,
      clearance,
      style,
      spacing,
      manualPosition,
      maxConnectors,
      false,
    );
    for (const fallback of local.fallbacks) {
      fallback.negativeComponent.delete();
      fallback.positiveComponent.delete();
      fallback.whole.delete();
    }
    return {
      ...local,
      placements: local.placements.map((placement) => ({
        ...placement,
        center: transformPoint(placement.center, frame.planeToWorld),
      })),
      // Component relocation is intentionally disabled for a free plane: a
      // failed pair remains a watertight glue face rather than moving geometry
      // through a transformed interface.
      fallbacks: [],
    };
  } finally {
    alignedNegative.delete();
    alignedPositive.delete();
  }
}
function engraveAssemblyCode(
  kernel: ManifoldToplevel,
  solid: ManifoldSolid,
  anchor: LabelAnchor,
  code: number,
  scale: number,
): { solid: ManifoldSolid; applied: boolean } {
  const definition = AXES.find((candidate) => candidate.axis === anchor.axis);
  if (!definition) return { solid, applied: false };
  const transverse = ([0, 1, 2] as const).filter(
    (dimension) => dimension !== definition.dimension,
  );
  let current = solid;
  let applied = false;
  const depth = Math.max(0.45, Math.min(0.8, scale * 0.08));
  const radius = Math.max(0.24, Math.min(0.42, scale * 0.035));
  const spacing = radius * 2.8;
  for (let bit = 0; bit < 6; bit += 1) {
    if ((code & (1 << bit)) === 0) continue;
    let center: [number, number, number] = [...anchor.center];
    center = withAxis(
      center,
      definition.dimension,
      axisValue(anchor.center, definition.dimension) +
        (anchor.inwardDirection * depth) / 2,
    );
    center = withAxis(
      center,
      transverse[0],
      axisValue(anchor.center, transverse[0]) + (bit - 2.5) * spacing,
    );
    center = withAxis(
      center,
      transverse[1],
      axisValue(anchor.center, transverse[1]) + scale * 0.8,
    );
    const cutter = makeConnectorSolid(
      kernel,
      anchor.axis,
      depth + 0.08,
      radius * 2,
      center,
      "pin",
    );
    const next = current.subtract(cutter);
    cutter.delete();
    if (next.isEmpty() || next.volume() <= 1e-6) {
      next.delete();
      continue;
    }
    const changed = next.volume() < current.volume() - 1e-5;
    if (current !== solid) current.delete();
    current = next;
    applied ||= changed;
  }
  return { solid: current, applied };
}

function interfacePairs(
  parts: Map<string, WorkingPart>,
  counts: GridIndex,
  definition: AxisDefinition,
): Array<{
  negative: WorkingPart;
  positive: WorkingPart;
  boundary: number;
  interfaceId: string;
}> {
  const pairs: Array<{
    negative: WorkingPart;
    positive: WorkingPart;
    boundary: number;
    interfaceId: string;
  }> = [];
  for (let x = 0; x < counts[0]; x += 1) {
    for (let y = 0; y < counts[1]; y += 1) {
      for (let z = 0; z < counts[2]; z += 1) {
        const index: GridIndex = [x, y, z];
        if (index[definition.dimension] >= counts[definition.dimension] - 1)
          continue;
        const next: GridIndex = [...index];
        next[definition.dimension] += 1;
        const negative = parts.get(partKey(index));
        const positive = parts.get(partKey(next));
        if (!negative || !positive) continue;
        const boundary = index[definition.dimension] + 1;
        pairs.push({
          negative,
          positive,
          boundary,
          interfaceId: `${definition.axis}-${boundary}-${partKey(index)}`,
        });
      }
    }
  }
  return pairs;
}

type MeshPlaneCutStats = {
  length: number;
  seamExposureRatio: number;
  centroid: Vector3Tuple | null;
  partitionBalanceRatio: number;
};

function meshFreePlaneCutStats(
  mesh: TriangleMeshData,
  normalInput: Readonly<Vector3Tuple>,
  planeOffsetMm: number,
): MeshPlaneCutStats {
  const normal = normalizeVector(normalInput);
  const triangleCount = Math.floor(mesh.indices.length / 3);
  const stride = Math.max(1, Math.ceil(triangleCount / 25_000));
  let totalLength = 0;
  let exposedLength = 0;
  let positiveArea = 0;
  let negativeArea = 0;
  const weightedCenter: Vector3Tuple = [0, 0, 0];
  const point = (vertexIndex: number): Vector3Tuple => [
    mesh.positions[vertexIndex * 3] ?? 0,
    mesh.positions[vertexIndex * 3 + 1] ?? 0,
    mesh.positions[vertexIndex * 3 + 2] ?? 0,
  ];

  for (let triangle = 0; triangle < triangleCount; triangle += stride) {
    const vertices = [0, 1, 2].map((offset) =>
      point(mesh.indices[triangle * 3 + offset] ?? 0),
    ) as [Vector3Tuple, Vector3Tuple, Vector3Tuple];
    const signed = vertices.map(
      (vertex) => dotVector(vertex, normal) - planeOffsetMm,
    );
    const edgeA: Vector3Tuple = [
      vertices[1][0] - vertices[0][0],
      vertices[1][1] - vertices[0][1],
      vertices[1][2] - vertices[0][2],
    ];
    const edgeB: Vector3Tuple = [
      vertices[2][0] - vertices[0][0],
      vertices[2][1] - vertices[0][1],
      vertices[2][2] - vertices[0][2],
    ];
    const triangleNormal = crossVector(edgeA, edgeB);
    const normalLength = Math.hypot(...triangleNormal);
    const triangleArea = normalLength / 2;
    const centroidSigned = (signed[0] + signed[1] + signed[2]) / 3;
    if (centroidSigned >= 0) positiveArea += triangleArea;
    else negativeArea += triangleArea;

    const intersections: Vector3Tuple[] = [];
    for (const [firstIndex, secondIndex] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ] as const) {
      const firstSigned = signed[firstIndex];
      const secondSigned = signed[secondIndex];
      const crosses =
        (firstSigned <= 0 && secondSigned > 0) ||
        (secondSigned <= 0 && firstSigned > 0);
      if (!crosses) continue;
      const fraction = -firstSigned / (secondSigned - firstSigned);
      const first = vertices[firstIndex];
      const second = vertices[secondIndex];
      intersections.push([
        first[0] + (second[0] - first[0]) * fraction,
        first[1] + (second[1] - first[1]) * fraction,
        first[2] + (second[2] - first[2]) * fraction,
      ]);
    }
    let longestSquared = 0;
    let longestPair: [Vector3Tuple, Vector3Tuple] | null = null;
    for (let first = 0; first < intersections.length; first += 1) {
      for (let second = first + 1; second < intersections.length; second += 1) {
        const distance = squaredDistance(
          intersections[first],
          intersections[second],
        );
        if (distance > longestSquared) {
          longestSquared = distance;
          longestPair = [intersections[first], intersections[second]];
        }
      }
    }
    const segmentLength = Math.sqrt(longestSquared);
    if (segmentLength <= 1e-9 || !longestPair) continue;
    const frontExposure =
      normalLength > 1e-9
        ? Math.max(0, triangleNormal[0] / normalLength)
        : 1;
    const topExposure =
      normalLength > 1e-9
        ? Math.max(0, triangleNormal[1] / normalLength)
        : 1;
    const exposure = Math.min(1, frontExposure * 0.78 + topExposure * 0.22);
    const midpoint: Vector3Tuple = [
      (longestPair[0][0] + longestPair[1][0]) / 2,
      (longestPair[0][1] + longestPair[1][1]) / 2,
      (longestPair[0][2] + longestPair[1][2]) / 2,
    ];
    totalLength += segmentLength;
    exposedLength += segmentLength * exposure;
    weightedCenter[0] += midpoint[0] * segmentLength;
    weightedCenter[1] += midpoint[1] * segmentLength;
    weightedCenter[2] += midpoint[2] * segmentLength;
  }
  const partitionArea = positiveArea + negativeArea;
  return {
    length: totalLength * stride,
    seamExposureRatio:
      totalLength > 1e-9 ? Math.min(1, exposedLength / totalLength) : 1,
    centroid:
      totalLength > 1e-9
        ? [
            weightedCenter[0] / totalLength,
            weightedCenter[1] / totalLength,
            weightedCenter[2] / totalLength,
          ]
        : null,
    partitionBalanceRatio:
      partitionArea > 1e-9
        ? Math.min(positiveArea, negativeArea) / partitionArea
        : 0,
  };
}

function meshPlaneCutStats(
  mesh: TriangleMeshData,
  dimension: 0 | 1 | 2,
  positionMm: number,
): MeshPlaneCutStats {
  const normal: Vector3Tuple = [0, 0, 0];
  normal[dimension] = 1;
  return meshFreePlaneCutStats(mesh, normal, positionMm);
}
type SmartCutProfile = {
  area: number;
  perimeter: number;
  contourCount: number;
  smallestContourFraction: number;
  largestContourFraction: number;
};

function polygonPerimeter(
  polygon: ReadonlyArray<Readonly<[number, number]>>,
): number {
  let perimeter = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    perimeter += Math.hypot(next[0] - current[0], next[1] - current[1]);
  }
  return perimeter;
}

function solidPlaneCutProfile(
  alignedSolid: ManifoldSolid,
  positionMm: number,
): SmartCutProfile {
  const section = alignedSolid.slice(positionMm);
  try {
    const polygons = section.toPolygons();
    const outerAreas = polygons
      .map((polygon) => polygonSignedArea(polygon))
      .filter((area) => area > 1e-7);
    const area = Math.abs(section.area());
    const smallestContour = outerAreas.length > 0 ? Math.min(...outerAreas) : 0;
    const largestContour = outerAreas.length > 0 ? Math.max(...outerAreas) : 0;
    return {
      area,
      perimeter: polygons.reduce(
        (sum, polygon) => sum + polygonPerimeter(polygon),
        0,
      ),
      contourCount: outerAreas.length,
      smallestContourFraction: area > 1e-7 ? smallestContour / area : 0,
      largestContourFraction: area > 1e-7 ? largestContour / area : 0,
    };
  } finally {
    section.delete();
  }
}

function sampledMeshAxisValues(
  mesh: TriangleMeshData,
  dimension: number,
): number[] {
  const vertexCount = mesh.positions.length / 3;
  const stride = Math.max(1, Math.ceil(vertexCount / 50_000));
  const values: number[] = [];
  for (let vertex = 0; vertex < vertexCount; vertex += stride) {
    values.push(mesh.positions[vertex * 3 + dimension] ?? 0);
  }
  return values.sort((left, right) => left - right);
}

function sampledAxisFraction(
  values: readonly number[],
  positionMm: number,
): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? 0) <= positionMm) low = middle + 1;
    else high = middle;
  }
  return values.length === 0 ? 0.5 : low / values.length;
}

function sampledAxisQuantile(
  values: readonly number[],
  fraction: number,
): number {
  if (values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.round((values.length - 1) * fraction)),
  );
  return values[index] ?? 0;
}

type SmartSurfaceSample = {
  coordinate: number;
  area: number;
  riskByOrientation: [number, number, number, number, number, number];
};

type SmartPrintabilityProfile = {
  coordinates: number[];
  prefixArea: number[];
  prefixRiskByOrientation: number[][];
  totalArea: number;
  totalRiskByOrientation: number[];
};

function supportSeverity(normalDotUp: number): number {
  const downward = -normalDotUp;
  const threshold = Math.SQRT1_2;
  return downward <= threshold
    ? 0
    : Math.min(1, (downward - threshold) / (1 - threshold));
}

function smartPrintabilityProfile(
  mesh: TriangleMeshData,
  dimension: 0 | 1 | 2,
): SmartPrintabilityProfile {
  const triangleCount = Math.floor(mesh.indices.length / 3);
  const stride = Math.max(1, Math.ceil(triangleCount / 30_000));
  const samples: SmartSurfaceSample[] = [];
  const point = (vertexIndex: number): [number, number, number] => [
    mesh.positions[vertexIndex * 3] ?? 0,
    mesh.positions[vertexIndex * 3 + 1] ?? 0,
    mesh.positions[vertexIndex * 3 + 2] ?? 0,
  ];
  for (let triangle = 0; triangle < triangleCount; triangle += stride) {
    const a = point(mesh.indices[triangle * 3] ?? 0);
    const b = point(mesh.indices[triangle * 3 + 1] ?? 0);
    const c = point(mesh.indices[triangle * 3 + 2] ?? 0);
    const edgeA = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
    const edgeB = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
    const cross = [
      edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
      edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
      edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0],
    ] as const;
    const doubleArea = Math.hypot(...cross);
    if (doubleArea <= 1e-12) continue;
    const area = (doubleArea / 2) * stride;
    const normal = cross.map((value) => value / doubleArea) as [
      number,
      number,
      number,
    ];
    const risks = [0, 1, 2].flatMap((axis) => [
      area * supportSeverity(-normal[axis]),
      area * supportSeverity(normal[axis]),
    ]) as [number, number, number, number, number, number];
    samples.push({
      coordinate: (a[dimension] + b[dimension] + c[dimension]) / 3,
      area,
      riskByOrientation: risks,
    });
  }
  samples.sort((left, right) => left.coordinate - right.coordinate);
  const coordinates: number[] = [];
  const prefixArea: number[] = [0];
  const prefixRiskByOrientation = Array.from({ length: 6 }, () => [0]);
  for (const sample of samples) {
    coordinates.push(sample.coordinate);
    prefixArea.push(prefixArea[prefixArea.length - 1]! + sample.area);
    for (let orientation = 0; orientation < 6; orientation += 1) {
      const prefix = prefixRiskByOrientation[orientation]!;
      prefix.push(
        prefix[prefix.length - 1]! + sample.riskByOrientation[orientation]!,
      );
    }
  }
  return {
    coordinates,
    prefixArea,
    prefixRiskByOrientation,
    totalArea: prefixArea[prefixArea.length - 1] ?? 0,
    totalRiskByOrientation: prefixRiskByOrientation.map(
      (prefix) => prefix[prefix.length - 1] ?? 0,
    ),
  };
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] ?? 0) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function smartSupportRisk(
  profile: SmartPrintabilityProfile,
  dimension: 0 | 1 | 2,
  positionMm: number,
): number {
  const splitIndex = upperBound(profile.coordinates, positionMm);
  const negativeArea = profile.prefixArea[splitIndex] ?? 0;
  const positiveArea = Math.max(0, profile.totalArea - negativeArea);
  if (negativeArea <= 1e-9 || positiveArea <= 1e-9) return 1;
  const orientationRisk = (orientation: number, positive: boolean): number => {
    const prefix =
      profile.prefixRiskByOrientation[orientation]?.[splitIndex] ?? 0;
    const risk = positive
      ? (profile.totalRiskByOrientation[orientation] ?? 0) - prefix
      : prefix;
    return risk / (positive ? positiveArea : negativeArea);
  };
  const canonicalUp = 3;
  const negativeRisk = Math.min(
    orientationRisk(canonicalUp, false),
    orientationRisk(dimension * 2, false),
  );
  const positiveRisk = Math.min(
    orientationRisk(canonicalUp, true),
    orientationRisk(dimension * 2 + 1, true),
  );
  return Math.min(
    1,
    Math.max(negativeRisk, positiveRisk) * 0.7 +
      ((negativeRisk + positiveRisk) / 2) * 0.3,
  );
}

function smartGeometryShelter(
  profile: SmartCutProfile,
  before: SmartCutProfile,
  after: SmartCutProfile,
): number {
  const shelteringNeighbor = Math.max(before.area, after.area);
  if (shelteringNeighbor <= 1e-9) return 0;
  return Math.min(1, Math.max(0, 1 - profile.area / shelteringNeighbor));
}

function normalizedSmartCutQuality(
  seamExposureRatio: number,
  geometryShelterRatio: number,
  supportRiskRatio: number,
): SmartCutQuality {
  const normalized = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
  return {
    seamExposureRatio: normalized(seamExposureRatio),
    geometryShelterRatio: normalized(geometryShelterRatio),
    supportRiskRatio: normalized(supportRiskRatio),
  };
}
function separatedContourPenalty(profile: SmartCutProfile): number {
  if (profile.contourCount <= 1) return 0;
  // Two or three similarly sized contours are usually intentional anatomical
  // pairs (feet, legs, sleeves). Only unbalanced satellite contours should be
  // treated as sliver risks.
  if (
    profile.contourCount <= 3 &&
    profile.smallestContourFraction >= 0.18 &&
    profile.largestContourFraction <= 0.7
  ) {
    return 0.03 * (profile.contourCount - 1);
  }
  const tinyContourPenalty =
    profile.smallestContourFraction < 0.08
      ? (0.08 - profile.smallestContourFraction) / 0.08
      : 0;
  return Math.min(
    1,
    (profile.contourCount - 1) * 0.16 + tinyContourPenalty * 0.84,
  );
}

function fragileSatelliteContourPenalty(profile: SmartCutProfile): number {
  if (profile.contourCount <= 1 || profile.smallestContourFraction >= 0.14) {
    return 0;
  }
  return (0.14 - profile.smallestContourFraction) / 0.14;
}

function balancedAnatomicalContourBonus(profile: SmartCutProfile): number {
  if (
    profile.contourCount < 2 ||
    profile.contourCount > 3 ||
    profile.smallestContourFraction < 0.18 ||
    profile.largestContourFraction > 0.7
  ) {
    return 0;
  }
  return profile.contourCount === 2 ? 0.16 : 0.09;
}

function cutFlatnessPenalty(profile: SmartCutProfile): number {
  const isoperimetricRatio =
    profile.area > 1e-6
      ? profile.perimeter ** 2 / (4 * Math.PI * profile.area)
      : 10;
  return Math.min(1.5, Math.max(0, isoperimetricRatio - 1.35) / 4);
}

function sampledPartitionDimensions(
  points: ReadonlyArray<Readonly<[number, number, number]>>,
  dimension: number,
  positionMm: number,
): [[number, number, number], [number, number, number]] | null {
  const minima = [
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ],
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ],
  ];
  const maxima = [
    [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ],
    [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ],
  ];
  const occupied = [false, false];
  for (const point of points) {
    for (const side of [0, 1] as const) {
      if (
        (side === 0 && point[dimension] > positionMm) ||
        (side === 1 && point[dimension] < positionMm)
      )
        continue;
      occupied[side] = true;
      for (let axis = 0; axis < 3; axis += 1) {
        minima[side][axis] = Math.min(minima[side][axis], point[axis]);
        maxima[side][axis] = Math.max(maxima[side][axis], point[axis]);
      }
    }
  }
  if (!occupied[0] || !occupied[1]) return null;
  maxima[0][dimension] = positionMm;
  minima[1][dimension] = positionMm;
  return [0, 1].map(
    (side) =>
      [0, 1, 2].map((axis) =>
        Math.max(0, maxima[side][axis] - minima[side][axis]),
      ) as [number, number, number],
  ) as [[number, number, number], [number, number, number]];
}

function partFlatnessPenalty(dimensions: readonly number[]): number {
  const sorted = [...dimensions].sort((left, right) => left - right);
  const aspect = (sorted[0] ?? 0) / Math.max(1e-6, sorted[2] ?? 0);
  return Math.max(0, (0.12 - aspect) / 0.12);
}

function refineSmartSinglePlaneAxis(
  mesh: TriangleMeshData,
  source: ManifoldSolid,
  bounds: ReturnType<typeof calculateMeshBounds>,
  params: ModelSplitterParams,
  plan: ReturnType<typeof createSplitPlan>,
): boolean {
  if (plan.partCount !== 2 || plan.planes.length !== 1) return false;
  const vertexCount = mesh.positions.length / 3;
  const stride = Math.max(1, Math.ceil(vertexCount / 30_000));
  const points: Array<[number, number, number]> = [];
  for (let vertex = 0; vertex < vertexCount; vertex += stride) {
    points.push([
      mesh.positions[vertex * 3] ?? 0,
      mesh.positions[vertex * 3 + 1] ?? 0,
      mesh.positions[vertex * 3 + 2] ?? 0,
    ]);
  }
  const connectorAllowance = params.connectors
    ? params.connectorDepthMm + params.connectorClearanceMm + 1
    : 1;
  const usableBed = plan.buildVolumeMm.map((span) =>
    Math.max(1, span - connectorAllowance),
  ) as [number, number, number];
  let best: {
    definition: AxisDefinition;
    positionMm: number;
    score: number;
    smartQuality: SmartCutQuality;
  } | null = null;
  let evaluated = 0;
  for (const definition of AXES) {
    const span = bounds.size[definition.dimension];
    const minimumSpan = params.connectors
      ? Math.min(
          span * 0.2,
          Math.max(
            1,
            params.connectorDiameterMm + params.connectorClearanceMm + 1,
          ),
        )
      : Math.min(span * 0.1, 1);
    const low = bounds.min[definition.dimension] + minimumSpan;
    const high = bounds.max[definition.dimension] - minimumSpan;
    if (high <= low) continue;
    const rotation: [number, number, number] =
      definition.axis === "x"
        ? [0, -90, 0]
        : definition.axis === "y"
          ? [90, 0, 0]
          : [0, 0, 0];
    const alignedSource =
      definition.axis === "z" ? source : source.rotate(rotation);
    const axisValues = points
      .map((point) => point[definition.dimension])
      .sort((left, right) => left - right);
    const transverse = ([0, 1, 2] as const).filter(
      (axis) => axis !== definition.dimension,
    );
    const projectedArea = Math.max(
      1,
      bounds.size[transverse[0]] * bounds.size[transverse[1]],
    );
    try {
      const printability = smartPrintabilityProfile(mesh, definition.dimension);
      const candidates = evenlySpaced(low, high, 25).map((positionMm) => ({
        positionMm,
        profile: solidPlaneCutProfile(alignedSource, positionMm),
      }));
      for (
        let candidateIndex = 0;
        candidateIndex < candidates.length;
        candidateIndex += 1
      ) {
        const candidate = candidates[candidateIndex]!;
        const { positionMm, profile } = candidate;
        const partitionDimensions = sampledPartitionDimensions(
          points,
          definition.dimension,
          positionMm,
        );
        if (
          !partitionDimensions ||
          partitionDimensions.some(
            (dimensions) => !dimensionsFitBuildVolume(dimensions, usableBed),
          ) ||
          profile.area <= 1e-6
        )
          continue;
        evaluated += 1;
        const before = candidates[Math.max(0, candidateIndex - 1)]!.profile;
        const after =
          candidates[Math.min(candidates.length - 1, candidateIndex + 1)]!
            .profile;
        const cutStats = meshPlaneCutStats(
          mesh,
          definition.dimension,
          positionMm,
        );
        const smartQuality = normalizedSmartCutQuality(
          cutStats.seamExposureRatio,
          smartGeometryShelter(profile, before, after),
          smartSupportRisk(printability, definition.dimension, positionMm),
        );
        const occupiedFraction = sampledAxisFraction(axisValues, positionMm);
        const score =
          (profile.area / projectedArea) * 0.5 +
          cutFlatnessPenalty(profile) * 0.35 +
          separatedContourPenalty(profile) * 0.4 -
          balancedAnatomicalContourBonus(profile) +
          Math.max(...partitionDimensions.map(partFlatnessPenalty)) * 0.5 +
          Math.abs(occupiedFraction - 0.5) * 0.05 +
          (Math.abs(
            positionMm - (bounds.min[definition.dimension] + span / 2),
          ) /
            Math.max(1, span)) *
            0.02 +
          smartQuality.seamExposureRatio * 0.12 +
          smartQuality.supportRiskRatio * 0.2 -
          smartQuality.geometryShelterRatio * 0.1;
        if (!best || score < best.score)
          best = { definition, positionMm, score, smartQuality };
      }
    } finally {
      if (alignedSource !== source) alignedSource.delete();
    }
  }
  if (!best) return false;
  plan.gridCounts = [1, 1, 1];
  plan.gridCounts[best.definition.dimension] = 2;
  plan.planes = [
    {
      id: `${best.definition.axis}-1`,
      axis: best.definition.axis,
      index: 1,
      positionMm: best.positionMm,
      smartQuality: best.smartQuality,
    },
  ];
  plan.centerMm = bounds.min.map((minimum, axis) =>
    axis === best.definition.dimension
      ? best.positionMm
      : minimum + bounds.size[axis] / 2,
  ) as [number, number, number];
  plan.evaluatedPlanes += evaluated;
  return true;
}

function refineSmartSplitPlanes(
  mesh: TriangleMeshData,
  source: ManifoldSolid,
  bounds: ReturnType<typeof calculateMeshBounds>,
  params: ModelSplitterParams,
  plan: ReturnType<typeof createSplitPlan>,
): void {
  if (plan.strategy !== "smart" || plan.planes.length === 0) return;
  if (refineSmartSinglePlaneAxis(mesh, source, bounds, params, plan)) return;
  let evaluated = 0;
  for (const definition of AXES) {
    const count = plan.gridCounts[definition.dimension];
    if (count <= 1) continue;
    const axisPlanes = plan.planes
      .filter((plane) => plane.axis === definition.axis)
      .sort((left, right) => left.index - right.index);
    const axisSamples = sampledMeshAxisValues(mesh, definition.dimension);
    const usableSpan = plan.usableBuildVolumeMm[definition.dimension];
    const rotation: [number, number, number] =
      definition.axis === "x"
        ? [0, -90, 0]
        : definition.axis === "y"
          ? [90, 0, 0]
          : [0, 0, 0];
    const alignedSource =
      definition.axis === "z" ? source : source.rotate(rotation);
    const profileCache = new Map<number, SmartCutProfile>();
    const profileAt = (positionMm: number): SmartCutProfile => {
      const key = Math.round(positionMm * 1_000) / 1_000;
      const cached = profileCache.get(key);
      if (cached) return cached;
      const profile = solidPlaneCutProfile(alignedSource, key);
      profileCache.set(key, profile);
      return profile;
    };
    const printability = smartPrintabilityProfile(mesh, definition.dimension);
    const minimumSpan = Math.min(
      (bounds.size[definition.dimension] / count) * 0.25,
      Math.max(1, params.connectorDiameterMm + params.connectorClearanceMm + 1),
    );
    let previous = bounds.min[definition.dimension];
    try {
      for (const plane of axisPlanes) {
        const remainingSegments = count - plane.index;
        const low = Math.max(
          previous + minimumSpan,
          bounds.max[definition.dimension] - remainingSegments * usableSpan,
        );
        const high = Math.min(
          previous + usableSpan,
          bounds.max[definition.dimension] - remainingSegments * minimumSpan,
        );
        if (high <= low + 1e-6) {
          previous = plane.positionMm;
          continue;
        }
        const ideal = Math.min(high, Math.max(low, plane.positionMm));
        const targetFraction = plane.index / count;
        const quantile = sampledAxisQuantile(axisSamples, targetFraction);
        const candidates = [
          ...new Set(
            [...evenlySpaced(low, high, 49), ideal, quantile].map(
              (value) => Math.round(value * 1_000) / 1_000,
            ),
          ),
        ].filter((candidate) => candidate >= low && candidate <= high);
        const nominalSegmentSpan = bounds.size[definition.dimension] / count;
        const neighborOffset = Math.max(
          0.75,
          Math.min(5, nominalSegmentSpan * 0.035),
        );
        const evaluatedCandidates = candidates.map((candidate) => {
          const profile = profileAt(candidate);
          const before = profileAt(
            Math.max(
              bounds.min[definition.dimension] + 1e-3,
              candidate - neighborOffset,
            ),
          );
          const after = profileAt(
            Math.min(
              bounds.max[definition.dimension] - 1e-3,
              candidate + neighborOffset,
            ),
          );
          const neighborArea = Math.max(1e-6, (before.area + after.area) / 2);
          const transitionScale = Math.max(
            1e-6,
            profile.area,
            before.area,
            after.area,
          );
          const tinyIslandPenalty = fragileSatelliteContourPenalty(profile);
          const separatedLimbPenalty = separatedContourPenalty(profile);
          const flatCutPenalty = cutFlatnessPenalty(profile);
          const cutStats = meshPlaneCutStats(
            mesh,
            definition.dimension,
            candidate,
          );
          const smartQuality = normalizedSmartCutQuality(
            cutStats.seamExposureRatio,
            smartGeometryShelter(profile, before, after),
            smartSupportRisk(printability, definition.dimension, candidate),
          );
          return {
            positionMm: candidate,
            cutLength: cutStats.length,
            area: profile.area,
            perimeter: profile.perimeter,
            occupiedFraction: sampledAxisFraction(axisSamples, candidate),
            localNeckRatio: profile.area / neighborArea,
            transitionAsymmetry:
              Math.abs(before.area - after.area) / transitionScale,
            tinyIslandPenalty,
            separatedLimbPenalty,
            anatomicalContourBonus: balancedAnatomicalContourBonus(profile),
            flatCutPenalty,
            smartQuality,
          };
        });
        const cutScale = Math.max(
          1e-6,
          ...evaluatedCandidates.map((candidate) => candidate.cutLength),
        );
        const areaScale = Math.max(
          1e-6,
          ...evaluatedCandidates.map((candidate) => candidate.area),
        );
        const perimeterScale = Math.max(
          1e-6,
          ...evaluatedCandidates.map((candidate) => candidate.perimeter),
        );
        let bestPosition = ideal;
        let bestScore = Number.POSITIVE_INFINITY;
        let bestDistance = Number.POSITIVE_INFINITY;
        let bestQuality: SmartCutQuality | undefined;
        for (const candidate of evaluatedCandidates) {
          evaluated += 1;
          const distance = Math.abs(candidate.positionMm - ideal);
          const cutScore = candidate.cutLength / cutScale;
          const areaScore = candidate.area / areaScale;
          const perimeterScore = candidate.perimeter / perimeterScale;
          const balanceScore = Math.abs(
            candidate.occupiedFraction - targetFraction,
          );
          const distanceScore = distance / Math.max(1, nominalSegmentSpan);
          const neckScore = Math.min(1.5, candidate.localNeckRatio);
          const score =
            areaScore * 0.28 +
            cutScore * 0.12 +
            perimeterScore * 0.08 +
            neckScore * 0.08 +
            candidate.tinyIslandPenalty * 0.42 +
            candidate.separatedLimbPenalty * 0.4 -
            candidate.anatomicalContourBonus +
            candidate.flatCutPenalty * 0.32 +
            candidate.transitionAsymmetry * 0.04 +
            balanceScore * 0.03 +
            distanceScore * 0.01 +
            candidate.smartQuality.seamExposureRatio * 0.1 +
            candidate.smartQuality.supportRiskRatio * 0.18 -
            candidate.smartQuality.geometryShelterRatio * 0.12;
          if (
            score < bestScore - 1e-6 ||
            (Math.abs(score - bestScore) <= 1e-6 && distance < bestDistance)
          ) {
            bestPosition = candidate.positionMm;
            bestScore = score;
            bestDistance = distance;
            bestQuality = candidate.smartQuality;
          }
        }
        plane.positionMm = bestPosition;
        plane.smartQuality = bestQuality;
        previous = bestPosition;
      }
    } finally {
      if (alignedSource !== source) alignedSource.delete();
    }
  }
  for (const definition of AXES) {
    const axisPlanes = plan.planes
      .filter((plane) => plane.axis === definition.axis)
      .sort((left, right) => left.positionMm - right.positionMm);
    plan.centerMm[definition.dimension] =
      axisPlanes.length > 0
        ? axisPlanes[Math.floor((axisPlanes.length - 1) / 2)].positionMm
        : (bounds.min[definition.dimension] +
            bounds.max[definition.dimension]) /
          2;
  }
  plan.evaluatedPlanes += evaluated;
}

function addSmartBoundaryJointPlanes(
  mesh: TriangleMeshData,
  source: ManifoldSolid,
  bounds: ReturnType<typeof calculateMeshBounds>,
  params: ModelSplitterParams,
  plan: ReturnType<typeof createSplitPlan>,
): void {
  // Smart mode may introduce a small number of high-confidence anatomical
  // boundaries even when the complete model already fits on one plate. This is
  // what separates a base, head, or exposed limb instead of preserving one
  // support-heavy monolith.
  if (plan.strategy !== "smart") return;
  let additions = 0;
  const maximumAdditions = 5;
  for (const definition of AXES) {
    if (additions >= maximumAdditions) break;
    const span = bounds.size[definition.dimension];
    const minimumSpan = Math.max(
      1,
      params.connectors
        ? params.connectorDiameterMm + params.connectorClearanceMm + 1
        : span * 0.015,
    );
    if (span <= minimumSpan * 4) continue;
    const axisSamples = sampledMeshAxisValues(mesh, definition.dimension);
    const rotation: [number, number, number] =
      definition.axis === "x"
        ? [0, -90, 0]
        : definition.axis === "y"
          ? [90, 0, 0]
          : [0, 0, 0];
    const alignedSource =
      definition.axis === "z" ? source : source.rotate(rotation);
    try {
      const existing = plan.planes
        .filter((plane) => plane.axis === definition.axis)
        .map((plane) => plane.positionMm)
        .sort((left, right) => left - right);
      // For one- and two-part plans, refine the existing bed cut but do not add
      // a second cut on the same axis. This prevents butt plates and tiny side
      // contours from being over-segmented. Larger plans may still gain extra
      // joint boundaries inside long regions.
      if (plan.partCount <= 2 && existing.length > 0) continue;
      const boundaries = [
        bounds.min[definition.dimension],
        ...existing,
        bounds.max[definition.dimension],
      ];
      const neighborOffset = Math.max(1.5, Math.min(10, span * 0.03));
      const profileCache = new Map<number, SmartCutProfile>();
      const profileAt = (positionMm: number): SmartCutProfile => {
        const key = Math.round(positionMm * 1_000) / 1_000;
        const cached = profileCache.get(key);
        if (cached) return cached;
        const profile = solidPlaneCutProfile(alignedSource, key);
        profileCache.set(key, profile);
        return profile;
      };
      const sampled = evenlySpaced(
        bounds.min[definition.dimension] + minimumSpan,
        bounds.max[definition.dimension] - minimumSpan,
        65,
      )
        .map((positionMm) => ({ positionMm, profile: profileAt(positionMm) }))
        .filter(({ profile }) => profile.area > 1e-6);
      const maximumArea = Math.max(
        1e-6,
        ...sampled.map(({ profile }) => profile.area),
      );
      const sampledPoints: Array<[number, number, number]> = [];
      const vertexCount = mesh.positions.length / 3;
      const pointStride = Math.max(1, Math.ceil(vertexCount / 30_000));
      for (let vertex = 0; vertex < vertexCount; vertex += pointStride) {
        sampledPoints.push([
          mesh.positions[vertex * 3] ?? 0,
          mesh.positions[vertex * 3 + 1] ?? 0,
          mesh.positions[vertex * 3 + 2] ?? 0,
        ]);
      }
      const printability = smartPrintabilityProfile(mesh, definition.dimension);
      const candidates = sampled.flatMap(({ positionMm, profile }) => {
        const occupiedFraction = sampledAxisFraction(axisSamples, positionMm);
        const detachedFraction = Math.min(
          occupiedFraction,
          1 - occupiedFraction,
        );
        if (detachedFraction < 0.025 || detachedFraction > 0.45) return [];
        const nextBoundaryIndex = boundaries.findIndex(
          (boundary) => boundary > positionMm,
        );
        if (nextBoundaryIndex <= 0) return [];
        const segmentLow = boundaries[nextBoundaryIndex - 1]!;
        const segmentHigh = boundaries[nextBoundaryIndex]!;
        if (
          positionMm - segmentLow < minimumSpan ||
          segmentHigh - positionMm < minimumSpan
        )
          return [];
        const before = profileAt(
          Math.max(segmentLow + 1e-3, positionMm - neighborOffset),
        );
        const after = profileAt(
          Math.min(segmentHigh - 1e-3, positionMm + neighborOffset),
        );
        const averageNeighborArea = Math.max(
          1e-6,
          (before.area + after.area) / 2,
        );
        const maximumNeighborArea = Math.max(1e-6, before.area, after.area);
        const neckRatio = profile.area / averageNeighborArea;
        const edgeTransitionRatio = profile.area / maximumNeighborArea;
        const areaRatio = profile.area / maximumArea;
        const contourPenalty = separatedContourPenalty(profile);
        const anatomicalBonus = balancedAnatomicalContourBonus(profile);
        const cutStats = meshPlaneCutStats(
          mesh,
          definition.dimension,
          positionMm,
        );
        const smartQuality = normalizedSmartCutQuality(
          cutStats.seamExposureRatio,
          smartGeometryShelter(profile, before, after),
          smartSupportRisk(printability, definition.dimension, positionMm),
        );
        const partitionDimensions = sampledPartitionDimensions(
          sampledPoints,
          definition.dimension,
          positionMm,
        );
        if (!partitionDimensions) return [];
        const flatPartPenalty = Math.max(
          ...partitionDimensions.map(partFlatnessPenalty),
        );
        if (
          (neckRatio > 0.78 && edgeTransitionRatio > 0.62) ||
          areaRatio > 0.38 ||
          contourPenalty > 0.9 ||
          flatPartPenalty > 0.92
        ) {
          return [];
        }
        const transitionScale = Math.max(
          1e-6,
          profile.area,
          before.area,
          after.area,
        );
        const transitionAsymmetry =
          Math.abs(before.area - after.area) / transitionScale;
        return [
          {
            positionMm,
            side: occupiedFraction <= 0.5 ? -1 : 1,
            smartQuality,
            score:
              Math.min(neckRatio, edgeTransitionRatio) * 0.43 +
              areaRatio * 0.24 +
              cutFlatnessPenalty(profile) * 0.09 +
              contourPenalty * 0.3 +
              flatPartPenalty * 0.16 +
              transitionAsymmetry * 0.025 +
              Math.abs(detachedFraction - 0.18) * 0.05 -
              anatomicalBonus +
              smartQuality.seamExposureRatio * 0.12 +
              smartQuality.supportRiskRatio * 0.18 -
              smartQuality.geometryShelterRatio * 0.14,
          },
        ];
      });
      for (const side of [-1, 1] as const) {
        if (additions >= maximumAdditions) break;
        const best = candidates
          .filter((candidate) => candidate.side === side)
          .sort((left, right) => left.score - right.score)[0];
        if (!best || best.score > 0.58) continue;
        const nextAxisCount = plan.gridCounts[definition.dimension] + 1;
        const nextPartCount =
          (plan.partCount / plan.gridCounts[definition.dimension]) *
          nextAxisCount;
        if (
          nextAxisCount > MODEL_SPLITTER_MAX_SEGMENTS_PER_AXIS ||
          nextPartCount > MODEL_SPLITTER_MAX_PARTS
        )
          continue;
        plan.planes.push({
          id: `${definition.axis}-joint-${side < 0 ? "low" : "high"}`,
          axis: definition.axis,
          index: 0,
          positionMm: best.positionMm,
          reason: "anatomical-joint",
          smartQuality: best.smartQuality,
        });
        plan.gridCounts[definition.dimension] = nextAxisCount;
        plan.partCount = nextPartCount;
        additions += 1;
      }
    } finally {
      if (alignedSource !== source) alignedSource.delete();
    }
  }
  for (const definition of AXES) {
    const planes = plan.planes
      .filter((plane) => plane.axis === definition.axis)
      .sort((left, right) => left.positionMm - right.positionMm);
    planes.forEach((plane, index) => {
      plane.index = index + 1;
      plane.id = `${definition.axis}-${index + 1}`;
    });
    plan.centerMm[definition.dimension] =
      planes.length > 0
        ? planes[Math.floor((planes.length - 1) / 2)]!.positionMm
        : (bounds.min[definition.dimension] +
            bounds.max[definition.dimension]) /
          2;
  }
  plan.evaluatedPlanes += additions * 65;
}
function freeJointNormalCandidates(
  definition: AxisDefinition,
): Vector3Tuple[] {
  const transverse = ([0, 1, 2] as const).filter(
    (dimension) => dimension !== definition.dimension,
  );
  const candidates: Vector3Tuple[] = [];
  for (const angleDeg of [7, 13, 19, 25]) {
    const slope = Math.tan((angleDeg * Math.PI) / 180);
    for (const dimension of transverse) {
      for (const sign of [-1, 1] as const) {
        const normal: Vector3Tuple = [...definition.normal];
        normal[dimension] = sign * slope;
        candidates.push(normalizeVector(normal));
      }
    }
  }
  const diagonalSlope = Math.tan((12 * Math.PI) / 180);
  for (const firstSign of [-1, 1] as const) {
    for (const secondSign of [-1, 1] as const) {
      const normal: Vector3Tuple = [...definition.normal];
      normal[transverse[0]] = firstSign * diagonalSlope;
      normal[transverse[1]] = secondSign * diagonalSlope;
      candidates.push(normalizeVector(normal));
    }
  }
  return candidates;
}

function refineSmartFreeJointPlanes(
  mesh: TriangleMeshData,
  plan: ReturnType<typeof createSplitPlan>,
): void {
  if (plan.strategy !== "smart") return;
  let evaluated = 0;
  for (const plane of plan.planes) {
    if (plane.reason !== "anatomical-joint") continue;
    const definition = AXES.find((entry) => entry.axis === plane.axis);
    if (!definition) continue;
    const baseline = meshFreePlaneCutStats(
      mesh,
      definition.normal,
      plane.positionMm,
    );
    if (
      baseline.length <= 1e-6 ||
      !baseline.centroid ||
      baseline.partitionBalanceRatio < 0.035
    ) {
      continue;
    }
    const baselineScore = 1 + baseline.seamExposureRatio * 0.14;
    let best:
      | {
          normal: Vector3Tuple;
          planeOffsetMm: number;
          tiltDeg: number;
          stats: MeshPlaneCutStats;
          score: number;
        }
      | null = null;
    for (const normal of freeJointNormalCandidates(definition)) {
      evaluated += 1;
      const planeOffsetMm = dotVector(baseline.centroid, normal);
      const stats = meshFreePlaneCutStats(mesh, normal, planeOffsetMm);
      if (
        stats.length <= 1e-6 ||
        stats.partitionBalanceRatio <
          Math.max(0.035, baseline.partitionBalanceRatio * 0.58)
      ) {
        continue;
      }
      const lengthRatio = stats.length / baseline.length;
      if (lengthRatio > 1.035) continue;
      const tiltDeg =
        (Math.acos(
          Math.min(1, Math.max(-1, dotVector(definition.normal, normal))),
        ) *
          180) /
        Math.PI;
      const balanceLoss = Math.max(
        0,
        baseline.partitionBalanceRatio - stats.partitionBalanceRatio,
      );
      const score =
        lengthRatio +
        stats.seamExposureRatio * 0.14 +
        balanceLoss * 0.9 +
        (tiltDeg / 90) * 0.09;
      if (!best || score < best.score) {
        best = { normal, planeOffsetMm, tiltDeg, stats, score };
      }
    }
    if (
      !best ||
      best.score > baselineScore - 0.035 ||
      best.stats.length > baseline.length * 0.985
    ) {
      continue;
    }
    plane.normal = best.normal;
    plane.planeOffsetMm = best.planeOffsetMm;
    plane.tiltDeg = best.tiltDeg;
    if (plane.smartQuality) {
      plane.smartQuality = normalizedSmartCutQuality(
        best.stats.seamExposureRatio,
        plane.smartQuality.geometryShelterRatio,
        Math.min(
          1,
          plane.smartQuality.supportRiskRatio + (best.tiltDeg / 90) * 0.04,
        ),
      );
    }
  }
  plan.evaluatedPlanes += evaluated;
}
type SupportSavingCutCandidate = {
  definition: AxisDefinition;
  positionMm: number;
  contactAreaMm2: number;
  score: number;
};

type SupportSavingCutResult = {
  negative: ManifoldSolid;
  positive: ManifoldSolid;
  definition: AxisDefinition;
  positionMm: number;
  requestedConnectors: number;
  reports: ModelSplitConnectorReport[];
};

function largestAxisAlignedFlatFaceArea(solid: ManifoldSolid): number {
  const mesh = manifoldToTriangleMesh(solid);
  const bounds = solid.boundingBox();
  const spans = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const tolerance = Math.max(0.02, Math.max(...spans) * 1e-5);
  const areas = [0, 0, 0, 0, 0, 0];
  const point = (vertex: number): [number, number, number] => [
    mesh.positions[vertex * 3] ?? 0,
    mesh.positions[vertex * 3 + 1] ?? 0,
    mesh.positions[vertex * 3 + 2] ?? 0,
  ];
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = point(mesh.indices[offset] ?? 0);
    const b = point(mesh.indices[offset + 1] ?? 0);
    const c = point(mesh.indices[offset + 2] ?? 0);
    const ab: [number, number, number] = [
      b[0] - a[0],
      b[1] - a[1],
      b[2] - a[2],
    ];
    const ac: [number, number, number] = [
      c[0] - a[0],
      c[1] - a[1],
      c[2] - a[2],
    ];
    const cross: [number, number, number] = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const area = Math.hypot(...cross) / 2;
    for (let dimension = 0; dimension < 3; dimension += 1) {
      if (
        [a, b, c].every(
          (vertex) =>
            Math.abs(vertex[dimension] - bounds.min[dimension]) <= tolerance,
        )
      ) {
        areas[dimension * 2] += area;
      } else if (
        [a, b, c].every(
          (vertex) =>
            Math.abs(vertex[dimension] - bounds.max[dimension]) <= tolerance,
        )
      ) {
        areas[dimension * 2 + 1] += area;
      }
    }
  }
  return Math.max(...areas);
}

function supportSavingCutCandidates(
  solid: ManifoldSolid,
  params: ModelSplitterParams,
  protectedConnectors: readonly ModelSplitConnectorReport[],
): SupportSavingCutCandidate[] {
  const bounds = solid.boundingBox();
  const spans = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const volume = solid.volume();
  if (
    volume < 3_000 ||
    Math.max(...spans) < 25 ||
    Math.min(...spans) <
      params.connectorDiameterMm + params.connectorClearanceMm * 2 + 2
  ) {
    return [];
  }
  const existingFlatArea = largestAxisAlignedFlatFaceArea(solid);
  const candidates: SupportSavingCutCandidate[] = [];
  for (const definition of AXES) {
    const span = spans[definition.dimension];
    const transverse = ([0, 1, 2] as const).filter(
      (dimension) => dimension !== definition.dimension,
    );
    const projectedArea = Math.max(
      1,
      spans[transverse[0]] * spans[transverse[1]],
    );
    const aligned =
      definition.axis === "z"
        ? solid
        : solid.rotate(definition.axis === "x" ? [0, -90, 0] : [90, 0, 0]);
    try {
      for (const fraction of evenlySpaced(0.3, 0.7, 9)) {
        const positionMm = bounds.min[definition.dimension] + span * fraction;
        const connectorConflict = protectedConnectors.some(
          (connector) =>
            Math.abs(connector.centerMm[definition.dimension] - positionMm) <
            connector.diameterMm / 2 + connector.depthMm + 1,
        );
        if (connectorConflict) continue;
        const profile = solidPlaneCutProfile(aligned, positionMm);
        const contactRatio = profile.area / projectedArea;
        if (
          profile.area < Math.max(25, existingFlatArea * 1.2) ||
          contactRatio < 0.18 ||
          fragileSatelliteContourPenalty(profile) > 0
        ) {
          continue;
        }
        candidates.push({
          definition,
          positionMm,
          contactAreaMm2: profile.area,
          score:
            contactRatio -
            Math.abs(fraction - 0.5) * 0.2 -
            Math.min(
              0.2,
              (profile.perimeter / Math.max(1, profile.area)) * 0.02,
            ),
        });
      }
    } finally {
      if (aligned !== solid) aligned.delete();
    }
  }
  return candidates.sort(
    (left, right) =>
      right.score - left.score || right.contactAreaMm2 - left.contactAreaMm2,
  );
}

function trySupportSavingCut(
  kernel: ManifoldToplevel,
  current: WorkingPart,
  params: ModelSplitterParams,
  protectedConnectors: readonly ModelSplitConnectorReport[],
  maximumConnectors: number,
): SupportSavingCutResult | null {
  for (const candidate of supportSavingCutCandidates(
    current.solid,
    params,
    protectedConnectors,
  )) {
    let [positive, negative] = current.solid.splitByPlane(
      candidate.definition.normal,
      candidate.positionMm,
    );
    if (
      positive.isEmpty() ||
      negative.isEmpty() ||
      positive.volume() < current.solid.volume() * 0.18 ||
      negative.volume() < current.solid.volume() * 0.18
    ) {
      positive.delete();
      negative.delete();
      continue;
    }

    const currentBounds = current.solid.boundingBox();
    const maximumDepth = Math.max(
      ...currentBounds.max.map(
        (value, axis) => value - currentBounds.min[axis],
      ),
    );
    const placement = findComponentConnectorCenters(
      kernel,
      negative,
      positive,
      candidate.definition,
      candidate.positionMm,
      params.connectorDiameterMm,
      params.connectorDepthMm,
      maximumDepth,
      params.gluePocketMm,
      params.connectorClearanceMm,
      params.connectorStyle,
      params.connectorSpacingMm,
      null,
      Math.max(1, maximumConnectors),
      false,
    );
    for (const fallback of placement.fallbacks) {
      fallback.negativeComponent.delete();
      fallback.positiveComponent.delete();
      fallback.whole.delete();
    }
    if (placement.placements.length === 0) {
      positive.delete();
      negative.delete();
      continue;
    }

    const negativeId = current.id + "_s01";
    const positiveId = current.id + "_s02";
    const localReports: ModelSplitConnectorReport[] = [];
    for (const [
      connectorIndex,
      connectorPlacement,
    ] of placement.placements.entries()) {
      const { center, diameterMm, depthMm } = connectorPlacement;
      const direction: SplitSign = 1;
      const connectorGluePocket = Math.min(params.gluePocketMm, depthMm * 0.75);
      if (
        !isSafeConnectorSide(
          kernel,
          positive,
          candidate.definition,
          center,
          direction,
          diameterMm / 2,
          depthMm,
          params.connectorClearanceMm,
          connectorGluePocket,
        )
      )
        continue;
      const socketLength = depthMm + connectorGluePocket + 0.12;
      const socketCenter = withAxis(
        center,
        candidate.definition.dimension,
        candidate.positionMm + direction * (socketLength / 2 - 0.06),
      );
      const socket = makeConnectorSolid(
        kernel,
        candidate.definition.axis,
        socketLength,
        diameterMm + params.connectorClearanceMm * 2,
        socketCenter,
        params.connectorStyle,
        "socket",
      );
      const withSocket = positive.subtract(socket);
      if (
        !hasProtectedConnectorCollar(
          kernel,
          positive,
          withSocket,
          socket,
          candidate.definition,
          center,
          direction,
          diameterMm / 2,
          depthMm,
          params.connectorClearanceMm,
          connectorGluePocket,
        )
      ) {
        withSocket.delete();
        socket.delete();
        continue;
      }
      const attachmentDepth = Math.min(0.8, depthMm * 0.25);
      const pegLength = depthMm + attachmentDepth;
      const pegCenter = withAxis(
        center,
        candidate.definition.dimension,
        candidate.positionMm + direction * ((depthMm - attachmentDepth) / 2),
      );
      const peg = makeConnectorSolid(
        kernel,
        candidate.definition.axis,
        pegLength,
        diameterMm,
        pegCenter,
        params.connectorStyle,
        "male",
        direction,
      );
      const pegIntersection = negative.intersect(peg);
      const pegIsAttached =
        pegIntersection.volume() >=
        peg.volume() * (attachmentDepth / pegLength) * 0.3;
      pegIntersection.delete();
      if (!pegIsAttached) {
        peg.delete();
        withSocket.delete();
        socket.delete();
        continue;
      }
      const withPeg = negative.add(peg);
      peg.delete();
      socket.delete();
      negative.delete();
      positive.delete();
      negative = withPeg;
      positive = withSocket;
      localReports.push({
        id:
          "support-" +
          current.id +
          "-" +
          candidate.definition.axis +
          "-c" +
          (connectorIndex + 1),
        interfaceId: "support-" + current.id + "-" + candidate.definition.axis,
        axis: candidate.definition.axis,
        malePartId: negativeId,
        femalePartId: positiveId,
        centerMm: center,
        diameterMm,
        depthMm,
        clearanceMm: params.connectorClearanceMm,
        gluePocketMm: connectorGluePocket,
        style: params.connectorStyle,
        placement: "automatic",
      });
    }
    if (localReports.length === 0) {
      positive.delete();
      negative.delete();
      continue;
    }
    return {
      negative,
      positive,
      definition: candidate.definition,
      positionMm: candidate.positionMm,
      requestedConnectors: placement.requested,
      reports: localReports,
    };
  }
  return null;
}

export async function generateModelSplitter(
  mesh: TriangleMeshData,
  params: ModelSplitterParams,
  options: ModelSplitterGenerationOptions = {},
): Promise<ModelSplitterGenerationResult> {
  const startedAt = now();
  const issues = validateModelSplitterParams(params);
  if (issues.length > 0) {
    throw new ModelSplitterError(
      "INVALID_PARAMETERS",
      "At least one model splitter parameter is outside the supported range.",
      issues[0]?.message,
    );
  }
  await checkpoint(
    options,
    "validating",
    0.05,
    "Checking the source model and configured print bed",
  );
  const kernel = await loadManifold();
  const bounds = calculateMeshBounds(mesh);
  const owned = new Set<ManifoldSolid>();
  const own = (solid: ManifoldSolid): ManifoldSolid => {
    owned.add(solid);
    return solid;
  };
  const release = (solid: ManifoldSolid): void => {
    if (!owned.delete(solid)) return;
    solid.delete();
  };
  const disposeAll = (): void => {
    for (const solid of owned) solid.delete();
    owned.clear();
  };

  let source: ManifoldSolid;
  try {
    const imported = own(triangleMeshToManifold(kernel, mesh));
    const components = imported.decompose();
    try {
      if (components.length > 1) {
        source = own(kernel.Manifold.union(components));
        release(imported);
      } else {
        source = imported;
      }
    } finally {
      for (const component of components) component.delete();
    }
  } catch (error) {
    disposeAll();
    throw new ModelSplitterError(
      "INVALID_SOURCE_MESH",
      "The source model is not a closed, oriented solid.",
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    await checkpoint(
      options,
      "validating",
      0.12,
      params.splitStrategy === "smart"
        ? "Optimizing bed-sized cuts against the model geometry"
        : "Calculating the smallest print-bed grid",
    );
    const sourceVolumeMm3 = source.volume();
    const splitPlan = createSplitPlan(
      source,
      bounds,
      params,
      options.isCancelled,
    );
    refineSmartSplitPlanes(mesh, source, bounds, params, splitPlan);
    addSmartBoundaryJointPlanes(mesh, source, bounds, params, splitPlan);
    refineSmartFreeJointPlanes(mesh, splitPlan);
    if (splitPlan.exceedsSafetyLimit) {
      throw new ModelSplitterError(
        "PART_LIMIT_EXCEEDED",
        `The configured print bed would require ${splitPlan.partCount} parts (${splitPlan.gridCounts.join(" × ")}). The stability limit is 256 parts and 8 segments per axis.`,
      );
    }
    const counts: GridIndex = [...splitPlan.gridCounts];
    const activeAxes = AXES.filter(
      (definition) => counts[definition.dimension] > 1,
    ).map((definition) => definition.axis);
    let working: Array<{ gridIndex: GridIndex; solid: ManifoldSolid }> = [
      { gridIndex: [0, 0, 0], solid: source },
    ];

    await checkpoint(
      options,
      "shell",
      0.18,
      `Cutting the model into ${splitPlan.partCount} ${params.splitStrategy === "smart" ? "geometry-optimized" : "print-bed-sized"} parts`,
    );
    for (const definition of AXES) {
      const axisPlanes = splitPlan.planes
        .filter((plane) => plane.axis === definition.axis)
        .sort((a, b) => a.positionMm - b.positionMm);
      if (axisPlanes.length === 0) continue;
      const next: typeof working = [];
      for (const [entryIndex, entry] of working.entries()) {
        let remainder: ManifoldSolid | null = entry.solid;
        for (let segment = 0; segment < axisPlanes.length; segment += 1) {
          if (!remainder) break;
          const plane = axisPlanes[segment];
          const planeDefinition = splitPlaneDefinition(definition, plane);
          const planeOffset = splitPlaneOffset(plane);
          const [positive, negative] = remainder.splitByPlane(
            planeDefinition.normal,
            planeOffset,
          );
          release(remainder);
          own(positive);
          own(negative);
          const positiveHasVolume =
            !positive.isEmpty() && positive.volume() > 1e-6;
          const negativeHasVolume =
            !negative.isEmpty() && negative.volume() > 1e-6;
          if (!positiveHasVolume && !negativeHasVolume) {
            throw new ModelSplitterError(
              "EMPTY_SPLIT_PART",
              `The ${definition.axis.toUpperCase()} split lost all solid volume. Check the source mesh.`,
              plane.id,
            );
          }
          if (negativeHasVolume) {
            const negativeIndex: GridIndex = [...entry.gridIndex];
            negativeIndex[definition.dimension] = segment;
            next.push({ gridIndex: negativeIndex, solid: negative });
          } else {
            release(negative);
          }
          if (positiveHasVolume) {
            remainder = positive;
          } else {
            release(positive);
            remainder = null;
          }
        }
        if (remainder) {
          const finalIndex: GridIndex = [...entry.gridIndex];
          finalIndex[definition.dimension] = axisPlanes.length;
          next.push({ gridIndex: finalIndex, solid: remainder });
        }
        if ((entryIndex + 1) % 8 === 0) {
          await checkpoint(
            options,
            "shell",
            0.2 + definition.dimension * 0.08,
            `Cutting ${splitPlan.partCount} parts · ${definition.axis.toUpperCase()} batch ${entryIndex + 1}/${working.length}`,
          );
        }
      }
      working = next;
    }

    const parts = new Map<string, WorkingPart>();
    for (const entry of working) {
      const id = partId(entry.gridIndex, counts);
      parts.set(partKey(entry.gridIndex), {
        id,
        gridIndex: entry.gridIndex,
        direction: directionFor(entry.gridIndex, counts),
        solid: entry.solid,
      });
    }
    if (parts.size === 0) {
      throw new ModelSplitterError(
        "EMPTY_SPLIT_PART",
        "The automatic grid did not produce any solid part.",
      );
    }

    if (params.splitStrategy === "smart" && parts.size > 1) {
      const solidFitsPrintVolume = (solid: ManifoldSolid): boolean => {
        const solidBounds = solid.boundingBox();
        return dimensionsFitBuildVolume(
          solidBounds.max.map(
            (value, dimension) => value - solidBounds.min[dimension],
          ),
          splitPlan.buildVolumeMm,
        );
      };
      const maximumRelocations = Math.max(1, parts.size * 6);

      for (let relocation = 0; relocation < maximumRelocations; relocation += 1) {
        let relocated = false;
        const orderedParts = [...parts.values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        );

        for (const current of orderedParts) {
          const components = current.solid
            .decompose()
            .sort((left, right) => right.volume() - left.volume());
          try {
            if (components.length <= 1) continue;
            const currentVolume = Math.max(1e-6, current.solid.volume());

            for (const component of components.slice(1)) {
              const componentVolume = component.volume();
              if (
                componentVolume > 8_000 &&
                componentVolume / currentVolume > 0.12
              ) {
                continue;
              }

              const neighbors: Array<{
                part: WorkingPart;
                overlapVolume: number;
              }> = [];
              for (const definition of AXES) {
                for (const direction of [-1, 1] as const) {
                  const neighborIndex: GridIndex = [...current.gridIndex];
                  neighborIndex[definition.dimension] += direction;
                  if (
                    neighborIndex[definition.dimension] < 0 ||
                    neighborIndex[definition.dimension] >=
                      counts[definition.dimension]
                  ) {
                    continue;
                  }
                  const neighbor = parts.get(partKey(neighborIndex));
                  if (!neighbor) continue;
                  const boundary = Math.max(
                    current.gridIndex[definition.dimension],
                    neighborIndex[definition.dimension],
                  );
                  const splitPlane = splitPlan.planes.find(
                    (plane) =>
                      plane.axis === definition.axis && plane.index === boundary,
                  );
                  if (!splitPlane) continue;
                  const planeDefinition = splitPlaneDefinition(
                    definition,
                    splitPlane,
                  );
                  const shifted = component.translate(
                    planeDefinition.normal.map(
                      (value) => value * direction * 0.2,
                    ) as Vector3Tuple,
                  );
                  const overlap = shifted.intersect(neighbor.solid);
                  const overlapVolume = overlap.volume();
                  overlap.delete();
                  shifted.delete();
                  if (overlapVolume > 1e-4) {
                    neighbors.push({ part: neighbor, overlapVolume });
                  }
                }
              }
              neighbors.sort(
                (left, right) =>
                  right.overlapVolume - left.overlapVolume ||
                  left.part.id.localeCompare(right.part.id),
              );
              const destination = neighbors[0]?.part;
              if (!destination) continue;

              const currentWithoutComponent = current.solid.subtract(component);
              const destinationWithComponent = destination.solid.add(component);
              const validReplacement =
                !currentWithoutComponent.isEmpty() &&
                currentWithoutComponent.volume() > 1e-6 &&
                !destinationWithComponent.isEmpty() &&
                destinationWithComponent.volume() > 1e-6 &&
                solidFitsPrintVolume(currentWithoutComponent) &&
                solidFitsPrintVolume(destinationWithComponent);
              if (!validReplacement) {
                currentWithoutComponent.delete();
                destinationWithComponent.delete();
                continue;
              }

              const previousCurrent = current.solid;
              const previousDestination = destination.solid;
              current.solid = own(currentWithoutComponent);
              destination.solid = own(destinationWithComponent);
              release(previousCurrent);
              release(previousDestination);
              relocated = true;
              break;
            }
          } finally {
            for (const component of components) component.delete();
          }
          if (relocated) break;
        }
        if (!relocated) break;
      }
    }

    const splitVolumeMm3 = [...parts.values()].reduce(
      (total, part) => total + part.solid.volume(),
      0,
    );
    const splitVolumeToleranceMm3 = Math.max(1e-3, sourceVolumeMm3 * 1e-5);
    if (Math.abs(splitVolumeMm3 - sourceVolumeMm3) > splitVolumeToleranceMm3) {
      throw new ModelSplitterError(
        "TOPOLOGY_INVALID",
        "The split changed the source volume instead of only separating it.",
        `source ${sourceVolumeMm3.toFixed(3)} mm³ · parts ${splitVolumeMm3.toFixed(3)} mm³`,
      );
    }

    const occupiedInterfaceCount = AXES.reduce(
      (total, definition) =>
        total + interfacePairs(parts, counts, definition).length,
      0,
    );
    const connectorPolicy = modelSplitterConnectorPolicy(
      counts,
      occupiedInterfaceCount,
    );

    const minimumSegmentSize = Math.min(
      bounds.size[0] / counts[0],
      bounds.size[1] / counts[1],
      bounds.size[2] / counts[2],
    );
    const effectiveDiameter = Math.min(
      params.connectorDiameterMm,
      Math.max(2, minimumSegmentSize * 0.3),
    );
    const effectiveDepth = params.connectorDepthMm;
    const reports: ModelSplitConnectorReport[] = [];
    const labelAnchors = new Map<ModelSplitPartId, LabelAnchor>();
    let requestedConnectorCount = 0;

    if (activeAxes.length > 0 && (params.connectors || params.engravedLabels)) {
      await checkpoint(
        options,
        "registration",
        0.48,
        "Adding checked connector grids and assembly marks",
      );
      let processedInterfaces = 0;
      for (const [axisIndex, definition] of AXES.entries()) {
        if (counts[definition.dimension] <= 1) continue;
        for (const [pairIndex, pair] of interfacePairs(
          parts,
          counts,
          definition,
        ).entries()) {
          const splitPlane = splitPlan.planes.find(
            (plane) =>
              plane.axis === definition.axis && plane.index === pair.boundary,
          );
          if (!splitPlane) continue;
          const interfaceDefinition = splitPlaneDefinition(
            definition,
            splitPlane,
          );
          const planeOffset = splitPlaneOffset(splitPlane);
          const manualPosition =
            params.connectorPlacement === "manual"
              ? (params.manualConnectorPositionPercent[pair.interfaceId] ??
                null)
              : null;
          const bedAxisIndex = (["width", "depth", "height"] as const).indexOf(
            splitPlan.modelToBedAxes[definition.dimension],
          );
          const nominalSegmentSpan =
            bounds.size[definition.dimension] / counts[definition.dimension];
          const maximumDepth = Math.max(
            MODEL_SPLITTER_LIMITS.connectorDepthMm.min,
            splitPlan.buildVolumeMm[bedAxisIndex] - nominalSegmentSpan,
          );
          const placement = findPlaneConnectorCenters(
            kernel,
            pair.negative.solid,
            pair.positive.solid,
            interfaceDefinition,
            planeOffset,
            effectiveDiameter,
            effectiveDepth,
            maximumDepth,
            params.gluePocketMm,
            params.connectorClearanceMm,
            params.connectorStyle,
            params.connectorSpacingMm,
            manualPosition,
            connectorPolicy.maxPerInterface,
            params.connectors,
          );
          if (params.connectors) {
            for (const fallback of placement.fallbacks) {
              const temporary = new Set<ManifoldSolid>();
              try {
                let updatedNegative = pair.negative.solid.subtract(
                  fallback.negativeComponent,
                );
                temporary.add(updatedNegative);
                let updatedPositive = pair.positive.solid.subtract(
                  fallback.positiveComponent,
                );
                temporary.add(updatedPositive);
                const removesEntirePart =
                  updatedNegative.isEmpty() ||
                  updatedPositive.isEmpty() ||
                  updatedNegative.volume() <= 1e-6 ||
                  updatedPositive.volume() <= 1e-6;
                if (removesEntirePart) {
                  // Never move an unconnectable detail across the split when
                  // doing so would erase one complete printable part. Keep the
                  // original watertight glue faces instead.
                  continue;
                }
                if (fallback.target === "negative") {
                  const withWhole = updatedNegative.add(fallback.whole);
                  temporary.add(withWhole);
                  updatedNegative.delete();
                  temporary.delete(updatedNegative);
                  updatedNegative = withWhole;
                } else {
                  const withWhole = updatedPositive.add(fallback.whole);
                  temporary.add(withWhole);
                  updatedPositive.delete();
                  temporary.delete(updatedPositive);
                  updatedPositive = withWhole;
                }
                release(pair.negative.solid);
                release(pair.positive.solid);
                pair.negative.solid = own(updatedNegative);
                pair.positive.solid = own(updatedPositive);
                temporary.delete(updatedNegative);
                temporary.delete(updatedPositive);
              } finally {
                for (const solid of temporary) solid.delete();
                fallback.negativeComponent.delete();
                fallback.positiveComponent.delete();
                fallback.whole.delete();
              }
            }
          }
          if (params.connectors) requestedConnectorCount += placement.requested;
          const maleIsNegative =
            (axisIndex + pairIndex + pair.boundary) % 2 === 0;
          for (const [
            connectorIndex,
            connectorPlacement,
          ] of placement.placements.entries()) {
            const { center, diameterMm, depthMm } = connectorPlacement;
            if (isAxisAlignedDefinition(interfaceDefinition)) {
              if (!labelAnchors.has(pair.negative.id)) {
                labelAnchors.set(pair.negative.id, {
                  axis: definition.axis,
                  center,
                  inwardDirection: -1,
                });
              }
              if (!labelAnchors.has(pair.positive.id)) {
                labelAnchors.set(pair.positive.id, {
                  axis: definition.axis,
                  center,
                  inwardDirection: 1,
                });
              }
            }
            if (!params.connectors) continue;

            const connectorId = `${pair.interfaceId}-c${connectorIndex + 1}`;
            const male = maleIsNegative ? pair.negative : pair.positive;
            const female = maleIsNegative ? pair.positive : pair.negative;
            const direction: SplitSign = maleIsNegative ? 1 : -1;
            const connectorGluePocket = Math.min(
              params.gluePocketMm,
              depthMm * 0.75,
            );
            if (
              !isSafeConnectorSide(
                kernel,
                female.solid,
                interfaceDefinition,
                center,
                direction,
                diameterMm / 2,
                depthMm,
                params.connectorClearanceMm,
                connectorGluePocket,
              )
            )
              continue;
            const socketLength = depthMm + connectorGluePocket + 0.12;
            // The socket must extend from the split plane into the female solid.
            // Direction points from the male side toward the female side.
            const socketCenter = offsetPoint(
              center,
              interfaceDefinition.normal,
              direction * (socketLength / 2 - 0.06),
            );
            const socket = makeConnectorSolid(
              kernel,
              interfaceDefinition.normal,
              socketLength,
              diameterMm + params.connectorClearanceMm * 2,
              socketCenter,
              params.connectorStyle,
              "socket",
            );
            const withSocket = female.solid.subtract(socket);
            if (
              !hasProtectedConnectorCollar(
                kernel,
                female.solid,
                withSocket,
                socket,
                interfaceDefinition,
                center,
                direction,
                diameterMm / 2,
                depthMm,
                params.connectorClearanceMm,
                connectorGluePocket,
              )
            ) {
              withSocket.delete();
              socket.delete();
              continue;
            }

            const attachmentDepth = Math.min(0.8, depthMm * 0.25);
            const pegLength = depthMm + attachmentDepth;
            const pegCenter = offsetPoint(
              center,
              interfaceDefinition.normal,
              direction * ((depthMm - attachmentDepth) / 2),
            );
            const peg = makeConnectorSolid(
              kernel,
              interfaceDefinition.normal,
              pegLength,
              diameterMm,
              pegCenter,
              params.connectorStyle,
              "male",
              direction,
            );
            const pegIntersection = male.solid.intersect(peg);
            const pegIsAttached =
              pegIntersection.volume() >=
              peg.volume() * (attachmentDepth / pegLength) * 0.3;
            pegIntersection.delete();
            if (!pegIsAttached) {
              peg.delete();
              withSocket.delete();
              socket.delete();
              continue;
            }
            const withPeg = male.solid.add(peg);
            peg.delete();
            socket.delete();
            release(male.solid);
            male.solid = own(withPeg);
            release(female.solid);
            female.solid = own(withSocket);

            reports.push({
              id: connectorId,
              interfaceId: pair.interfaceId,
              axis: definition.axis,
              ...(isAxisAlignedDefinition(interfaceDefinition)
                ? {}
                : { normal: [...interfaceDefinition.normal] }),
              malePartId: male.id,
              femalePartId: female.id,
              centerMm: center,
              diameterMm,
              depthMm,
              clearanceMm: params.connectorClearanceMm,
              gluePocketMm: connectorGluePocket,
              style: params.connectorStyle,
              placement: params.connectorPlacement,
            });
          }
          processedInterfaces += 1;
          if (processedInterfaces % 16 === 0) {
            await checkpoint(
              options,
              "registration",
              0.48 +
                0.26 *
                  (processedInterfaces /
                    Math.max(1, connectorPolicy.interfaceCount)),
              `Connector batch ${processedInterfaces}/${connectorPolicy.interfaceCount} · max ${connectorPolicy.maxPerInterface} per face`,
            );
          }
        }
      }
    }

    let orderedParts = [...parts.values()].sort(
      (a, b) =>
        a.gridIndex[0] - b.gridIndex[0] ||
        a.gridIndex[1] - b.gridIndex[1] ||
        a.gridIndex[2] - b.gridIndex[2],
    );
    let supportSavingCutCount = 0;
    if (params.supportSavingCuts && params.connectors) {
      await checkpoint(
        options,
        "registration",
        0.75,
        "Finding optional support-saving flat cuts",
      );
      const expandedParts: WorkingPart[] = [];
      for (const [partIndex, current] of orderedParts.entries()) {
        if (
          orderedParts.length + supportSavingCutCount >=
          MODEL_SPLITTER_MAX_PARTS
        ) {
          expandedParts.push(current);
          continue;
        }
        const protectedConnectors = reports.filter(
          (report) =>
            report.malePartId === current.id ||
            report.femalePartId === current.id,
        );
        const secondary = trySupportSavingCut(
          kernel,
          current,
          params,
          protectedConnectors,
          connectorPolicy.maxPerInterface,
        );
        if (!secondary) {
          expandedParts.push(current);
          continue;
        }

        const negativeId = current.id + "_s01";
        const positiveId = current.id + "_s02";
        for (const report of reports) {
          const replacementId =
            report.centerMm[secondary.definition.dimension] <=
            secondary.positionMm
              ? negativeId
              : positiveId;
          if (report.malePartId === current.id)
            report.malePartId = replacementId;
          if (report.femalePartId === current.id)
            report.femalePartId = replacementId;
        }
        const anchor = labelAnchors.get(current.id);
        if (anchor) {
          labelAnchors.delete(current.id);
          const anchorPartId =
            anchor.center[secondary.definition.dimension] <=
            secondary.positionMm
              ? negativeId
              : positiveId;
          labelAnchors.set(anchorPartId, anchor);
        }

        release(current.solid);
        expandedParts.push(
          { ...current, id: negativeId, solid: own(secondary.negative) },
          { ...current, id: positiveId, solid: own(secondary.positive) },
        );
        requestedConnectorCount += secondary.requestedConnectors;
        reports.push(...secondary.reports);
        supportSavingCutCount += 1;
        if ((partIndex + 1) % 8 === 0) {
          await checkpoint(
            options,
            "registration",
            0.75 + 0.03 * ((partIndex + 1) / orderedParts.length),
            "Support-saving cut batch " +
              (partIndex + 1) +
              "/" +
              orderedParts.length,
          );
        }
      }
      orderedParts = expandedParts;
    }
    const engravedLabels: Array<{ partId: ModelSplitPartId; label: string }> =
      [];
    if (params.engravedLabels) {
      for (const [index, current] of orderedParts.entries()) {
        const anchor = labelAnchors.get(current.id);
        if (!anchor) continue;
        const engraving = engraveAssemblyCode(
          kernel,
          current.solid,
          anchor,
          index + 1,
          effectiveDiameter,
        );
        if (engraving.solid !== current.solid) {
          release(current.solid);
          current.solid = own(engraving.solid);
        }
        if (engraving.applied) {
          engravedLabels.push({
            partId: current.id,
            label: assemblyLabel(index),
          });
        }
        if ((index + 1) % 16 === 0) {
          await checkpoint(
            options,
            "registration",
            0.78,
            `Engraving batch ${index + 1}/${orderedParts.length}`,
          );
        }
      }
    }

    await checkpoint(
      options,
      "orienting",
      0.82,
      `Centering and validating all ${orderedParts.length} parts`,
    );
    const outputParts: ModelSplitterGenerationResult["parts"] = [];
    for (const [index, current] of orderedParts.entries()) {
      const currentBounds = current.solid.boundingBox();
      const assemblyCenter: [number, number, number] = [
        (currentBounds.min[0] + currentBounds.max[0]) / 2,
        (currentBounds.min[1] + currentBounds.max[1]) / 2,
        (currentBounds.min[2] + currentBounds.max[2]) / 2,
      ];
      const centered = current.solid.translate([
        -assemblyCenter[0],
        -assemblyCenter[1],
        -assemblyCenter[2],
      ]);
      own(centered);
      release(current.solid);
      current.solid = centered;
      const metrics = measureSolid(centered);
      const dimensions = metrics.bounds.max.map(
        (value, axis) => value - metrics.bounds.min[axis],
      );
      const fitsPrintVolume = dimensionsFitBuildVolume(
        dimensions,
        splitPlan.buildVolumeMm,
      );
      if (
        !metrics.closed ||
        metrics.boundaryEdges !== 0 ||
        metrics.nonManifoldEdges !== 0 ||
        metrics.volumeMm3 <= 0
      ) {
        throw new ModelSplitterError(
          "TOPOLOGY_INVALID",
          `Split part ${current.id} is not a closed printable solid.`,
        );
      }
      outputParts.push({
        id: current.id,
        assemblyLabel: assemblyLabel(index),
        mesh: manifoldToTriangleMesh(centered),
        metrics,
        fitsPrintVolume,
        assemblyCenterMm: assemblyCenter,
        gridIndex: current.gridIndex,
        gridCounts: counts,
        direction: current.direction,
      });
      if ((index + 1) % 16 === 0) {
        await checkpoint(
          options,
          "orienting",
          0.82 + 0.14 * ((index + 1) / orderedParts.length),
          `Mesh batch ${index + 1}/${orderedParts.length}`,
        );
      }
    }

    const fittingPartCount = outputParts.filter(
      (part) => part.fitsPrintVolume,
    ).length;
    const filamentEstimate = estimateFilamentUsage(
      outputParts.map((part) => part.metrics),
      params,
    );
    const volumes = outputParts.map((part) => part.metrics.volumeMm3);
    const volumeBalanceRatio = Math.min(...volumes) / Math.max(...volumes);

    const result: ModelSplitterGenerationResult = {
      kind: "model-splitter",
      parts: outputParts,
      features: {
        partCount: outputParts.length,
        gridCounts: counts,
        activeSplitAxes: activeAxes,
        splitCenterMm: splitPlan.centerMm,
        splitPlanes: splitPlan.planes,
        splitPlan: {
          ...splitPlan,
          fittingPartCount,
          allPartsFit: fittingPartCount === outputParts.length,
          volumeBalanceRatio,
        },
        filamentEstimate,
        sourceBounds: { min: [...bounds.min], max: [...bounds.max] },
        connectorPolicy,
        requestedConnectorCount: params.connectors
          ? requestedConnectorCount
          : 0,
        connectors: reports,
        skippedConnectorCount: params.connectors
          ? Math.max(0, requestedConnectorCount - reports.length)
          : 0,
        supportSavingCutCount,
        engravedLabels,
        centeredOrigins: true,
      },
      params: structuredClone(params),
      totalDurationMs: now() - startedAt,
    };
    disposeAll();
    await checkpoint(
      options,
      "complete",
      1,
      `${outputParts.length} centered parts generated in a ${counts.join(" × ")} grid`,
    );
    return result;
  } catch (error) {
    disposeAll();
    if (error instanceof ModelSplitterError) throw error;
    throw new ModelSplitterError(
      "SPLITTER_KERNEL_FAILED",
      "The model could not be split locally.",
      error instanceof Error ? error.message : String(error),
    );
  }
}

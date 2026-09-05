import {
  MODEL_SPLITTER_MAX_PARTS,
  MODEL_SPLITTER_MAX_SEGMENTS_PER_AXIS,
  type ModelSplitterParams,
} from "../../domain/model-splitter";
import type { MeshBounds3 } from "../mold/placement";
type SplitPlanningBounds = Pick<MeshBounds3, "min" | "max" | "size">;
import type { ModelSplitAxis, PrintBedAxis, SplitPlane } from "./types";

export type AutomaticSplitPlan = {
  centerMm: [number, number, number];
  planes: SplitPlane[];
  gridCounts: [number, number, number];
  partCount: number;
  strategy: ModelSplitterParams["splitStrategy"];
  buildVolumeMm: [number, number, number];
  usableBuildVolumeMm: [number, number, number];
  modelToBedAxes: [PrintBedAxis, PrintBedAxis, PrintBedAxis];
  evaluatedPlanes: number;
  theoreticalBedFit: boolean;
  exceedsSafetyLimit: boolean;
};

const AXIS_NAMES: PrintBedAxis[] = ["width", "depth", "height"];
const AXIS_KEYS: ModelSplitAxis[] = ["x", "y", "z"];
export const MODEL_SPLITTER_MAX_BUILD_VOLUME_OCCUPANCY = 0.85;
const PERMUTATIONS: Array<[0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2]> = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

export function dimensionsFitBuildVolume(
  dimensionsMm: readonly number[],
  buildVolumeMm: readonly number[],
): boolean {
  const part = [...dimensionsMm].sort((a, b) => a - b);
  const bed = [...buildVolumeMm].sort((a, b) => a - b);
  return part.every((value, index) => value <= (bed[index] ?? 0) + 1e-6);
}

function chooseGrid(
  size: [number, number, number],
  bed: [number, number, number],
  connectorAllowance: number,
): {
  mapping: [0 | 1 | 2, 0 | 1 | 2, 0 | 1 | 2];
  usable: [number, number, number];
  counts: [number, number, number];
  score: number;
} {
  let best: ReturnType<typeof chooseGrid> | null = null;
  for (const mapping of PERMUTATIONS) {
    const usable = mapping.map((bedAxis) =>
      Math.max(
        1,
        Math.min(
          bed[bedAxis] - connectorAllowance,
          bed[bedAxis] * MODEL_SPLITTER_MAX_BUILD_VOLUME_OCCUPANCY,
        ),
      ),
    ) as [number, number, number];
    const counts = size.map((span, axis) =>
      Math.max(1, Math.ceil(Math.max(0, span - 1e-6) / usable[axis])),
    ) as [number, number, number];
    const partCount = counts[0] * counts[1] * counts[2];
    const slack = counts.reduce(
      (sum, count, axis) =>
        sum + Math.abs(count * usable[axis] - size[axis]) / usable[axis],
      0,
    );
    const score = partCount * 1_000 + Math.max(...counts) * 10 + slack;
    if (!best || score < best.score) best = { mapping, usable, counts, score };
  }
  return best!;
}

function planePositions(
  bounds: SplitPlanningBounds,
  counts: [number, number, number],
  usable: [number, number, number],
  params: ModelSplitterParams,
): SplitPlane[] {
  const planes: SplitPlane[] = [];
  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const count = counts[axisIndex];
    const axis = AXIS_KEYS[axisIndex];
    const minimumSpan = Math.min(
      (bounds.size[axisIndex] / Math.max(1, count)) * 0.25,
      Math.max(1, params.connectorDiameterMm + params.connectorClearanceMm + 1),
    );
    let previous = bounds.min[axisIndex];
    for (let index = 1; index < count; index += 1) {
      const id = `${axis}-${index}`;
      const automatic =
        bounds.min[axisIndex] + (bounds.size[axisIndex] * index) / count;
      const requested =
        params.manualSplitPlaneMm[id] ??
        (count === 2 ? params.manualSplitCenterMm[axisIndex] : automatic);
      const remainingSegments = count - index;
      const low = Math.max(
        previous + minimumSpan,
        bounds.max[axisIndex] - remainingSegments * usable[axisIndex],
      );
      const high = Math.min(
        previous + usable[axisIndex],
        bounds.max[axisIndex] - remainingSegments * minimumSpan,
      );
      const positionMm =
        params.splitStrategy === "manual"
          ? Math.min(high, Math.max(low, requested))
          : automatic;
      planes.push({ id, axis, index, positionMm });
      previous = positionMm;
    }
  }
  return planes;
}

export function planSplitGrid(
  bounds: MeshBounds3,
  params: ModelSplitterParams,
): AutomaticSplitPlan {
  const bed: [number, number, number] = [
    params.printBedWidthMm,
    params.printBedDepthMm,
    params.printBedHeightMm,
  ];
  const connectorAllowance = params.connectors
    ? params.connectorDepthMm + params.connectorClearanceMm + 1
    : 1;
  const chosen = chooseGrid(bounds.size, bed, connectorAllowance);
  const partCount = chosen.counts[0] * chosen.counts[1] * chosen.counts[2];
  const planes = planePositions(bounds, chosen.counts, chosen.usable, params);
  const centerMm: [number, number, number] = [0, 0, 0].map((_, axis) => {
    const axisPlanes = planes.filter((plane) => plane.axis === AXIS_KEYS[axis]);
    return axisPlanes.length > 0
      ? axisPlanes[Math.floor((axisPlanes.length - 1) / 2)].positionMm
      : (bounds.min[axis] + bounds.max[axis]) / 2;
  }) as [number, number, number];
  const exceedsSafetyLimit =
    partCount > MODEL_SPLITTER_MAX_PARTS ||
    chosen.counts.some((count) => count > MODEL_SPLITTER_MAX_SEGMENTS_PER_AXIS);
  return {
    centerMm,
    planes,
    gridCounts: chosen.counts,
    partCount,
    strategy: params.splitStrategy,
    buildVolumeMm: bed,
    usableBuildVolumeMm: chosen.usable,
    modelToBedAxes: chosen.mapping.map((axis) => AXIS_NAMES[axis]) as [
      PrintBedAxis,
      PrintBedAxis,
      PrintBedAxis,
    ],
    evaluatedPlanes: PERMUTATIONS.length,
    theoreticalBedFit: !exceedsSafetyLimit,
    exceedsSafetyLimit,
  };
}

/** Kept as the worker-facing planner entry point. */
export function createSplitPlan(
  _source: unknown,
  bounds: SplitPlanningBounds,
  params: ModelSplitterParams,
  isCancelled?: () => boolean,
): AutomaticSplitPlan {
  void isCancelled;
  return planSplitGrid(bounds, params);
}

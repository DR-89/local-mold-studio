import type {
  FilamentUsageEstimate,
  ModelSplitterConnectorPlacement,
  ModelSplitterConnectorStyle,
  ModelSplitterParams,
} from "../../domain/model-splitter";
import type { SolidMetrics } from "../kernel/adapter";
import type { TriangleMeshData } from "../../workers/protocol";
import type { MoldGenerationOptions } from "../mold/types";

export type ModelSplitPartId = string;
export type ModelSplitAxis = "x" | "y" | "z";
export type PrintBedAxis = "width" | "depth" | "height";
export type SmartCutQuality = {
  /** Estimated fraction of the seam exposed from canonical front/top views. */
  seamExposureRatio: number;
  /** Fraction by which neighboring cross-sections shelter the selected seam. */
  geometryShelterRatio: number;
  /** Estimated overhang fraction in the best plausible local print orientations. */
  supportRiskRatio: number;
};

export type SplitPlane = {
  id: string;
  axis: ModelSplitAxis;
  index: number;
  positionMm: number;
  reason?: "anatomical-joint";
  /** Unit normal for a Stage-3 free joint plane; omitted for axis-aligned cuts. */
  normal?: [number, number, number];
  /** Signed distance from the model origin along the free-plane normal. */
  planeOffsetMm?: number;
  /** Angular departure from the principal X/Y/Z axis. */
  tiltDeg?: number;
  smartQuality?: SmartCutQuality;
};

export type ModelSplitPartResult = {
  id: ModelSplitPartId;
  assemblyLabel: string;
  mesh: TriangleMeshData;
  metrics: SolidMetrics;
  assemblyCenterMm: [number, number, number];
  fitsPrintVolume: boolean;
  gridIndex: [number, number, number];
  gridCounts: [number, number, number];
  direction: {
    x: -1 | 0 | 1;
    y: -1 | 0 | 1;
    z: -1 | 0 | 1;
  };
};

export type ModelSplitConnectorReport = {
  id: string;
  interfaceId: string;
  axis: ModelSplitAxis;
  /** Unit normal used by free Stage-3 connector pairs. */
  normal?: [number, number, number];
  malePartId: ModelSplitPartId;
  femalePartId: ModelSplitPartId;
  centerMm: [number, number, number];
  diameterMm: number;
  depthMm: number;
  clearanceMm: number;
  gluePocketMm: number;
  style: ModelSplitterConnectorStyle;
  placement: ModelSplitterConnectorPlacement;
};

export type ModelSplitterGenerationResult = {
  kind: "model-splitter";
  parts: ModelSplitPartResult[];
  features: {
    partCount: number;
    gridCounts: [number, number, number];
    activeSplitAxes: ModelSplitAxis[];
    splitCenterMm: [number, number, number];
    splitPlanes: SplitPlane[];
    splitPlan: {
      strategy: ModelSplitterParams["splitStrategy"];
      buildVolumeMm: [number, number, number];
      usableBuildVolumeMm: [number, number, number];
      modelToBedAxes: [PrintBedAxis, PrintBedAxis, PrintBedAxis];
      evaluatedPlanes: number;
      theoreticalBedFit: boolean;
      exceedsSafetyLimit: boolean;
      fittingPartCount: number;
      allPartsFit: boolean;
      volumeBalanceRatio: number;
    };
    filamentEstimate: FilamentUsageEstimate;
    sourceBounds: {
      min: [number, number, number];
      max: [number, number, number];
    };
    connectorPolicy: {
      interfaceCount: number;
      maxPerInterface: number;
      totalBudget: number;
    };
    requestedConnectorCount: number;
    connectors: ModelSplitConnectorReport[];
    skippedConnectorCount: number;
    supportSavingCutCount: number;
    engravedLabels: Array<{ partId: ModelSplitPartId; label: string }>;
    centeredOrigins: true;
  };
  params: ModelSplitterParams;
  totalDurationMs: number;
};

export type ModelSplitterGenerationOptions = MoldGenerationOptions;

export type ModelSplitterErrorCode =
  | "INVALID_PARAMETERS"
  | "INVALID_SOURCE_MESH"
  | "EMPTY_SPLIT_PART"
  | "PART_LIMIT_EXCEEDED"
  | "CONNECTOR_PLACEMENT_FAILED"
  | "TOPOLOGY_INVALID"
  | "CANCELLED"
  | "SPLITTER_KERNEL_FAILED";

export class ModelSplitterError extends Error {
  constructor(
    readonly code: ModelSplitterErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ModelSplitterError";
  }
}

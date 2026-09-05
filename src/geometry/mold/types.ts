import type { Manifold as ManifoldSolid } from "manifold-3d";
import type { MoldMaterialEstimate, TwoPartMoldParams } from "../../domain/mold";
import type { SolidMetrics } from "../kernel/adapter";
import type { TriangleMeshData } from "../../workers/protocol";

export type MoldFeatureName =
  | "source"
  | "seam"
  | "gate"
  | "vent"
  | "registration"
  | "rubber-band-groove"
  | "pry-pocket"
  | "front"
  | "back"
  | "die"
  | "piston"
  | "ejector";

export type MoldGenerationErrorCode =
  | "INVALID_SOURCE_MESH"
  | "INVALID_PARAMETERS"
  | "SEAM_OUTSIDE_MODEL"
  | "GATE_MISSES_MODEL"
  | "FEATURE_COLLISION"
  | "EMPTY_MOLD_HALF"
  | "TOPOLOGY_INVALID"
  | "NO_FLAT_PRINT_FACE"
  | "PRINT_VOLUME_EXCEEDED"
  | "CANCELLED"
  | "MOLD_KERNEL_FAILED";

export class MoldGenerationError extends Error {
  constructor(
    readonly code: MoldGenerationErrorCode,
    message: string,
    readonly feature: MoldFeatureName,
    readonly featureId?: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "MoldGenerationError";
  }
}

export type MoldGateReport = {
  id: string;
  centerXMm: number;
  centerZMm: number;
  surfaceYMm: number;
  diameterMm: number;
  funnelDiameterMm: number;
};

export type MoldVentReport = {
  centerXMm: number;
  centerZMm: number;
  surfaceYMm: number;
  diameterMm: number;
};

export type RegistrationReport = {
  style: "hex";
  count: number;
  widthAcrossFlatsMm: number;
  pocketWidthAcrossFlatsMm: number;
  depthMm: number;
  clearanceMm: number;
};

export type SegmentConnectorReport = {
  style: "hex";
  count: number;
  depthPerInterface: number;
  heightPerInterface: number;
  depthSidesPerInterface: number;
  heightSidesPerInterface: number;
  widthAcrossFlatsMm: number;
  depthMm: number;
  clearanceMm: number;
};

export type MoldFeatureReport = {
  seamXMm: number;
  cavityVolumeMm3: number;
  outerBounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  gates: MoldGateReport[];
  vent: MoldVentReport | null;
  registration: RegistrationReport;
  segmentConnectors: SegmentConnectorReport;
  printVolume: {
    buildVolumeMm: [number, number, number];
    depthSegmentCount: number;
    heightSegmentCount: number;
    fittingPartCount: number;
    allPartsFit: boolean;
  };
  materialEstimate: MoldMaterialEstimate;
  rubberBandGrooves: {
    enabled: boolean;
    count: number;
    depthMm: number;
  };
  pryPockets: {
    enabled: boolean;
    count: number;
    depthMm: number;
  };
  narrowOpenings: {
    enabled: boolean;
    thresholdMm: number;
    removedVolumeMm3: number;
  };
  estimatedMinimumWallMm: number;
  wallSampleCount: number;
};

export type MoldPartMetrics = SolidMetrics & {
  bedTriangles: number;
};

export type MoldPartId = "front" | "back" | `${"front" | "back"}-h${number}-d${number}`;

export type MoldPartResult = {
  id: MoldPartId;
  side: "front" | "back";
  mesh: TriangleMeshData;
  metrics: MoldPartMetrics;
  segmentIndex: number;
  segmentCount: number;
  heightSegmentIndex: number;
  heightSegmentCount: number;
  depthSegmentIndex: number;
  depthSegmentCount: number;
};

export type MoldGenerationResult = {
  kind: "mold";
  front: TriangleMeshData;
  back: TriangleMeshData;
  frontMetrics: MoldPartMetrics;
  backMetrics: MoldPartMetrics;
  parts: MoldPartResult[];
  resolvedPieceCount: number;
  features: MoldFeatureReport;
  params: TwoPartMoldParams;
  totalDurationMs: number;
};

export type MoldProgress = {
  stage:
    | "validating"
    | "shell"
    | "cavity"
    | "channels"
    | "registration"
    | "exterior"
    | "orienting"
    | "complete";
  progress: number;
  message: string;
};

export type MoldGenerationOptions = {
  isCancelled?: () => boolean;
  onProgress?: (progress: MoldProgress) => void;
  preparedSourceFactory?: () => ManifoldSolid;
};

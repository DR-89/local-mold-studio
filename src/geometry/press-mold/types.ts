import type { PressMoldParams } from "../../domain/press-mold";
import type { TriangleMeshData } from "../../workers/protocol";
import type { MoldGenerationOptions, MoldPartMetrics } from "../mold/types";

export type PressMoldResolvedShape = "round" | "rectangular";

export type PressMoldFeatureReport = {
  shapeResolved: PressMoldResolvedShape;
  seamYMm: number;
  autoSeamYMm: number;
  cavityVolumeMm3: number;
  ejectorDiameterMm: number | null;
  guideHeightMm: number;
  guideRails: {
    count: 2;
    widthMm: number;
    depthMm: number;
    clearanceMm: number;
  };
  chamberBounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  outerBounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
};

export type PressMoldGenerationResult = {
  kind: "press-mold";
  die: TriangleMeshData;
  piston: TriangleMeshData;
  dieMetrics: MoldPartMetrics;
  pistonMetrics: MoldPartMetrics;
  features: PressMoldFeatureReport;
  params: PressMoldParams;
  totalDurationMs: number;
};

export type PressMoldGenerationOptions = MoldGenerationOptions;
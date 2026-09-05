export type PressMoldShape = "auto" | "round" | "rectangular";

export type PressMoldParams = {
  shape: PressMoldShape;
  wallMm: number;
  fitClearanceMm: number;
  paddingMm: number;
  seamOffsetMm: number;
  ejectorHole: boolean;
};

export const PRESS_MOLD_LIMITS = {
  wallMm: { min: 1.5, max: 10, step: 0.5 },
  fitClearanceMm: { min: 0.1, max: 1, step: 0.05 },
  paddingMm: { min: 1, max: 20, step: 0.5 },
  seamOffsetMm: { min: -30, max: 30, step: 0.5 },
} as const;

export type PressMoldValidationIssue = {
  field: keyof PressMoldParams;
  code: "OUT_OF_RANGE" | "INVALID_SHAPE";
  message: string;
};

export function createDefaultPressMoldParams(): PressMoldParams {
  return {
    shape: "auto",
    wallMm: 2.5,
    fitClearanceMm: 0.3,
    paddingMm: 4,
    seamOffsetMm: 0,
    ejectorHole: true,
  };
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

export function validatePressMoldParams(
  params: PressMoldParams,
): PressMoldValidationIssue[] {
  const issues: PressMoldValidationIssue[] = [];
  const checks: Array<[
    "wallMm" | "fitClearanceMm" | "paddingMm" | "seamOffsetMm",
    number,
    { min: number; max: number },
  ]> = [
    ["wallMm", params.wallMm, PRESS_MOLD_LIMITS.wallMm],
    ["fitClearanceMm", params.fitClearanceMm, PRESS_MOLD_LIMITS.fitClearanceMm],
    ["paddingMm", params.paddingMm, PRESS_MOLD_LIMITS.paddingMm],
    ["seamOffsetMm", params.seamOffsetMm, PRESS_MOLD_LIMITS.seamOffsetMm],
  ];
  for (const [field, value, range] of checks) {
    if (!inRange(value, range)) {
      issues.push({
        field,
        code: "OUT_OF_RANGE",
        message: `${field} must be between ${range.min} and ${range.max}.`,
      });
    }
  }
  if (!["auto", "round", "rectangular"].includes(params.shape)) {
    issues.push({
      field: "shape",
      code: "INVALID_SHAPE",
      message: "shape must be auto, round or rectangular.",
    });
  }
  return issues;
}
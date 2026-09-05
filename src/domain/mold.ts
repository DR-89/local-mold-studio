export type MoldMaterial = "wax" | "resin" | "soap" | "plaster";
export type UpAxis = "x" | "y" | "z";
export type MoldPieceMode = 2 | 4 | 6 | 8 | "auto";

export type PourGate = {
  id: string;
  diameterMm: number;
  xMm: number;
  zMm: number;
  placement?: "auto" | "manual";
};

export type TwoPartMoldParams = {
  pieceMode: MoldPieceMode;
  splitOversizedByHeight: boolean;
  printBedWidthMm: number;
  printBedDepthMm: number;
  printBedHeightMm: number;
  segmentConnectorWidthMm: number;
  segmentConnectorDepthMm: number;
  scalePercent: number;
  upAxis: UpAxis;
  seamOffsetMm: number;
  wallMm: number;
  wallLoops: number;
  infillPercent: number;
  fitClearanceMm: number;
  pourGates: PourGate[];
  ventDiameterMm: number;
  rubberBandGrooves: boolean;
  pryPockets: boolean;
  closeNarrowOpenings: boolean;
  narrowOpeningThresholdMm: number;
  material: MoldMaterial;
};

export type MaterialPreset = {
  wallMm: number;
  fitClearanceMm: number;
  ventDiameterMm: number;
  pourDiameterMm: number;
  densityGPerMl: number;
};

export type MoldMaterialEstimate = {
  filament: {
    material: "PETG";
    estimatedMassG: number;
    estimatedLengthM: number;
    estimatedExtrudedVolumeMm3: number;
  };
  filling: {
    material: MoldMaterial;
    volumeMl: number;
    densityGPerMl: number;
    estimatedMassG: number;
  };
  assumptions: {
    wallLoops: number;
    wallLineWidthMm: number;
    shellThicknessMm: number;
    infillPercent: number;
    wastePercent: number;
    filamentDiameterMm: number;
    filamentDensityGPerCm3: number;
  };
};

export const MOLD_PRINT_PROFILE = {
  wallLoops: 3,
  wallLineWidthMm: 0.4,
  infillPercent: 15,
  wastePercent: 5,
  filamentDiameterMm: 1.75,
  filamentDensityGPerCm3: 1.27,
} as const;

export function moldHeightExplosionOffsetMm(
  side: "front" | "back",
  segmentIndex: number,
  segmentCount: number,
  assemblyHeightMm: number,
): number {
  if (segmentCount <= 1) return 0;
  const centeredIndex = segmentIndex - (segmentCount - 1) / 2;
  const localToAssemblyDirection = side === "front" ? 1 : -1;
  return (
    centeredIndex *
    (Math.max(1, assemblyHeightMm) / segmentCount) *
    0.8 *
    localToAssemblyDirection
  );
}

export function estimateMoldMaterialUsage(
  parts: ReadonlyArray<{ volumeMm3: number; surfaceAreaMm2: number }>,
  cavityVolumeMm3: number,
  material: MoldMaterial,
  infillPercent = MOLD_PRINT_PROFILE.infillPercent,
  wallLoops = MOLD_PRINT_PROFILE.wallLoops,
): MoldMaterialEstimate {
  const shellThicknessMm =
    wallLoops * MOLD_PRINT_PROFILE.wallLineWidthMm;
  const printedMaterialVolumeMm3 = parts.reduce((sum, part) => {
    const volume = Math.max(0, part.volumeMm3);
    const shellVolume = Math.min(
      volume,
      Math.max(0, part.surfaceAreaMm2) * shellThicknessMm,
    );
    return (
      sum +
      shellVolume +
      (volume - shellVolume) * (infillPercent / 100)
    );
  }, 0);
  const estimatedExtrudedVolumeMm3 =
    printedMaterialVolumeMm3 * (1 + MOLD_PRINT_PROFILE.wastePercent / 100);
  const filamentAreaMm2 =
    Math.PI * (MOLD_PRINT_PROFILE.filamentDiameterMm / 2) ** 2;
  const fillingVolumeMl = Math.max(0, cavityVolumeMm3) / 1000;
  const fillingDensity = MATERIAL_PRESETS[material].densityGPerMl;
  return {
    filament: {
      material: "PETG",
      estimatedMassG:
        (estimatedExtrudedVolumeMm3 / 1000) *
        MOLD_PRINT_PROFILE.filamentDensityGPerCm3,
      estimatedLengthM:
        filamentAreaMm2 > 0
          ? estimatedExtrudedVolumeMm3 / filamentAreaMm2 / 1000
          : 0,
      estimatedExtrudedVolumeMm3,
    },
    filling: {
      material,
      volumeMl: fillingVolumeMl,
      densityGPerMl: fillingDensity,
      estimatedMassG: fillingVolumeMl * fillingDensity,
    },
    assumptions: {
      ...MOLD_PRINT_PROFILE,
      wallLoops,
      infillPercent,
      shellThicknessMm,
    },
  };
}

export const MATERIAL_LABELS: Record<MoldMaterial, string> = {
  wax: "Wax",
  resin: "Resin",
  soap: "Soap",
  plaster: "Plaster",
};

export const MATERIAL_PRESETS: Record<MoldMaterial, MaterialPreset> = {
  wax: {
    wallMm: 5,
    fitClearanceMm: 0.2,
    ventDiameterMm: 0,
    pourDiameterMm: 8,
    densityGPerMl: 0.9,
  },
  resin: {
    wallMm: 4,
    fitClearanceMm: 0.15,
    ventDiameterMm: 3,
    pourDiameterMm: 8,
    densityGPerMl: 1.1,
  },
  soap: {
    wallMm: 4,
    fitClearanceMm: 0.25,
    ventDiameterMm: 0,
    pourDiameterMm: 10,
    densityGPerMl: 1,
  },
  plaster: {
    wallMm: 6,
    fitClearanceMm: 0.3,
    ventDiameterMm: 4,
    pourDiameterMm: 12,
    densityGPerMl: 1.6,
  },
};

export const MOLD_LIMITS = {
  uploadBytes: 100 * 1024 * 1024,
  scalePercent: { min: 1, max: 10_000, step: 1 },
  seamOffsetMm: { min: -30, max: 30, step: 1 },
  wallMm: { min: 3, max: 10, step: 0.5 },
  wallLoops: { min: 1, max: 10, step: 1 },
  infillPercent: { min: 0, max: 100, step: 1 },
  pourDiameterMm: { min: 0, max: 15, step: 0.5 },
  pourCount: { min: 1, max: 4, step: 1 },
  pourOffsetMm: { min: -30, max: 30, step: 1 },
  ventDiameterMm: { min: 0, max: 10, step: 0.5 },
  fitClearanceMm: { min: 0.05, max: 0.6, step: 0.05 },
  narrowOpeningThresholdMm: { min: 0.5, max: 5, step: 0.5 },
  printBedWidthMm: { min: 50, max: 1000, step: 1 },
  printBedDepthMm: { min: 50, max: 1000, step: 1 },
  printBedHeightMm: { min: 50, max: 1000, step: 1 },
  segmentConnectorWidthMm: { min: 1, max: 20, step: 0.5 },
  segmentConnectorDepthMm: { min: 1, max: 20, step: 0.5 },
} as const;

export const H2S_MOLD_BUILD_VOLUME_MM = [340, 320, 340] as const;
export const MAX_MOLD_PARTS = 36;

export type ValidationIssue = {
  field: keyof TwoPartMoldParams | "pourGate";
  code: "OUT_OF_RANGE" | "INVALID_COUNT" | "DUPLICATE_ID";
  message: string;
};

export function createDefaultParams(
  material: MoldMaterial = "wax",
): TwoPartMoldParams {
  const preset = MATERIAL_PRESETS[material];
  return {
    material,
    pieceMode: 2,
    splitOversizedByHeight: true,
    printBedWidthMm: H2S_MOLD_BUILD_VOLUME_MM[0],
    printBedDepthMm: H2S_MOLD_BUILD_VOLUME_MM[1],
    printBedHeightMm: H2S_MOLD_BUILD_VOLUME_MM[2],
    segmentConnectorWidthMm: 2,
    segmentConnectorDepthMm: 4,
    scalePercent: 100,
    upAxis: "y",
    seamOffsetMm: 0,
    wallMm: preset.wallMm,
    wallLoops: MOLD_PRINT_PROFILE.wallLoops,
    infillPercent: MOLD_PRINT_PROFILE.infillPercent,
    fitClearanceMm: preset.fitClearanceMm,
    ventDiameterMm: preset.ventDiameterMm,
    pourGates: [
      {
        id: "gate-1",
        diameterMm: preset.pourDiameterMm,
        xMm: 0,
        zMm: 0,
        placement: "auto",
      },
    ],
    rubberBandGrooves: true,
    pryPockets: true,
    closeNarrowOpenings: false,
    narrowOpeningThresholdMm: 2,
  };
}

export function applyMaterialPreset(
  params: TwoPartMoldParams,
  material: MoldMaterial,
): TwoPartMoldParams {
  const preset = MATERIAL_PRESETS[material];
  return {
    ...params,
    material,
    wallMm: preset.wallMm,
    fitClearanceMm: preset.fitClearanceMm,
    ventDiameterMm: preset.ventDiameterMm,
    pourGates: params.pourGates.map((gate) => ({
      ...gate,
      diameterMm: preset.pourDiameterMm,
    })),
  };
}

export function setPourGateCount(
  params: TwoPartMoldParams,
  requestedCount: number,
): TwoPartMoldParams {
  const count = Math.max(
    MOLD_LIMITS.pourCount.min,
    Math.min(MOLD_LIMITS.pourCount.max, Math.round(requestedCount)),
  );
  const preset = MATERIAL_PRESETS[params.material];
  const next: PourGate[] = [];
  for (let index = 0; index < count; index += 1) {
    const existing = params.pourGates[index];
    const centeredOffset = (index - (count - 1) / 2) * 12;
    next.push({
      id: existing?.id ?? "gate-" + (index + 1),
      diameterMm: existing?.diameterMm ?? preset.pourDiameterMm,
      xMm: centeredOffset,
      zMm: existing?.zMm ?? 0,
      placement: existing?.placement ?? "auto",
    });
  }
  return { ...params, pourGates: next };
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

export function validateMoldParams(
  params: TwoPartMoldParams,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (![2, 4, 6, 8, "auto"].includes(params.pieceMode)) {
    issues.push({
      field: "pieceMode",
      code: "OUT_OF_RANGE",
      message: "pieceMode must be 2, 4, 6, 8, or auto.",
    });
  }
  const checks: Array<
    [keyof TwoPartMoldParams, number, { min: number; max: number }]
  > = [
    ["scalePercent", params.scalePercent, MOLD_LIMITS.scalePercent],
    ["seamOffsetMm", params.seamOffsetMm, MOLD_LIMITS.seamOffsetMm],
    ["wallMm", params.wallMm, MOLD_LIMITS.wallMm],
    ["wallLoops", params.wallLoops, MOLD_LIMITS.wallLoops],
    ["infillPercent", params.infillPercent, MOLD_LIMITS.infillPercent],
    ["fitClearanceMm", params.fitClearanceMm, MOLD_LIMITS.fitClearanceMm],
    ["ventDiameterMm", params.ventDiameterMm, MOLD_LIMITS.ventDiameterMm],
    ["printBedWidthMm", params.printBedWidthMm, MOLD_LIMITS.printBedWidthMm],
    ["printBedDepthMm", params.printBedDepthMm, MOLD_LIMITS.printBedDepthMm],
    ["printBedHeightMm", params.printBedHeightMm, MOLD_LIMITS.printBedHeightMm],
    [
      "segmentConnectorWidthMm",
      params.segmentConnectorWidthMm,
      MOLD_LIMITS.segmentConnectorWidthMm,
    ],
    [
      "segmentConnectorDepthMm",
      params.segmentConnectorDepthMm,
      MOLD_LIMITS.segmentConnectorDepthMm,
    ],
    [
      "narrowOpeningThresholdMm",
      params.narrowOpeningThresholdMm,
      MOLD_LIMITS.narrowOpeningThresholdMm,
    ],
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
  if (!inRange(params.pourGates.length, MOLD_LIMITS.pourCount)) {
    issues.push({
      field: "pourGate",
      code: "INVALID_COUNT",
      message: "One to four pour gates are required.",
    });
  }
  const ids = new Set<string>();
  for (const gate of params.pourGates) {
    if (ids.has(gate.id)) {
      issues.push({
        field: "pourGate",
        code: "DUPLICATE_ID",
        message: `Duplicate pour gate id: ${gate.id}`,
      });
    }
    ids.add(gate.id);
    if (!inRange(gate.diameterMm, MOLD_LIMITS.pourDiameterMm)) {
      issues.push({
        field: "pourGate",
        code: "OUT_OF_RANGE",
        message: `${gate.id} diameter is outside the supported range.`,
      });
    }
    if (
      !inRange(gate.xMm, MOLD_LIMITS.pourOffsetMm) ||
      !inRange(gate.zMm, MOLD_LIMITS.pourOffsetMm)
    ) {
      issues.push({
        field: "pourGate",
        code: "OUT_OF_RANGE",
        message: `${gate.id} position is outside the supported range.`,
      });
    }
  }
  return issues;
}

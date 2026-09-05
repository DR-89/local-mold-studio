export type ModelSplitterStrategy = "smart" | "automatic" | "center" | "manual";
export type ModelSplitterConnectorStyle = "hex" | "pin" | "dovetail";
export type ModelSplitterConnectorPlacement = "automatic" | "manual";
export type ModelSplitterAxis = "x" | "y" | "z";

export type ModelSplitterParams = {
  splitStrategy: ModelSplitterStrategy;
  manualSplitCenterMm: [number, number, number];
  manualSplitPlaneMm: Record<string, number>;
  printBedWidthMm: number;
  printBedDepthMm: number;
  printBedHeightMm: number;
  filamentDiameterMm: number;
  filamentDensityGPerCm3: number;
  infillPercent: number;
  shellThicknessMm: number;
  filamentWastePercent: number;
  connectors: boolean;
  supportSavingCuts: boolean;
  connectorStyle: ModelSplitterConnectorStyle;
  connectorPlacement: ModelSplitterConnectorPlacement;
  manualConnectorPositionPercent: Record<string, [number, number]>;
  connectorDiameterMm: number;
  connectorDepthMm: number;
  connectorClearanceMm: number;
  connectorSpacingMm: number;
  gluePocketMm: number;
  engravedLabels: boolean;
};

export type FilamentEstimateMetrics = {
  volumeMm3: number;
  surfaceAreaMm2: number;
};

export type FilamentUsageEstimate = {
  solidVolumeMm3: number;
  shellVolumeMm3: number;
  estimatedExtrudedVolumeMm3: number;
  estimatedMassG: number;
  estimatedLengthM: number;
  assumptions: {
    filamentDiameterMm: number;
    filamentDensityGPerCm3: number;
    infillPercent: number;
    shellThicknessMm: number;
    filamentWastePercent: number;
    infillPattern: "lightning";
    lightningVolumeFactor: number;
    effectiveInfillPercent: number;
    wallLoops: number;
    wallLineWidthMm: number;
  };
};

export const H2S_BUILD_VOLUME_MM = [340, 320, 340] as const;
export const MODEL_SPLITTER_PLATE_EDGE_MARGIN_MM = 10;
export const MODEL_SPLITTER_MAX_PARTS = 256;
export const MODEL_SPLITTER_MAX_SEGMENTS_PER_AXIS = 8;
export const MODEL_SPLITTER_MAX_CONNECTORS_PER_INTERFACE = 64;
export const MODEL_SPLITTER_MAX_TOTAL_CONNECTORS = 1_200;
export const MODEL_SPLITTER_LIGHTNING_VOLUME_FACTOR = 0.35;
export const MODEL_SPLITTER_WALL_LOOPS = 5;
export const MODEL_SPLITTER_WALL_LINE_WIDTH_MM = 0.4;
export const MODEL_SPLITTER_EFFECTIVE_SHELL_MM =
  MODEL_SPLITTER_WALL_LOOPS * MODEL_SPLITTER_WALL_LINE_WIDTH_MM;

export const MODEL_SPLITTER_LIMITS = {
  manualSplitMm: { min: -1000, max: 1000, step: 0.5 },
  manualConnectorPercent: { min: -75, max: 75, step: 1 },
  printBedWidthMm: { min: 50, max: 1000, step: 1 },
  printBedDepthMm: { min: 50, max: 1000, step: 1 },
  printBedHeightMm: { min: 50, max: 1000, step: 1 },
  filamentDiameterMm: { min: 1, max: 3, step: 0.05 },
  filamentDensityGPerCm3: { min: 0.8, max: 2, step: 0.01 },
  infillPercent: { min: 0, max: 100, step: 5 },
  shellThicknessMm: { min: 0.4, max: 4, step: 0.1 },
  filamentWastePercent: { min: 0, max: 30, step: 1 },
  connectorDiameterMm: { min: 1, max: 120, step: 0.5 },
  connectorDepthMm: { min: 1, max: 80, step: 0.5 },
  connectorClearanceMm: { min: 0.1, max: 1.5, step: 0.05 },
  connectorSpacingMm: { min: 20, max: 120, step: 5 },
  gluePocketMm: { min: 0, max: 3, step: 0.1 },
} as const;

export type ModelSplitterValidationIssue = {
  field: keyof ModelSplitterParams;
  code: "OUT_OF_RANGE" | "INVALID_OPTION";
  message: string;
};

export function expectedConnectorCount(grid: readonly number[]): number {
  const [nx = 1, ny = 1, nz = 1] = grid;
  return Math.max(0, nx - 1) * ny * nz +
    nx * Math.max(0, ny - 1) * nz +
    nx * ny * Math.max(0, nz - 1);
}

export function modelSplitterConnectorPolicy(
  grid: readonly number[],
  occupiedInterfaceCount?: number,
): {
  interfaceCount: number;
  maxPerInterface: number;
  totalBudget: number;
} {
  const interfaceCount = occupiedInterfaceCount ?? expectedConnectorCount(grid);
  return {
    interfaceCount,
    maxPerInterface: interfaceCount === 0
      ? 0
      : Math.max(1, Math.min(
          MODEL_SPLITTER_MAX_CONNECTORS_PER_INTERFACE,
          Math.floor(MODEL_SPLITTER_MAX_TOTAL_CONNECTORS / interfaceCount),
        )),
    totalBudget: MODEL_SPLITTER_MAX_TOTAL_CONNECTORS,
  };
}

export function createDefaultModelSplitterParams(): ModelSplitterParams {
  return {
    splitStrategy: "automatic",
    manualSplitCenterMm: [0, 0, 0],
    manualSplitPlaneMm: {},
    printBedWidthMm: H2S_BUILD_VOLUME_MM[0],
    printBedDepthMm: H2S_BUILD_VOLUME_MM[1],
    printBedHeightMm: H2S_BUILD_VOLUME_MM[2],
    filamentDiameterMm: 1.75,
    filamentDensityGPerCm3: 1.24,
    infillPercent: 15,
    shellThicknessMm: MODEL_SPLITTER_EFFECTIVE_SHELL_MM,
    filamentWastePercent: 5,
    connectors: true,
    supportSavingCuts: false,
    connectorStyle: "hex",
    connectorPlacement: "automatic",
    manualConnectorPositionPercent: {},
    connectorDiameterMm: 6,
    connectorDepthMm: 4,
    connectorClearanceMm: 0.2,
    connectorSpacingMm: 45,
    gluePocketMm: 0.2,
    engravedLabels: false,
  };
}

export function estimateFilamentUsage(parts: readonly FilamentEstimateMetrics[], params: ModelSplitterParams): FilamentUsageEstimate {
  let solidVolumeMm3 = 0;
  let shellVolumeMm3 = 0;
  let materialVolumeMm3 = 0;
  for (const part of parts) {
    const volume = Math.max(0, part.volumeMm3);
    const shell = Math.min(
      volume,
      Math.max(0, part.surfaceAreaMm2) * MODEL_SPLITTER_EFFECTIVE_SHELL_MM,
    );
    solidVolumeMm3 += volume;
    shellVolumeMm3 += shell;
    materialVolumeMm3 += shell +
      (volume - shell) * (params.infillPercent / 100) * MODEL_SPLITTER_LIGHTNING_VOLUME_FACTOR;
  }
  const estimatedExtrudedVolumeMm3 = materialVolumeMm3 * (1 + params.filamentWastePercent / 100);
  const filamentAreaMm2 = Math.PI * (params.filamentDiameterMm / 2) ** 2;
  return {
    solidVolumeMm3,
    shellVolumeMm3,
    estimatedExtrudedVolumeMm3,
    estimatedMassG: (estimatedExtrudedVolumeMm3 / 1000) * params.filamentDensityGPerCm3,
    estimatedLengthM: filamentAreaMm2 > 0 ? estimatedExtrudedVolumeMm3 / filamentAreaMm2 / 1000 : 0,
    assumptions: {
      infillPattern: "lightning",
      lightningVolumeFactor: MODEL_SPLITTER_LIGHTNING_VOLUME_FACTOR,
      effectiveInfillPercent: params.infillPercent * MODEL_SPLITTER_LIGHTNING_VOLUME_FACTOR,
      filamentDiameterMm: params.filamentDiameterMm,
      filamentDensityGPerCm3: params.filamentDensityGPerCm3,
      infillPercent: params.infillPercent,
      shellThicknessMm: MODEL_SPLITTER_EFFECTIVE_SHELL_MM,
      wallLoops: MODEL_SPLITTER_WALL_LOOPS,
      wallLineWidthMm: MODEL_SPLITTER_WALL_LINE_WIDTH_MM,
      filamentWastePercent: params.filamentWastePercent,
    },
  };
}

export function validateModelSplitterParams(params: ModelSplitterParams): ModelSplitterValidationIssue[] {
  const issues: ModelSplitterValidationIssue[] = [];
  if (!["smart", "automatic", "center", "manual"].includes(params.splitStrategy)) {
    issues.push({ field: "splitStrategy", code: "INVALID_OPTION", message: "splitStrategy must be smart, automatic, center, or manual." });
  }
  if (!["hex", "pin", "dovetail"].includes(params.connectorStyle)) {
    issues.push({ field: "connectorStyle", code: "INVALID_OPTION", message: "connectorStyle must be hex, pin, or dovetail." });
  }
  if (!["automatic", "manual"].includes(params.connectorPlacement)) {
    issues.push({ field: "connectorPlacement", code: "INVALID_OPTION", message: "connectorPlacement must be automatic or manual." });
  }
  if (!Array.isArray(params.manualSplitCenterMm) || params.manualSplitCenterMm.length !== 3 ||
      params.manualSplitCenterMm.some((value) => !Number.isFinite(value) || value < MODEL_SPLITTER_LIMITS.manualSplitMm.min || value > MODEL_SPLITTER_LIMITS.manualSplitMm.max)) {
    issues.push({ field: "manualSplitCenterMm", code: "OUT_OF_RANGE", message: "Manual cut planes must be between -1000 and 1000 mm." });
  }
  for (const [id, value] of Object.entries(params.manualSplitPlaneMm)) {
    if (!Number.isFinite(value) || value < MODEL_SPLITTER_LIMITS.manualSplitMm.min || value > MODEL_SPLITTER_LIMITS.manualSplitMm.max) {
      issues.push({ field: "manualSplitPlaneMm", code: "OUT_OF_RANGE", message: `Manual cut plane ${id} must be between -1000 and 1000 mm.` });
    }
  }
  const checks: Array<[keyof ModelSplitterParams, number, { min: number; max: number }]> = [
    ["printBedWidthMm", params.printBedWidthMm, MODEL_SPLITTER_LIMITS.printBedWidthMm],
    ["printBedDepthMm", params.printBedDepthMm, MODEL_SPLITTER_LIMITS.printBedDepthMm],
    ["printBedHeightMm", params.printBedHeightMm, MODEL_SPLITTER_LIMITS.printBedHeightMm],
    ["filamentDiameterMm", params.filamentDiameterMm, MODEL_SPLITTER_LIMITS.filamentDiameterMm],
    ["filamentDensityGPerCm3", params.filamentDensityGPerCm3, MODEL_SPLITTER_LIMITS.filamentDensityGPerCm3],
    ["infillPercent", params.infillPercent, MODEL_SPLITTER_LIMITS.infillPercent],
    ["shellThicknessMm", params.shellThicknessMm, MODEL_SPLITTER_LIMITS.shellThicknessMm],
    ["filamentWastePercent", params.filamentWastePercent, MODEL_SPLITTER_LIMITS.filamentWastePercent],
    ["connectorDiameterMm", params.connectorDiameterMm, MODEL_SPLITTER_LIMITS.connectorDiameterMm],
    ["connectorDepthMm", params.connectorDepthMm, MODEL_SPLITTER_LIMITS.connectorDepthMm],
    ["connectorClearanceMm", params.connectorClearanceMm, MODEL_SPLITTER_LIMITS.connectorClearanceMm],
    ["connectorSpacingMm", params.connectorSpacingMm, MODEL_SPLITTER_LIMITS.connectorSpacingMm],
    ["gluePocketMm", params.gluePocketMm, MODEL_SPLITTER_LIMITS.gluePocketMm],
  ];
  for (const [field, value, range] of checks) {
    if (!Number.isFinite(value) || value < range.min || value > range.max) {
      issues.push({ field, code: "OUT_OF_RANGE", message: `${field} must be between ${range.min} and ${range.max}.` });
    }
  }
  return issues;
}
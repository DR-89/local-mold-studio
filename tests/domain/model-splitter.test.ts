import { describe, expect, it } from "vitest";
import {
  MODEL_SPLITTER_MAX_PARTS,
  MODEL_SPLITTER_EFFECTIVE_SHELL_MM,
  MODEL_SPLITTER_WALL_LINE_WIDTH_MM,
  MODEL_SPLITTER_WALL_LOOPS,
  createDefaultModelSplitterParams,
  estimateFilamentUsage,
  expectedConnectorCount,
  modelSplitterConnectorPolicy,
  validateModelSplitterParams,
} from "../../src/domain/model-splitter";
import {
  MODEL_SPLITTER_MAX_BUILD_VOLUME_OCCUPANCY,
  planSplitGrid,
} from "../../src/geometry/model-splitter/planner";

describe("model splitter parameters", () => {
  it("defaults to automatic print-bed planning and hex connectors", () => {
    const params = createDefaultModelSplitterParams();
    expect(params.connectorStyle).toBe("hex");
    expect(params.engravedLabels).toBe(false);
    expect(params.supportSavingCuts).toBe(false);
    expect(params.connectorSpacingMm).toBe(45);
    expect(params.printBedWidthMm).toBe(340);
    expect(params.shellThicknessMm).toBe(MODEL_SPLITTER_EFFECTIVE_SHELL_MM);
    expect(validateModelSplitterParams(params)).toEqual([]);
    params.connectorDiameterMm = 1;
    params.connectorDepthMm = 80;
    expect(validateModelSplitterParams(params)).toEqual([]);
    params.connectorDiameterMm = 120;
    expect(validateModelSplitterParams(params)).toEqual([]);
    params.connectorDiameterMm = 120.5;
    expect(validateModelSplitterParams(params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "connectorDiameterMm" }),
      ]),
    );
  });

  it("estimates material with a Lightning-infill interior heuristic", () => {
    const params = createDefaultModelSplitterParams();
    params.infillPercent = 20;
    params.shellThicknessMm = 1;
    params.filamentWastePercent = 0;
    const estimate = estimateFilamentUsage(
      [{ volumeMm3: 1000, surfaceAreaMm2: 100 }],
      params,
    );
    expect(estimate.shellVolumeMm3).toBe(200);
    expect(estimate.estimatedExtrudedVolumeMm3).toBeCloseTo(256, 6);
    expect(estimate.assumptions).toMatchObject({
      infillPattern: "lightning",
      lightningVolumeFactor: 0.35,
      infillPercent: 20,
      effectiveInfillPercent: 7,
      wallLoops: MODEL_SPLITTER_WALL_LOOPS,
      wallLineWidthMm: MODEL_SPLITTER_WALL_LINE_WIDTH_MM,
      shellThicknessMm: MODEL_SPLITTER_EFFECTIVE_SHELL_MM,
    });
  });
  it("chooses the smallest grid across all bed-axis mappings", () => {
    const params = createDefaultModelSplitterParams();
    params.printBedWidthMm = 70;
    params.printBedDepthMm = 70;
    params.printBedHeightMm = 70;
    const plan = planSplitGrid(
      {
        min: [0, 0, 0],
        max: [120, 120, 120],
        size: [120, 120, 120],
      },
      params,
    );
    expect(plan.gridCounts).toEqual([3, 3, 3]);
    expect(plan.partCount).toBe(27);
    expect(plan.planes).toHaveLength(6);
    expect(plan.exceedsSafetyLimit).toBe(false);
    expect(expectedConnectorCount(plan.gridCounts)).toBe(54);
  });

  it("splits every axis segment that would exceed 85 percent of the build volume", () => {
    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.printBedWidthMm = 100;
    params.printBedDepthMm = 100;
    params.printBedHeightMm = 100;
    const plan = planSplitGrid(
      {
        min: [0, 0, 0],
        max: [86, 85, 40],
        size: [86, 85, 40],
      },
      params,
    );

    expect(MODEL_SPLITTER_MAX_BUILD_VOLUME_OCCUPANCY).toBe(0.85);
    expect(plan.usableBuildVolumeMm).toEqual([85, 85, 85]);
    expect(plan.gridCounts).toEqual([2, 1, 1]);
    expect(plan.planes).toHaveLength(1);
  });
  it("clamps manual planes so no segment exceeds the 85-percent limit", () => {
    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.splitStrategy = "manual";
    params.printBedWidthMm = 100;
    params.printBedDepthMm = 100;
    params.printBedHeightMm = 100;
    params.manualSplitPlaneMm["x-1"] = 40;
    const plan = planSplitGrid(
      {
        min: [-80, -20, -20],
        max: [80, 20, 20],
        size: [160, 40, 40],
      },
      params,
    );

    expect(plan.gridCounts).toEqual([2, 1, 1]);
    expect(plan.planes[0]?.positionMm).toBe(5);
    expect(plan.planes[0]!.positionMm - -80).toBe(85);
    expect(80 - plan.planes[0]!.positionMm).toBeLessThanOrEqual(85);
  });
  it("allows a 5 x 6 x 6 large job and adapts connector density", () => {
    const params = createDefaultModelSplitterParams();
    params.printBedWidthMm = 50;
    params.printBedDepthMm = 50;
    params.printBedHeightMm = 50;
    const plan = planSplitGrid(
      {
        min: [0, 0, 0],
        max: [200, 240, 240],
        size: [200, 240, 240],
      },
      params,
    );
    expect(plan.gridCounts).toEqual([5, 6, 6]);
    expect(plan.partCount).toBe(180);
    expect(plan.exceedsSafetyLimit).toBe(false);
    expect(modelSplitterConnectorPolicy(plan.gridCounts)).toEqual({
      interfaceCount: 444,
      maxPerInterface: 2,
      totalBudget: 1_200,
    });
  });

  it("validates connector spacing and reports the browser safety limit", () => {
    const params = createDefaultModelSplitterParams();
    params.connectorSpacingMm = 5;
    expect(validateModelSplitterParams(params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "connectorSpacingMm" }),
      ]),
    );
    params.connectorSpacingMm = 45;
    params.printBedWidthMm = 50;
    params.printBedDepthMm = 50;
    params.printBedHeightMm = 50;
    const plan = planSplitGrid(
      {
        min: [0, 0, 0],
        max: [500, 500, 500],
        size: [500, 500, 500],
      },
      params,
    );
    expect(plan.partCount).toBeGreaterThan(MODEL_SPLITTER_MAX_PARTS);
    expect(plan.exceedsSafetyLimit).toBe(true);
  });
});

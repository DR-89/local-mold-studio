import { describe, expect, it } from "vitest";
import {
  MATERIAL_PRESETS,
  MOLD_LIMITS,
  applyMaterialPreset,
  createDefaultParams,
  estimateMoldMaterialUsage,
  moldHeightExplosionOffsetMm,
  setPourGateCount,
  validateMoldParams,
} from "../../src/domain/mold";

describe("two-part mold parameter contract", () => {
  it("maps mirrored front and back height rows to matching assembly explosion heights", () => {
    const frontOffsets = [0, 1, 2].map((index) =>
      moldHeightExplosionOffsetMm("front", index, 3, 700),
    );
    const backOffsets = [0, 1, 2].map((index) =>
      moldHeightExplosionOffsetMm("back", index, 3, 700),
    );
    expect(frontOffsets[0]).toBeCloseTo(backOffsets[2]!, 10);
    expect(frontOffsets[1]).toBeCloseTo(backOffsets[1]!, 10);
    expect(frontOffsets[2]).toBeCloseTo(backOffsets[0]!, 10);
    expect(frontOffsets[0]).toBeLessThan(0);
    expect(frontOffsets[2]).toBeGreaterThan(0);
  });

  it("estimates filament and filling material from one shared print profile", () => {
    const estimate = estimateMoldMaterialUsage(
      [{ volumeMm3: 1000, surfaceAreaMm2: 100 }],
      1000,
      "wax",
    );
    expect(estimate.assumptions).toMatchObject({
      wallLoops: 3,
      wallLineWidthMm: 0.4,
      infillPercent: 15,
      wastePercent: 5,
    });
    expect(estimate.assumptions.shellThicknessMm).toBeCloseTo(1.2, 10);
    expect(estimate.filament.estimatedExtrudedVolumeMm3).toBeCloseTo(264.6, 6);
    expect(estimate.filament.estimatedMassG).toBeCloseTo(0.336042, 6);
    expect(estimate.filling).toMatchObject({
      material: "wax",
      volumeMl: 1,
      densityGPerMl: 0.9,
      estimatedMassG: 0.9,
    });
  });
  it("uses the selected boxmold infill density in the filament estimate", () => {
    const low = estimateMoldMaterialUsage(
      [{ volumeMm3: 1000, surfaceAreaMm2: 100 }],
      1000,
      "wax",
      10,
    );
    const high = estimateMoldMaterialUsage(
      [{ volumeMm3: 1000, surfaceAreaMm2: 100 }],
      1000,
      "wax",
      30,
    );
    expect(low.assumptions.infillPercent).toBe(10);
    expect(high.assumptions.infillPercent).toBe(30);
    expect(high.filament.estimatedMassG).toBeGreaterThan(
      low.filament.estimatedMassG,
    );
  });
  it("uses the selected wall count for shell thickness and filament mass", () => {
    const threeWalls = estimateMoldMaterialUsage(
      [{ volumeMm3: 10_000, surfaceAreaMm2: 1000 }],
      1000,
      "wax",
      15,
      3,
    );
    const sixWalls = estimateMoldMaterialUsage(
      [{ volumeMm3: 10_000, surfaceAreaMm2: 1000 }],
      1000,
      "wax",
      15,
      6,
    );
    expect(threeWalls.assumptions.shellThicknessMm).toBeCloseTo(1.2, 10);
    expect(sixWalls.assumptions.shellThicknessMm).toBeCloseTo(2.4, 10);
    expect(sixWalls.assumptions.wallLoops).toBe(6);
    expect(sixWalls.filament.estimatedMassG).toBeGreaterThan(
      threeWalls.filament.estimatedMassG,
    );
  });
  it("locks the audited MVP ranges and all material presets", () => {
    expect(MOLD_LIMITS).toMatchObject({
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
    });
    expect(MATERIAL_PRESETS).toEqual({
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
    });
  });

  it("starts with the audited wax defaults", () => {
    const params = createDefaultParams("wax");
    expect(params.wallMm).toBe(5);
    expect(params.wallLoops).toBe(3);
    expect(params.infillPercent).toBe(15);
    expect(params.fitClearanceMm).toBe(0.2);
    expect(params.ventDiameterMm).toBe(0);
    expect(params.closeNarrowOpenings).toBe(false);
    expect(params.narrowOpeningThresholdMm).toBe(2);
    expect(params.pourGates).toHaveLength(1);
    expect(params.pourGates[0]?.diameterMm).toBe(8);
    expect(validateMoldParams(params)).toEqual([]);
  });

  it.each(["wax", "resin", "soap", "plaster"] as const)(
    "applies the %s material preset without changing orientation",
    (material) => {
      const original = { ...createDefaultParams(), upAxis: "z" as const };
      const next = applyMaterialPreset(original, material);
      const preset = MATERIAL_PRESETS[material];
      expect(next.upAxis).toBe("z");
      expect(next.wallMm).toBe(preset.wallMm);
      expect(next.fitClearanceMm).toBe(preset.fitClearanceMm);
      expect(next.ventDiameterMm).toBe(preset.ventDiameterMm);
      expect(next.pourGates[0]?.diameterMm).toBe(preset.pourDiameterMm);
    },
  );

  it("creates stable, unique gates and clamps their count", () => {
    const four = setPourGateCount(createDefaultParams(), 4);
    expect(four.pourGates.map((gate) => gate.id)).toEqual([
      "gate-1",
      "gate-2",
      "gate-3",
      "gate-4",
    ]);
    expect(four.pourGates.map((gate) => gate.xMm)).toEqual([-18, -6, 6, 18]);
    expect(setPourGateCount(four, 99).pourGates).toHaveLength(4);
    expect(setPourGateCount(four, 0).pourGates).toHaveLength(1);
  });

  it("accepts one-percent models and rejects values below one percent", () => {
    const minimum = createDefaultParams();
    minimum.scalePercent = 1;
    expect(validateMoldParams(minimum)).toEqual([]);

    const large = createDefaultParams();
    large.scalePercent = 10_000;
    expect(validateMoldParams(large)).toEqual([]);

    minimum.scalePercent = 0.99;
    expect(validateMoldParams(minimum)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "scalePercent",
          code: "OUT_OF_RANGE",
        }),
      ]),
    );
  });

  it("validates the optional narrow-opening threshold", () => {
    const params = createDefaultParams();
    params.closeNarrowOpenings = true;
    params.narrowOpeningThresholdMm = 0.5;
    expect(validateMoldParams(params)).toEqual([]);

    params.narrowOpeningThresholdMm = 5.1;
    expect(validateMoldParams(params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "narrowOpeningThresholdMm",
          code: "OUT_OF_RANGE",
        }),
      ]),
    );
  });
  it("limits mold splits to 2, 4, 6, 8, or automatic selection", () => {
    const params = createDefaultParams();
    expect(params.pieceMode).toBe(2);
    expect(params.splitOversizedByHeight).toBe(true);
    expect([
      params.printBedWidthMm,
      params.printBedDepthMm,
      params.printBedHeightMm,
    ]).toEqual([340, 320, 340]);
    expect(params.segmentConnectorWidthMm).toBe(2);
    expect(params.segmentConnectorDepthMm).toBe(4);
    for (const pieceMode of [2, 4, 6, 8, "auto"] as const) {
      expect(validateMoldParams({ ...params, pieceMode })).toEqual([]);
    }
    expect(validateMoldParams({ ...params, pieceMode: 10 as 8 })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "pieceMode" })]),
    );
  });
  it("returns structured validation issues", () => {
    const params = createDefaultParams();
    params.wallMm = 1;
    params.wallLoops = 0;
    params.infillPercent = 101;
    params.pourGates = [];
    expect(validateMoldParams(params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "wallMm", code: "OUT_OF_RANGE" }),
        expect.objectContaining({ field: "wallLoops", code: "OUT_OF_RANGE" }),
        expect.objectContaining({ field: "infillPercent", code: "OUT_OF_RANGE" }),
        expect.objectContaining({ field: "pourGate", code: "INVALID_COUNT" }),
      ]),
    );
  });
});

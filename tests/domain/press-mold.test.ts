import { describe, expect, it } from "vitest";
import { createDefaultPressMoldParams, validatePressMoldParams } from "../../src/domain/press-mold";

describe("press mold parameters", () => {
  it("provides valid reference-aligned defaults", () => {
    const params = createDefaultPressMoldParams();
    expect(params).toMatchObject({
      shape: "auto",
      wallMm: 2.5,
      fitClearanceMm: 0.3,
      paddingMm: 4,
      seamOffsetMm: 0,
      ejectorHole: true,
    });
    expect(validatePressMoldParams(params)).toEqual([]);
  });

  it("reports unsafe numeric values", () => {
    const params = createDefaultPressMoldParams();
    params.fitClearanceMm = 2;
    expect(validatePressMoldParams(params)).toContainEqual(
      expect.objectContaining({ field: "fitClearanceMm", code: "OUT_OF_RANGE" }),
    );
  });
});
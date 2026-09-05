import { describe, expect, it } from "vitest";
import { fabricationErrorHint } from "../../src/domain/error-guidance";

describe("fabrication error guidance", () => {
  it("explains how to correct an unanchored inner depth connector", () => {
    const hint = fabricationErrorHint({
      code: "FEATURE_COLLISION",
      message:
        "The inner depth connector 5 cannot be fully anchored in both neighboring mold segments (0% root coverage).",
      detail: "registration: depth-interface-1-inner-5",
    });

    expect(hint).toContain("2 parts or Auto");
    expect(hint).toContain("print-bed depth");
    expect(hint).toContain("connector width");
    expect(hint).toContain("wall thickness");
  });

  it("provides targeted guidance for print volume and source topology", () => {
    expect(
      fabricationErrorHint({ code: "PRINT_VOLUME_EXCEEDED", message: "Too large" }),
    ).toContain("Auto pieces");
    expect(
      fabricationErrorHint({ code: "INVALID_SOURCE_MESH", message: "Invalid mesh" }),
    ).toContain("closed manifold mesh");
  });

  it("explains how to free a pour channel from seam connectors", () => {
    const hint = fabricationErrorHint({
      code: "FEATURE_COLLISION",
      message:
        "A seam connector cannot be placed clear of the pour channel or cavity.",
    });

    expect(hint).toContain("Move or redistribute");
    expect(hint).toContain("reduce its diameter");
    expect(hint).toContain("connector width");
  });
});

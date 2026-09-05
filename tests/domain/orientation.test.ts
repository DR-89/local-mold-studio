import { describe, expect, it } from "vitest";
import { chooseAutoUpAxis } from "../../src/domain/orientation";

describe("chooseAutoUpAxis", () => {
  it("chooses the thinnest source axis as up", () => {
    expect(chooseAutoUpAxis([40, 10, 30], "y")).toBe("y");
    expect(chooseAutoUpAxis([10, 40, 30], "x")).toBe("y");
    expect(chooseAutoUpAxis([40, 10, 30], "z")).toBe("z");
  });

  it("uses the first axis deterministically for a cube", () => {
    expect(chooseAutoUpAxis([20, 20, 20], "y")).toBe("x");
  });
});
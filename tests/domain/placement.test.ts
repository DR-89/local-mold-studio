import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_PLACEMENT,
  meshBounds,
  placeMeshOnPlate,
} from "../../src/domain/placement";
import { indexedCube } from "../../src/testing/fixtures";

describe("model placement", () => {
  it("centers an offset model on the plate without mutating the source", () => {
    const source = indexedCube(20);
    const positions = source.positions.slice();
    for (let offset = 0; offset < positions.length; offset += 3) {
      positions[offset] += 140;
      positions[offset + 1] += 60;
      positions[offset + 2] -= 35;
    }
    const original = positions.slice();
    const placed = placeMeshOnPlate(
      { positions, indices: source.indices },
      DEFAULT_MODEL_PLACEMENT,
    );

    expect(meshBounds(placed)).toEqual({
      min: [-10, 0, -10],
      max: [10, 20, 10],
      size: [20, 20, 20],
    });
    expect(positions).toEqual(original);
  });

  it("rotates around the model center and applies plate coordinates", () => {
    const source = indexedCube(20);
    const stretched = source.positions.slice();
    for (let offset = 0; offset < stretched.length; offset += 3) {
      stretched[offset + 1] *= 2;
      stretched[offset + 2] *= 3;
    }
    const placed = placeMeshOnPlate(
      { positions: stretched, indices: source.indices },
      {
        positionMm: [12, 4, -7],
        rotationDeg: [90, 0, 0],
      },
    );
    const bounds = meshBounds(placed);

    expect(bounds.min[0]).toBeCloseTo(2, 5);
    expect(bounds.max[0]).toBeCloseTo(22, 5);
    expect(bounds.min[1]).toBeCloseTo(4, 5);
    expect(bounds.max[1]).toBeCloseTo(64, 5);
    expect(bounds.min[2]).toBeCloseTo(-27, 5);
    expect(bounds.max[2]).toBeCloseTo(13, 5);
    expect(placed.indices).toBe(source.indices);
  });
});

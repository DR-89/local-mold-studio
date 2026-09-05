import { describe, expect, it } from "vitest";
import type { PourGate } from "../../src/domain/mold";
import {
  calculateMeshBounds,
  placePourGates,
} from "../../src/geometry/mold/placement";
import type { TriangleMeshData } from "../../src/workers/protocol";

function threeSeparatedPeaks(): TriangleMeshData {
  return {
    positions: new Float32Array([
      -20, 30, 0,
      -25, 0, -5,
      -15, 0, -5,
      0, 25, 0,
      -5, 0, -5,
      5, 0, -5,
      20, 20, 0,
      15, 0, -5,
      25, 0, -5,
    ]),
    indices: new Uint32Array([
      0, 1, 2,
      3, 4, 5,
      6, 7, 8,
    ]),
  };
}

describe("mold feature placement", () => {
  it("covers distant high tips before a nearer central tip", () => {
    const mesh = threeSeparatedPeaks();
    const gates: PourGate[] = [1, 2, 3].map((index) => ({
      id: "gate-" + index,
      diameterMm: 4,
      xMm: 0,
      zMm: 0,
      placement: "auto",
    }));

    const placed = placePourGates(mesh, gates, calculateMeshBounds(mesh));

    expect(placed.map((gate) => gate.centerXMm)).toEqual([-20, 20, 0]);
    expect(placed.map((gate) => gate.centerZMm)).toEqual([0, 0, 0]);
    expect(placed.map((gate) => gate.surfaceYMm)).toEqual([30, 20, 25]);
  });

  it("keeps explicit offsets as manual placement", () => {
    const mesh = threeSeparatedPeaks();
    const manual: PourGate = {
      id: "manual",
      diameterMm: 4,
      xMm: 20,
      zMm: 0,
      placement: "manual",
    };

    const [placed] = placePourGates(
      mesh,
      [manual],
      calculateMeshBounds(mesh),
    );

    expect(placed.centerXMm).toBe(20);
    expect(placed.surfaceYMm).toBeGreaterThan(0);
  });
});
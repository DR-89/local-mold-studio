import type { UpAxis } from "./mold";

type Size3 = readonly [number, number, number];

const NORMALIZED_AXIS_TO_SOURCE: Record<UpAxis, readonly UpAxis[]> = {
  x: ["y", "x", "z"],
  y: ["x", "y", "z"],
  z: ["x", "z", "y"],
};

export function chooseAutoUpAxis(
  normalizedSize: Size3,
  currentUpAxis: UpAxis,
): UpAxis {
  let smallestIndex = 0;
  for (let index = 1; index < normalizedSize.length; index += 1) {
    if (normalizedSize[index] < normalizedSize[smallestIndex]) {
      smallestIndex = index;
    }
  }
  return NORMALIZED_AXIS_TO_SOURCE[currentUpAxis][smallestIndex];
}
const vertices: ReadonlyArray<readonly [number, number, number]> = [
  [-10, -10, -10],
  [10, -10, -10],
  [10, 10, -10],
  [-10, 10, -10],
  [-10, -10, 10],
  [10, -10, 10],
  [10, 10, 10],
  [-10, 10, 10],
];

const triangles: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [3, 7, 6],
  [3, 6, 2],
  [0, 4, 7],
  [0, 7, 3],
  [1, 2, 6],
  [1, 6, 5],
];

export function offlineCubeAsciiStl(): ArrayBuffer {
  const lines = ["solid local-mold-offline-fixture"];
  for (const triangle of triangles) {
    lines.push("facet normal 0 0 0", "outer loop");
    for (const index of triangle) {
      lines.push("vertex " + vertices[index].join(" "));
    }
    lines.push("endloop", "endfacet");
  }
  lines.push("endsolid local-mold-offline-fixture");
  return new TextEncoder().encode(lines.join("\n")).buffer;
}

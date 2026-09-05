type Vec3 = readonly [number, number, number];

function add(a: Vec3, b: Vec3, scale = 1): Vec3 {
  return [
    a[0] + b[0] * scale,
    a[1] + b[1] * scale,
    a[2] + b[2] * scale,
  ];
}

export function subdividedCubeBinaryStl(subdivisions: number): Buffer {
  const triangles = 12 * subdivisions * subdivisions;
  const buffer = Buffer.allocUnsafe(84 + triangles * 50);
  buffer.fill(0, 0, 80);
  buffer.writeUInt32LE(triangles, 80);
  const step = 20 / subdivisions;
  const faces: Array<{ origin: Vec3; u: Vec3; v: Vec3; normal: Vec3 }> = [
    { origin: [10, -10, -10], u: [0, step, 0], v: [0, 0, step], normal: [1, 0, 0] },
    { origin: [-10, -10, -10], u: [0, 0, step], v: [0, step, 0], normal: [-1, 0, 0] },
    { origin: [-10, 10, -10], u: [0, 0, step], v: [step, 0, 0], normal: [0, 1, 0] },
    { origin: [-10, -10, -10], u: [step, 0, 0], v: [0, 0, step], normal: [0, -1, 0] },
    { origin: [-10, -10, 10], u: [step, 0, 0], v: [0, step, 0], normal: [0, 0, 1] },
    { origin: [-10, -10, -10], u: [0, step, 0], v: [step, 0, 0], normal: [0, 0, -1] },
  ];
  let offset = 84;
  const writeTriangle = (normal: Vec3, a: Vec3, b: Vec3, c: Vec3) => {
    for (const value of normal) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
    for (const point of [a, b, c]) {
      for (const value of point) {
        buffer.writeFloatLE(value, offset);
        offset += 4;
      }
    }
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  };
  for (const face of faces) {
    for (let row = 0; row < subdivisions; row += 1) {
      for (let column = 0; column < subdivisions; column += 1) {
        const p00 = add(add(face.origin, face.u, row), face.v, column);
        const p10 = add(p00, face.u);
        const p01 = add(p00, face.v);
        const p11 = add(p10, face.v);
        writeTriangle(face.normal, p00, p10, p11);
        writeTriangle(face.normal, p00, p11, p01);
      }
    }
  }
  return buffer;
}
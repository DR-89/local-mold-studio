import type { Manifold as ManifoldSolid, ManifoldToplevel } from "manifold-3d";
import { validatePressMoldParams, type PressMoldParams } from "../../domain/press-mold";
import type { TriangleMeshData } from "../../workers/protocol";
import { manifoldToTriangleMesh, measureSolid, triangleMeshToManifold } from "../kernel/adapter";
import { loadManifold } from "../kernel/loader";
import { calculateMeshBounds } from "../mold/placement";
import { MoldGenerationError, type MoldPartMetrics } from "../mold/types";
import type { PressMoldGenerationOptions, PressMoldGenerationResult, PressMoldResolvedShape } from "./types";

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function makeBox(kernel: ManifoldToplevel, min: [number, number, number], max: [number, number, number]): ManifoldSolid {
  const primitive = kernel.Manifold.cube([max[0] - min[0], max[1] - min[1], max[2] - min[2]]);
  const result = primitive.translate(min);
  primitive.delete();
  return result;
}

function makeCylinderY(kernel: ManifoldToplevel, height: number, radius: number, center: [number, number, number]): ManifoldSolid {
  const primitive = kernel.Manifold.cylinder(height, radius, radius, 64, true);
  const rotated = primitive.rotate([-90, 0, 0]);
  primitive.delete();
  const result = rotated.translate(center);
  rotated.delete();
  return result;
}

function addOwned(a: ManifoldSolid, b: ManifoldSolid): ManifoldSolid {
  const result = a.add(b);
  a.delete();
  b.delete();
  return result;
}

function subtractOwned(a: ManifoldSolid, b: ManifoldSolid): ManifoldSolid {
  const result = a.subtract(b);
  a.delete();
  b.delete();
  return result;
}

function createFootprint(
  kernel: ManifoldToplevel,
  shape: PressMoldResolvedShape,
  center: [number, number],
  halfX: number,
  halfZ: number,
  minY: number,
  maxY: number,
): ManifoldSolid {
  if (shape === "round") {
    return makeCylinderY(kernel, maxY - minY, Math.max(halfX, halfZ), [center[0], (minY + maxY) / 2, center[1]]);
  }
  return makeBox(kernel, [center[0] - halfX, minY, center[1] - halfZ], [center[0] + halfX, maxY, center[1] + halfZ]);
}

function edgePlanePoint(
  positions: Float32Array,
  first: number,
  second: number,
  y: number,
): [number, number] | null {
  const ay = positions[first * 3 + 1];
  const by = positions[second * 3 + 1];
  if ((ay < y && by < y) || (ay > y && by > y) || Math.abs(ay - by) < 1e-9) return null;
  const t = (y - ay) / (by - ay);
  if (t < 0 || t > 1) return null;
  return [
    positions[first * 3] + (positions[second * 3] - positions[first * 3]) * t,
    positions[first * 3 + 2] + (positions[second * 3 + 2] - positions[first * 3 + 2]) * t,
  ];
}

export function findAutomaticPressSeamY(mesh: TriangleMeshData): number {
  const bounds = calculateMeshBounds(mesh);
  let bestY = bounds.center[1];
  let bestArea = -1;
  for (let slice = 0; slice < 31; slice += 1) {
    const fraction = 0.08 + (slice / 30) * 0.84;
    const y = bounds.min[1] + bounds.size[1] * fraction;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let offset = 0; offset < mesh.indices.length; offset += 3) {
      const a = mesh.indices[offset];
      const b = mesh.indices[offset + 1];
      const c = mesh.indices[offset + 2];
      for (const [first, second] of [[a, b], [b, c], [c, a]] as const) {
        const point = edgePlanePoint(mesh.positions, first, second, y);
        if (!point) continue;
        minX = Math.min(minX, point[0]);
        maxX = Math.max(maxX, point[0]);
        minZ = Math.min(minZ, point[1]);
        maxZ = Math.max(maxZ, point[1]);
      }
    }
    const area = (maxX - minX) * (maxZ - minZ);
    if (
      Number.isFinite(area) &&
      (area > bestArea + 1e-6 ||
        (Math.abs(area - bestArea) <= 1e-6 && Math.abs(y - bounds.center[1]) < Math.abs(bestY - bounds.center[1])))
    ) {
      bestArea = area;
      bestY = y;
    }
  }
  return bestY;
}

async function checkpoint(
  options: PressMoldGenerationOptions,
  stage: Parameters<NonNullable<PressMoldGenerationOptions["onProgress"]>>[0]["stage"],
  progress: number,
  message: string,
): Promise<void> {
  if (options.isCancelled?.()) throw new MoldGenerationError("CANCELLED", "Mold generation cancelled.", "source");
  options.onProgress?.({ stage, progress, message });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (options.isCancelled?.()) throw new MoldGenerationError("CANCELLED", "Mold generation cancelled.", "source");
}

function orientToBed(part: ManifoldSolid, flip: boolean): ManifoldSolid {
  let oriented = part;
  if (flip) {
    oriented = part.rotate([180, 0, 0]);
    part.delete();
  }
  const bounds = oriented.boundingBox();
  const translated = oriented.translate([-bounds.min[0], -bounds.min[1], -bounds.min[2]]);
  oriented.delete();
  return translated;
}

function measurePart(part: ManifoldSolid, feature: "die" | "piston"): MoldPartMetrics {
  const metrics = measureSolid(part);
  const mesh = manifoldToTriangleMesh(part);
  let bedTriangles = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const a = mesh.indices[offset] * 3 + 1;
    const b = mesh.indices[offset + 1] * 3 + 1;
    const c = mesh.indices[offset + 2] * 3 + 1;
    if (Math.abs(mesh.positions[a]) <= 1e-4 && Math.abs(mesh.positions[b]) <= 1e-4 && Math.abs(mesh.positions[c]) <= 1e-4) bedTriangles += 1;
  }
  if (!metrics.closed || metrics.volumeMm3 <= 0) {
    throw new MoldGenerationError("TOPOLOGY_INVALID", `${feature === "die" ? "Die" : "Piston"} is not closed.`, feature);
  }
  if (bedTriangles === 0) {
    throw new MoldGenerationError("NO_FLAT_PRINT_FACE", `${feature === "die" ? "Die" : "Piston"} has no flat print surface.`, feature);
  }
  return { ...metrics, bedTriangles };
}

export async function generatePressMold(
  mesh: TriangleMeshData,
  params: PressMoldParams,
  options: PressMoldGenerationOptions = {},
): Promise<PressMoldGenerationResult> {
  const startedAt = now();
  const issues = validatePressMoldParams(params);
  if (issues.length > 0) {
    throw new MoldGenerationError("INVALID_PARAMETERS", "At least one press mold parameter is outside the supported range.", "source", issues[0]?.field, issues[0]?.message);
  }
  await checkpoint(options, "validating", 0.05, "Checking model and press split plane");
  const kernel = await loadManifold();
  const bounds = calculateMeshBounds(mesh);
  const autoSeamY = findAutomaticPressSeamY(mesh);
  const seamY = autoSeamY + params.seamOffsetMm;
  const tolerance = Math.max(0.1, bounds.size[1] * 0.002);
  if (seamY <= bounds.min[1] + tolerance || seamY >= bounds.max[1] - tolerance) {
    throw new MoldGenerationError("SEAM_OUTSIDE_MODEL", "The press split plane must divide the model into two non-empty regions.", "seam");
  }
  let source: ManifoldSolid;
  try {
    source = triangleMeshToManifold(kernel, mesh);
  } catch (error) {
    throw new MoldGenerationError("INVALID_SOURCE_MESH", "The source model is not a closed, oriented solid.", "source", undefined, error instanceof Error ? error.message : String(error));
  }
  const [splitA, splitB] = source.splitByPlane([0, 1, 0], seamY);
  if (splitA.isEmpty() || splitB.isEmpty()) {
    splitA.delete();
    splitB.delete();
    source.delete();
    throw new MoldGenerationError("SEAM_OUTSIDE_MODEL", "The press split plane creates an empty model part.", "seam");
  }
  let lower = splitA;
  let upper = splitB;
  if (splitA.boundingBox().min[1] >= seamY - tolerance) {
    lower = splitB;
    upper = splitA;
  }
  const cavityVolumeMm3 = source.volume();
  source.delete();

  const halfX = bounds.size[0] / 2;
  const halfZ = bounds.size[2] / 2;
  const aspect = Math.max(bounds.size[0], bounds.size[2]) / Math.max(0.001, Math.min(bounds.size[0], bounds.size[2]));
  const shape: PressMoldResolvedShape = params.shape === "auto"
    ? (aspect <= 1.18 ? "round" : "rectangular")
    : params.shape;
  const center: [number, number] = [bounds.center[0], bounds.center[2]];
  const structureAllowance = Math.max(0.8, params.wallMm * 0.4);
  const projectedHalf = Math.max(halfX, halfZ);
  const chamberHalfX = shape === "round"
    ? projectedHalf + params.paddingMm + structureAllowance
    : halfX + params.paddingMm + structureAllowance;
  const chamberHalfZ = shape === "round"
    ? chamberHalfX
    : halfZ + params.paddingMm + structureAllowance;
  const outerHalfX = chamberHalfX + params.wallMm + structureAllowance;
  const outerHalfZ = chamberHalfZ + params.wallMm + structureAllowance;
  const structuralThickness = params.wallMm + structureAllowance;
  const dieMinY = bounds.min[1] - structuralThickness;
  const guideHeight = Math.min(
    25,
    Math.max(8, bounds.size[1] * 0.35 + structureAllowance),
  );
  const dieMaxY = seamY + guideHeight;
  const pistonTopY = bounds.max[1] + params.wallMm;
  const flangeTopY = pistonTopY + structuralThickness;
  const epsilon = 0.08;
  const guideRailWidth = Math.min(10, Math.max(4, bounds.size[2] * 0.24));
  const guideRailDepth = Math.min(2.5, Math.max(1.2, params.wallMm * 0.6));
  const guideRailClearance = Math.max(0.2, params.fitClearanceMm);

  await checkpoint(options, "shell", 0.2, "Creating die and piston blanks");
  let die = createFootprint(kernel, shape, center, outerHalfX, outerHalfZ, dieMinY, dieMaxY);
  const chamber = createFootprint(kernel, shape, center, chamberHalfX, chamberHalfZ, seamY - epsilon, dieMaxY + epsilon);
  const dieTool = addOwned(lower, chamber);
  await checkpoint(options, "cavity", 0.42, "Cutting the lower cavity from the die");
  die = subtractOwned(die, dieTool);

  const railMinY = seamY + epsilon;
  const railMaxY = dieMaxY - epsilon;
  for (const side of [-1, 1] as const) {
    const minX = side < 0
      ? center[0] - chamberHalfX - epsilon
      : center[0] + chamberHalfX - guideRailDepth;
    const maxX = side < 0
      ? center[0] - chamberHalfX + guideRailDepth
      : center[0] + chamberHalfX + epsilon;
    const rail = makeBox(
      kernel,
      [minX, railMinY, center[1] - guideRailWidth / 2],
      [maxX, railMaxY, center[1] + guideRailWidth / 2],
    );
    die = addOwned(die, rail);
  }

  const coreHalfX = chamberHalfX - params.fitClearanceMm;
  const coreHalfZ = chamberHalfZ - params.fitClearanceMm;
  if (coreHalfX <= halfX || coreHalfZ <= halfZ) {
    upper.delete();
    die.delete();
    throw new MoldGenerationError("FEATURE_COLLISION", "Fit clearance and padding leave no safe piston core.", "piston");
  }
  let piston = createFootprint(kernel, shape, center, coreHalfX, coreHalfZ, seamY, pistonTopY);
  await checkpoint(options, "registration", 0.58, "Building the matching piston and press flange");
  piston = subtractOwned(piston, upper);
  for (const side of [-1, 1] as const) {
    const grooveDepth = guideRailDepth + guideRailClearance;
    const minX = side < 0
      ? center[0] - chamberHalfX - guideRailClearance
      : center[0] + chamberHalfX - grooveDepth;
    const maxX = side < 0
      ? center[0] - chamberHalfX + grooveDepth
      : center[0] + chamberHalfX + guideRailClearance;
    const groove = makeBox(
      kernel,
      [minX, seamY - epsilon, center[1] - guideRailWidth / 2 - guideRailClearance],
      [maxX, pistonTopY + epsilon, center[1] + guideRailWidth / 2 + guideRailClearance],
    );
    piston = subtractOwned(piston, groove);
  }
  const flange = createFootprint(kernel, shape, center, outerHalfX, outerHalfZ, pistonTopY - epsilon, flangeTopY);
  piston = addOwned(piston, flange);

  let ejectorDiameterMm: number | null = null;
  if (params.ejectorHole) {
    ejectorDiameterMm = Math.min(8, Math.max(3, Math.min(bounds.size[0], bounds.size[2]) * 0.16));
    const ejector = makeCylinderY(kernel, params.wallMm + 2 * epsilon, ejectorDiameterMm / 2, [center[0], dieMinY + params.wallMm / 2, center[1]]);
    die = subtractOwned(die, ejector);
  }

  await checkpoint(options, "orienting", 0.84, "Orienting die and piston for the print bed");
  die = orientToBed(die, false);
  piston = orientToBed(piston, true);
  const dieMetrics = measurePart(die, "die");
  const pistonMetrics = measurePart(piston, "piston");
  const dieMesh = manifoldToTriangleMesh(die);
  const pistonMesh = manifoldToTriangleMesh(piston);
  die.delete();
  piston.delete();

  await checkpoint(options, "complete", 1, "Press mold generated locally");
  return {
    kind: "press-mold",
    die: dieMesh,
    piston: pistonMesh,
    dieMetrics,
    pistonMetrics,
    features: {
      shapeResolved: shape,
      seamYMm: seamY,
      autoSeamYMm: autoSeamY,
      cavityVolumeMm3,
      ejectorDiameterMm,
      guideHeightMm: guideHeight,
      guideRails: {
        count: 2,
        widthMm: guideRailWidth,
        depthMm: guideRailDepth,
        clearanceMm: guideRailClearance,
      },
      chamberBounds: {
        min: [center[0] - chamberHalfX, seamY, center[1] - chamberHalfZ],
        max: [center[0] + chamberHalfX, pistonTopY, center[1] + chamberHalfZ],
      },
      outerBounds: {
        min: [center[0] - outerHalfX, dieMinY, center[1] - outerHalfZ],
        max: [center[0] + outerHalfX, flangeTopY, center[1] + outerHalfZ],
      },
    },
    params: structuredClone(params),
    totalDurationMs: now() - startedAt,
  };
}
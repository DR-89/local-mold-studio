import type { TriangleMeshData } from "../../workers/protocol";
import type { PourGate } from "../../domain/mold";
import type { MoldGateReport } from "./types";
import { MoldGenerationError } from "./types";

export type MeshBounds3 = {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
};

export function calculateMeshBounds(mesh: TriangleMeshData): MeshBounds3 {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    const x = mesh.positions[offset];
    const y = mesh.positions[offset + 1];
    const z = mesh.positions[offset + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    throw new MoldGenerationError(
      "INVALID_SOURCE_MESH",
      "The source model has no valid bounds.",
      "source",
    );
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    center: [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
    ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

export function highestSurfaceAt(
  mesh: TriangleMeshData,
  x: number,
  z: number,
): number | null {
  let highest = -Infinity;
  const tolerance = 1e-8;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const ia = mesh.indices[offset] * 3;
    const ib = mesh.indices[offset + 1] * 3;
    const ic = mesh.indices[offset + 2] * 3;
    const ax = mesh.positions[ia];
    const ay = mesh.positions[ia + 1];
    const az = mesh.positions[ia + 2];
    const bx = mesh.positions[ib];
    const by = mesh.positions[ib + 1];
    const bz = mesh.positions[ib + 2];
    const cx = mesh.positions[ic];
    const cy = mesh.positions[ic + 1];
    const cz = mesh.positions[ic + 2];
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) <= tolerance) continue;
    const wa = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
    const wb = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
    const wc = 1 - wa - wb;
    if (wa < -tolerance || wb < -tolerance || wc < -tolerance) continue;
    const y = wa * ay + wb * by + wc * cy;
    if (Number.isFinite(y)) highest = Math.max(highest, y);
  }
  return highest === -Infinity ? null : highest;
}

function nearestSurfaceHit(
  mesh: TriangleMeshData,
  requestedX: number,
  requestedZ: number,
  bounds: MeshBounds3,
): { x: number; z: number; y: number } | null {
  const x = Math.max(bounds.min[0], Math.min(bounds.max[0], requestedX));
  const z = Math.max(bounds.min[2], Math.min(bounds.max[2], requestedZ));
  const directY = highestSurfaceAt(mesh, x, z);
  if (directY !== null) return { x, z, y: directY };

  const candidates = new Map<string, { x: number; z: number; distance: number }>();
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    const vx = mesh.positions[offset];
    const vz = mesh.positions[offset + 2];
    const key = vx + ":" + vz;
    if (!candidates.has(key)) {
      candidates.set(key, {
        x: vx,
        z: vz,
        distance: Math.hypot(vx - x, vz - z),
      });
    }
  }
  const sorted = [...candidates.values()]
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 128);
  for (const candidate of sorted) {
    const y = highestSurfaceAt(mesh, candidate.x, candidate.z);
    if (y !== null) return { x: candidate.x, z: candidate.z, y };
  }
  return null;
}

type SurfaceCandidate = {
  x: number;
  y: number;
  z: number;
};

function gateReport(
  gate: PourGate,
  hit: SurfaceCandidate,
): MoldGateReport {
  return {
    id: gate.id,
    centerXMm: hit.x,
    centerZMm: hit.z,
    surfaceYMm: hit.y,
    diameterMm: gate.diameterMm,
    funnelDiameterMm: gate.diameterMm * 1.5,
  };
}

function requiredGateDistance(
  gate: Pick<MoldGateReport, "diameterMm">,
  other: Pick<MoldGateReport, "diameterMm">,
): number {
  return gate.diameterMm / 2 + other.diameterMm / 2 + 1;
}

function collidingGate(
  report: MoldGateReport,
  placed: MoldGateReport[],
  extraSpacing = 0,
): MoldGateReport | null {
  return (
    placed.find(
      (other) =>
        Math.hypot(
          report.centerXMm - other.centerXMm,
          report.centerZMm - other.centerZMm,
        ) <
        Math.max(requiredGateDistance(report, other), extraSpacing),
    ) ?? null
  );
}

function automaticSurfaceCandidates(
  mesh: TriangleMeshData,
): SurfaceCandidate[] {
  const candidates = new Map<string, SurfaceCandidate>();
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    const x = mesh.positions[offset];
    const z = mesh.positions[offset + 2];
    const key = x.toFixed(6) + ":" + z.toFixed(6);
    if (candidates.has(key)) continue;
    const y = highestSurfaceAt(mesh, x, z);
    if (y !== null) candidates.set(key, { x, y, z });
  }
  return [...candidates.values()].sort(
    (left, right) =>
      right.y - left.y || left.x - right.x || left.z - right.z,
  );
}

export function placePourGates(
  mesh: TriangleMeshData,
  gates: PourGate[],
  bounds: MeshBounds3,
): MoldGateReport[] {
  const enabled = gates.filter((gate) => gate.diameterMm > 0);
  const placedById = new Map<string, MoldGateReport>();
  const placed: MoldGateReport[] = [];

  for (const gate of enabled.filter((item) => item.placement !== "auto")) {
    const hit = nearestSurfaceHit(
      mesh,
      bounds.center[0] + gate.xMm,
      bounds.center[2] + gate.zMm,
      bounds,
    );
    if (!hit) {
      throw new MoldGenerationError(
        "GATE_MISSES_MODEL",
        "A pour channel does not reach the model surface.",
        "gate",
        gate.id,
      );
    }
    const report = gateReport(gate, hit);
    const collision = collidingGate(report, placed);
    if (collision) {
      throw new MoldGenerationError(
        "FEATURE_COLLISION",
        "Two pour channels are too close together.",
        "gate",
        gate.id,
        collision.id,
      );
    }
    placed.push(report);
    placedById.set(gate.id, report);
  }

  const automatic = enabled.filter((gate) => gate.placement === "auto");
  const candidates = automaticSurfaceCandidates(mesh);
  const diagonal = Math.max(Math.hypot(bounds.size[0], bounds.size[2]), 1);
  const verticalSpan = Math.max(bounds.size[1], 1);
  const highCandidates = candidates.filter(
    (candidate) => candidate.y >= bounds.max[1] - verticalSpan * 0.55,
  );

  for (const gate of automatic) {
    const chooseCandidate = (
      pool: SurfaceCandidate[],
    ): MoldGateReport | null => {
      let selected: MoldGateReport | null = null;
      let bestScore = -Infinity;
      for (const candidate of pool) {
        const report = gateReport(gate, candidate);
        if (collidingGate(report, placed)) continue;
        if (placed.length === 0) return report;

        const nearestDistance = Math.min(
          ...placed.map((other) =>
            Math.hypot(
              report.centerXMm - other.centerXMm,
              report.centerZMm - other.centerZMm,
            ),
          ),
        );
        const distanceScore = nearestDistance / diagonal;
        const heightScore = (candidate.y - bounds.min[1]) / verticalSpan;
        const score = distanceScore * 0.72 + heightScore * 0.28;
        if (score > bestScore) {
          bestScore = score;
          selected = report;
        }
      }
      return selected;
    };

    const selected =
      chooseCandidate(highCandidates) ?? chooseCandidate(candidates);
    if (!selected) {
      throw new MoldGenerationError(
        "FEATURE_COLLISION",
        "There are not enough separate high points for automatic distribution.",
        "gate",
        gate.id,
      );
    }
    placed.push(selected);
    placedById.set(gate.id, selected);
  }

  return enabled.map((gate) => placedById.get(gate.id)!);
}

export function placeVent(
  mesh: TriangleMeshData,
  diameterMm: number,
  gates: MoldGateReport[],
): { x: number; y: number; z: number } | null {
  if (diameterMm <= 0) return null;
  const radius = diameterMm / 2;
  const vertices: Array<{ x: number; y: number; z: number }> = [];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    vertices.push({
      x: mesh.positions[offset],
      y: mesh.positions[offset + 1],
      z: mesh.positions[offset + 2],
    });
  }
  vertices.sort((left, right) => right.y - left.y);
  for (const vertex of vertices) {
    const collision = gates.some(
      (gate) =>
        Math.hypot(
          vertex.x - gate.centerXMm,
          vertex.z - gate.centerZMm,
        ) <
        radius + gate.diameterMm / 2 + 1,
    );
    if (!collision) {
      const surfaceY = highestSurfaceAt(mesh, vertex.x, vertex.z);
      if (surfaceY !== null) {
        return { x: vertex.x, y: surfaceY, z: vertex.z };
      }
    }
  }
  throw new MoldGenerationError(
    "FEATURE_COLLISION",
    "There is no collision-free high point for the vent.",
    "vent",
  );
}
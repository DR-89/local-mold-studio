import { strToU8, zipSync } from "fflate";
import { validateTriangleMesh } from "../../geometry/kernel/adapter";
import type { MoldGenerationResult } from "../../geometry/mold/types";
import { MOLD_PRINT_PROFILE } from "../../domain/mold";
import { encodeBinaryStl } from "./binary-stl";
import { encodeMultiPlateThreeMf } from "./three-mf";
import {
  MoldExportError,
  type MoldExportRequestData,
  type MoldExportResult,
} from "./types";

export const TWO_PART_BOX_PRINT_SETTINGS = Object.freeze({
  from: "project",
  name: "project_settings",
  version: "2.8.2.61",
  printer_technology: "FFF",
  sparse_infill_pattern: "cubic",
  sparse_infill_density: "15%",
  wall_loops: "3",
  top_shell_layers: "4",
  bottom_shell_layers: "4",
  filament_type: ["PETG"],
  filament_settings_id: ["Generic PETG @BBL H2S"],
  default_filament_profile: ["Generic PETG @BBL H2S"],
  enable_support: "0",
});

export function sanitizeExportBaseName(value: string): string {
  const withoutExtension = value.trim().replace(/\.(stl|obj|3mf|zip)$/i, "");
  const normalized = withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
  return normalized || "two-part-mold";
}

function validatePart(result: MoldGenerationResult, index: number): void {
  const part = result.parts[index];
  if (!part)
    throw new MoldExportError(
      "INVALID_EXPORT_TOPOLOGY",
      "A mold part is missing.",
    );
  try {
    validateTriangleMesh(part.mesh);
  } catch (error) {
    throw new MoldExportError(
      "INVALID_EXPORT_TOPOLOGY",
      "The export geometry is structurally invalid.",
      error instanceof Error ? error.message : String(error),
    );
  }
  const metrics = part.metrics;
  if (
    !metrics.closed ||
    metrics.boundaryEdges !== 0 ||
    metrics.nonManifoldEdges !== 0 ||
    metrics.volumeMm3 <= 0 ||
    metrics.triangles !== part.mesh.indices.length / 3
  ) {
    throw new MoldExportError(
      "INVALID_EXPORT_TOPOLOGY",
      "At least one mold part fails renewed topology validation.",
      part.id,
    );
  }
}

export function assertMoldResultExportable(result: MoldGenerationResult): void {
  for (const [mesh, metrics] of [
    [result.front, result.frontMetrics],
    [result.back, result.backMetrics],
  ] as const) {
    validateTriangleMesh(mesh);
    if (
      !metrics.closed ||
      metrics.boundaryEdges !== 0 ||
      metrics.nonManifoldEdges !== 0 ||
      metrics.volumeMm3 <= 0
    ) {
      throw new MoldExportError(
        "INVALID_EXPORT_TOPOLOGY",
        "A compatibility mold half fails topology validation.",
      );
    }
  }
  if (
    result.parts.length !== result.resolvedPieceCount ||
    result.parts.length < 2 ||
    result.parts.length > 36
  ) {
    throw new MoldExportError(
      "INVALID_EXPORT_TOPOLOGY",
      "The resolved mold part count is invalid.",
    );
  }
  result.parts.forEach((_, index) => validatePart(result, index));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function buildMoldExportPackage(
  request: MoldExportRequestData,
): MoldExportResult {
  if (
    !request.sourceResultJobId ||
    request.sourceResultJobId !== request.expectedResultJobId
  ) {
    throw new MoldExportError(
      "STALE_RESULT",
      "The mold result is no longer current and cannot be exported.",
    );
  }
  assertMoldResultExportable(request.result);

  const baseName = sanitizeExportBaseName(request.baseName);
  const partStlBytes = request.result.parts.map((part) => {
    const name = baseName + "-" + part.id;
    return { part, name, bytes: encodeBinaryStl(part.mesh, name) };
  });
  const sourceSizeMm = request.result.features.outerBounds.max.map(
    (value, axis) => value - request.result.features.outerBounds.min[axis]!,
  ) as [number, number, number];
  const threeMf = encodeMultiPlateThreeMf(
    partStlBytes.map(({ part, name }) => ({ mesh: part.mesh, name })),
    {
      title: "Local Mold Studio - Two-part box mold",
      buildVolumeMm: request.result.features.printVolume.buildVolumeMm,
      sourceSizeMm,
      lightningInfillPercent: request.result.params.infillPercent,
      wallLoops: request.result.params.wallLoops,
      packSmallParts: true,
      infillPattern: "cubic",
      topShellLayers: 4,
      bottomShellLayers: 4,
      filamentProfileId: "Generic PETG @BBL H2S",
      filamentType: "PETG",
      supportsEnabled: false,
      nozzleDiameterMm: 0.4,
      layerHeightMm: 0.28,
    },
  );
  const partStls = partStlBytes.map(({ name, bytes }) => ({
    fileName: name + ".stl",
    mimeType: "model/stl",
    data: arrayBuffer(bytes),
  }));
  const params = {
    schema: "local-mold-studio/export-v10",
    unit: "millimeter",
    printSettings: {
      scope: "two-part-box-only",
      profile: "fast-balanced",
      walls: request.result.params.wallLoops,
      wallLineWidthMm: MOLD_PRINT_PROFILE.wallLineWidthMm,
      infillPercent: request.result.params.infillPercent,
      infillPattern: "cubic",
      alternativeInfillPattern: "cubic",
      topLayers: 4,
      bottomLayers: 4,
      nozzleDiameterMm: 0.4,
      layerHeightMm: 0.28,
      material: "PETG",
      alternativeMaterial: "PLA+",
    },
    sourceResultJobId: request.sourceResultJobId,
    resolvedPieceCount: request.result.resolvedPieceCount,
    parts: Object.fromEntries(
      partStlBytes.map(({ part, name }, index) => [
        part.id,
        {
          file: name + ".stl",
          triangles: part.metrics.triangles,
          volumeMm3: part.metrics.volumeMm3,
          plateNumber: threeMf.placements[index]?.plateNumber,
          translationMm: threeMf.placements[index]?.translationMm,
          rotationMatrix: threeMf.placements[index]?.rotationMatrix,
          heightSegment: part.heightSegmentIndex + 1,
          depthSegment: part.depthSegmentIndex + 1,
        },
      ]),
    ),
    mold: request.result.params,
    features: request.result.features,
  };
  const printNotes = [
    "LOCAL MOLD STUDIO · PRINT NOTES",
    "",
    "Unit: millimeters",
    `Parts: ${request.result.resolvedPieceCount} mold segments`,
    "",
    "PRINT SETTINGS · TWO-PART BOX ONLY",
    "Fast-balanced profile: materially faster than the former maximum-strength preset.",
    "Nozzle/layer: 0.4 mm / 0.28 mm.",
    `Walls (perimeters): ${request.result.params.wallLoops} at ${MOLD_PRINT_PROFILE.wallLineWidthMm.toFixed(1)} mm assumed line width.`,
    `Infill: ${request.result.params.infillPercent}% cubic.`,
    "Top/bottom layers: 4 each.",
    "Material: PETG embedded; PLA+ is also suitable. For resin use tough/ABS-like resin.",
    "",
    "SETTINGS USED",
    `Mold pieces: ${request.result.resolvedPieceCount}`,
    `Wall thickness: ${request.result.params.wallMm} mm`,
    "Cavity offset: 0 mm",
    `Pour hole: ${request.result.params.pourGates[0]?.diameterMm ?? 0} mm`,
    `Vent hole: ${request.result.params.ventDiameterMm} mm`,
    `Clearance: ${request.result.params.fitClearanceMm} mm`,
    `Inner seam connectors: ${request.result.features.registration.count} hex, ${request.result.features.registration.widthAcrossFlatsMm} mm across flats x ${request.result.features.registration.depthMm} mm insertion depth`,
    `Print volume: ${request.result.features.printVolume.buildVolumeMm.join(" x ")} mm`,
    `Height rows: ${request.result.features.printVolume.heightSegmentCount}`,
    `Depth columns per side: ${request.result.features.printVolume.depthSegmentCount}`,
    `Segment connectors: ${request.result.features.segmentConnectors.count} hex total, ${request.result.features.segmentConnectors.heightPerInterface} across ${request.result.features.segmentConnectors.heightSidesPerInterface} sides per horizontal interface and ${request.result.features.segmentConnectors.depthPerInterface} across ${request.result.features.segmentConnectors.depthSidesPerInterface} sides per depth interface; ${request.result.params.segmentConnectorWidthMm} mm across flats x ${request.result.params.segmentConnectorDepthMm} mm insertion depth`,
    `Estimated print filament: ${request.result.features.materialEstimate.filament.estimatedMassG.toFixed(1)} g PETG / ${request.result.features.materialEstimate.filament.estimatedLengthM.toFixed(2)} m`,
    `Estimated filling material: ${request.result.features.materialEstimate.filling.estimatedMassG.toFixed(1)} g ${request.result.features.materialEstimate.filling.material} (${request.result.features.materialEstimate.filling.volumeMl.toFixed(1)} ml at ${request.result.features.materialEstimate.filling.densityGPerMl.toFixed(2)} g/ml)`,
    `Estimate reserve: ${MOLD_PRINT_PROFILE.wastePercent}% filament waste; slicer toolpaths remain authoritative.`,
    `Rubber-band grooves: ${request.result.params.rubberBandGrooves ? "On" : "Off"}`,
    `Pry pockets: ${request.result.params.pryPockets ? "On" : "Off"}`,
    `Close narrow openings: ${request.result.params.closeNarrowOpenings ? `On (below ${request.result.params.narrowOpeningThresholdMm} mm)` : "Off"}`,
    "",
    "1. Every STL is oriented with a flat mold surface on the print bed.",
    "2. Print every segment rigidly; support material is usually not required.",
    "3. Remove strings and burrs from all seams, hex connectors, registration pins, pour channels, and vents.",
    "4. Dry-fit every segment before casting and clamp the assembly evenly.",
    "",
    "The files were generated entirely locally in the browser.",
  ].join("\r\n");
  const combinedName = baseName + ".3mf";
  const archiveFiles: Record<string, Uint8Array> = {
    [combinedName]: threeMf.archive,
    "parameters.json": strToU8(JSON.stringify(params, null, 2)),
    "PRINT_NOTES.txt": strToU8(printNotes),
  };
  partStlBytes.forEach(({ name, bytes }) => {
    archiveFiles[name + ".stl"] = bytes;
  });
  const archive = zipSync(archiveFiles, { level: 6 });

  return {
    kind: "mold-export",
    sourceResultJobId: request.sourceResultJobId,
    baseName,
    frontStl: partStls[0],
    backStl: partStls[partStls.length - 1],
    partStls,
    combinedThreeMf: {
      fileName: combinedName,
      mimeType: "model/3mf",
      data: arrayBuffer(threeMf.archive),
    },
    printPackageZip: {
      fileName: baseName + "-print-package.zip",
      mimeType: "application/zip",
      data: arrayBuffer(archive),
    },
    totalBytes:
      partStlBytes.reduce((sum, part) => sum + part.bytes.byteLength, 0) +
      threeMf.archive.byteLength +
      archive.byteLength,
  };
}

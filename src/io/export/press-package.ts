import { strToU8, zipSync } from "fflate";
import { validateTriangleMesh } from "../../geometry/kernel/adapter";
import type { PressMoldGenerationResult } from "../../geometry/press-mold/types";
import { encodeBinaryStl } from "./binary-stl";
import { sanitizeExportBaseName } from "./package";
import { encodeCombinedThreeMf } from "./three-mf";
import { MoldExportError, type PressMoldExportRequestData, type PressMoldExportResult } from "./types";

function validatePart(result: PressMoldGenerationResult, part: "die" | "piston"): void {
  const mesh = result[part];
  const metrics = part === "die" ? result.dieMetrics : result.pistonMetrics;
  try {
    validateTriangleMesh(mesh);
  } catch (error) {
    throw new MoldExportError("INVALID_EXPORT_TOPOLOGY", "The press mold geometry is structurally invalid.", error instanceof Error ? error.message : String(error));
  }
  if (!metrics.closed || metrics.boundaryEdges !== 0 || metrics.nonManifoldEdges !== 0 || metrics.volumeMm3 <= 0 || metrics.triangles !== mesh.indices.length / 3) {
    throw new MoldExportError("INVALID_EXPORT_TOPOLOGY", "Die or piston fails renewed topology validation.", part);
  }
}

export function assertPressMoldResultExportable(result: PressMoldGenerationResult): void {
  validatePart(result, "die");
  validatePart(result, "piston");
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function buildPressMoldExportPackage(request: PressMoldExportRequestData): PressMoldExportResult {
  if (!request.sourceResultJobId || request.sourceResultJobId !== request.expectedResultJobId) {
    throw new MoldExportError("STALE_RESULT", "The press mold result is no longer current and cannot be exported.");
  }
  assertPressMoldResultExportable(request.result);
  const baseName = sanitizeExportBaseName(request.baseName || "press-mold");
  const dieName = baseName + "-die";
  const pistonName = baseName + "-piston";
  const dieStl = encodeBinaryStl(request.result.die, dieName);
  const pistonStl = encodeBinaryStl(request.result.piston, pistonName);
  const threeMf = encodeCombinedThreeMf(request.result.die, request.result.piston, dieName, pistonName);
  const params = {
    schema: "local-mold-studio/press-export-v2",
    unit: "millimeter",
    sourceResultJobId: request.sourceResultJobId,
    parts: {
      die: { file: dieName + ".stl", triangles: request.result.dieMetrics.triangles, volumeMm3: request.result.dieMetrics.volumeMm3 },
      piston: { file: pistonName + ".stl", triangles: request.result.pistonMetrics.triangles, volumeMm3: request.result.pistonMetrics.volumeMm3, layoutOffsetXMm: threeMf.backOffsetXMm },
    },
    pressMold: request.result.params,
    features: request.result.features,
  };
  const notes = [
    "LOCAL MOLD STUDIO · PRESS MOLD PRINT NOTES",
    "",
    "Unit: millimeters",
    "Parts: Die and piston",
    "",
    "1. Both parts are already oriented with a flat surface on the print bed.",
    "2. PETG is a good starting choice for a robust, slightly flexible press mold.",
    "3. Remove strings and burrs, especially from the chamber, both guide rails and matching piston grooves.",
    "4. Perform a dry fit before filling; align both guide grooves with the rails and confirm that the piston moves freely.",
    "5. Fill the material into the die, insert the piston straight, and press evenly.",
    "6. Lift off the piston and, if needed, gently push the part out through the ejector hole.",
    "",
    "The files were generated entirely locally in the browser.",
  ].join("\r\n");
  const combinedName = baseName + ".3mf";
  const archive = zipSync({
    [dieName + ".stl"]: dieStl,
    [pistonName + ".stl"]: pistonStl,
    [combinedName]: threeMf.archive,
    "parameters.json": strToU8(JSON.stringify(params, null, 2)),
    "PRINT_NOTES.txt": strToU8(notes),
  }, { level: 6 });
  return {
    kind: "press-mold-export",
    sourceResultJobId: request.sourceResultJobId,
    baseName,
    dieStl: { fileName: dieName + ".stl", mimeType: "model/stl", data: arrayBuffer(dieStl) },
    pistonStl: { fileName: pistonName + ".stl", mimeType: "model/stl", data: arrayBuffer(pistonStl) },
    combinedThreeMf: { fileName: combinedName, mimeType: "model/3mf", data: arrayBuffer(threeMf.archive) },
    printPackageZip: { fileName: baseName + "-press-mold-print-package.zip", mimeType: "application/zip", data: arrayBuffer(archive) },
    totalBytes: dieStl.byteLength + pistonStl.byteLength + threeMf.archive.byteLength + archive.byteLength,
  };
}
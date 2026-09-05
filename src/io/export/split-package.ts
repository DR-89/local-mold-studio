import { strToU8, zipSync } from "fflate";
import {
  splitMeshIntoConnectedComponents,
  validateTriangleMesh,
} from "../../geometry/kernel/adapter";
import { calculateMeshBounds } from "../../geometry/mold/placement";
import type {
  ModelSplitPartResult,
  ModelSplitterGenerationResult,
} from "../../geometry/model-splitter/types";
import type { TriangleMeshData } from "../../workers/protocol";
import { encodeBinaryStl } from "./binary-stl";
import { sanitizeExportBaseName } from "./package";
import {
  BAMBU_STUDIO_MAX_PLATES,
  encodeMultiPlateThreeMf,
  H2S_EXPORT_BUILD_VOLUME_MM,
} from "./three-mf";
import {
  MoldExportError,
  type ModelSplitterExportRequestData,
  type ModelSplitterExportResult,
} from "./types";

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function assertModelSplitterResultExportable(
  result: ModelSplitterGenerationResult,
): void {
  if (
    result.parts.length !== result.features.partCount ||
    !result.features.centeredOrigins
  ) {
    throw new MoldExportError(
      "INVALID_EXPORT_TOPOLOGY",
      "The model splitter result must contain the selected number of centered parts.",
    );
  }
  for (const part of result.parts) {
    try {
      validateTriangleMesh(part.mesh);
    } catch (error) {
      throw new MoldExportError(
        "INVALID_EXPORT_TOPOLOGY",
        `Split part ${part.id} is structurally invalid.`,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (
      !part.metrics.closed ||
      part.metrics.boundaryEdges !== 0 ||
      part.metrics.nonManifoldEdges !== 0 ||
      part.metrics.volumeMm3 <= 0 ||
      part.metrics.triangles !== part.mesh.indices.length / 3
    ) {
      throw new MoldExportError(
        "INVALID_EXPORT_TOPOLOGY",
        `Split part ${part.id} is not watertight.`,
      );
    }
  }
}

type ExportPiece = {
  id: string;
  assemblyLabel: string;
  mesh: TriangleMeshData;
  triangles: number;
  volumeMm3: number;
  sizeMm: [number, number, number];
  assemblyCenterMm: [number, number, number];
  assemblyBottomMm: number;
  fitsPrintVolume: boolean;
  sourcePartId: string;
  pieceIndex: number;
  pieceCount: number;
  weldedFragments: number;
  forceOwnPlate: boolean;
  gridIndex: [number, number, number];
};

function pieceHasConnector(
  piece: ExportPiece,
  connectors: ModelSplitterGenerationResult["features"]["connectors"],
): boolean {
  return connectors.some((connector) => {
    if (
      connector.malePartId !== piece.sourcePartId &&
      connector.femalePartId !== piece.sourcePartId
    ) {
      return false;
    }
    const reach = Math.max(connector.depthMm, connector.diameterMm / 2) + 1;
    return connector.centerMm.every(
      (coordinate, axis) =>
        coordinate >=
          piece.assemblyCenterMm[axis]! - piece.sizeMm[axis]! / 2 - reach &&
        coordinate <=
          piece.assemblyCenterMm[axis]! + piece.sizeMm[axis]! / 2 + reach,
    );
  });
}
const MIN_SEPARATE_BODY_VOLUME_MM3 = 50;
const MIN_SEPARATE_BODY_RATIO = 0.00005;
const MIN_SEPARATE_BODY_TRIANGLES = 8;
const MIN_SEPARATE_BODY_SPAN_MM = 2;

function meshVolumeMm3(mesh: TriangleMeshData): number {
  let signedVolume = 0;
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const ai = (mesh.indices[offset] ?? 0) * 3;
    const bi = (mesh.indices[offset + 1] ?? 0) * 3;
    const ci = (mesh.indices[offset + 2] ?? 0) * 3;
    const ax = mesh.positions[ai] ?? 0;
    const ay = mesh.positions[ai + 1] ?? 0;
    const az = mesh.positions[ai + 2] ?? 0;
    const bx = mesh.positions[bi] ?? 0;
    const by = mesh.positions[bi + 1] ?? 0;
    const bz = mesh.positions[bi + 2] ?? 0;
    const cx = mesh.positions[ci] ?? 0;
    const cy = mesh.positions[ci + 1] ?? 0;
    const cz = mesh.positions[ci + 2] ?? 0;
    signedVolume +=
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);
  }
  return Math.abs(signedVolume / 6);
}

function mergeMeshes(meshes: readonly TriangleMeshData[]): TriangleMeshData {
  const positions = new Float32Array(
    meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0),
  );
  const indices = new Uint32Array(
    meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0),
  );
  let positionOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset);
    for (let index = 0; index < mesh.indices.length; index += 1) {
      indices[indexOffset + index] = (mesh.indices[index] ?? 0) + vertexOffset;
    }
    positionOffset += mesh.positions.length;
    indexOffset += mesh.indices.length;
    vertexOffset += mesh.positions.length / 3;
  }
  return { positions, indices };
}

function centerMesh(mesh: TriangleMeshData) {
  const bounds = calculateMeshBounds(mesh);
  const positions = new Float32Array(mesh.positions.length);
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    positions[offset] = (mesh.positions[offset] ?? 0) - bounds.center[0];
    positions[offset + 1] =
      (mesh.positions[offset + 1] ?? 0) - bounds.center[1];
    positions[offset + 2] =
      (mesh.positions[offset + 2] ?? 0) - bounds.center[2];
  }
  return {
    mesh: { positions, indices: new Uint32Array(mesh.indices) },
    localCenter: bounds.center,
    sizeMm: bounds.size,
  };
}

function basicExportPiece(part: ModelSplitPartResult): ExportPiece {
  return {
    id: part.id,
    assemblyLabel: part.assemblyLabel,
    mesh: part.mesh,
    triangles: part.mesh.indices.length / 3,
    volumeMm3: part.metrics.volumeMm3,
    sizeMm: [0, 1, 2].map(
      (axis) => part.metrics.bounds.max[axis] - part.metrics.bounds.min[axis],
    ) as [number, number, number],
    assemblyCenterMm: [...part.assemblyCenterMm] as [number, number, number],
    assemblyBottomMm: part.assemblyCenterMm[1] + part.metrics.bounds.min[1],
    fitsPrintVolume: part.fitsPrintVolume,
    sourcePartId: part.id,
    pieceIndex: 1,
    pieceCount: 1,
    weldedFragments: 0,
    forceOwnPlate: false,
    gridIndex: part.gridIndex,
  };
}

function toExportPieces(part: ModelSplitPartResult): ExportPiece[] {
  const components = splitMeshIntoConnectedComponents(part.mesh);
  if (components.length === 1) return [basicExportPiece(part)];
  const measured = components
    .map((mesh) => {
      const bounds = calculateMeshBounds(mesh);
      return {
        mesh,
        bounds,
        volumeMm3: meshVolumeMm3(mesh),
        triangles: mesh.indices.length / 3,
      };
    })
    .sort((left, right) => right.volumeMm3 - left.volumeMm3);
  const threshold = Math.max(
    MIN_SEPARATE_BODY_VOLUME_MM3,
    part.metrics.volumeMm3 * MIN_SEPARATE_BODY_RATIO,
  );
  const separate = measured.filter(
    (component, index) =>
      index === 0 ||
      (component.volumeMm3 >= threshold &&
        component.triangles >= MIN_SEPARATE_BODY_TRIANGLES &&
        Math.max(...component.bounds.size) >= MIN_SEPARATE_BODY_SPAN_MM),
  );
  const fragments = measured.filter(
    (component) => !separate.includes(component),
  );
  if (fragments.length > 0) {
    const main = separate[0]!;
    const mainMesh = mergeMeshes([
      main.mesh,
      ...fragments.map((fragment) => fragment.mesh),
    ]);
    separate[0] = {
      mesh: mainMesh,
      bounds: calculateMeshBounds(mainMesh),
      volumeMm3:
        main.volumeMm3 +
        fragments.reduce((sum, fragment) => sum + fragment.volumeMm3, 0),
      triangles:
        main.triangles +
        fragments.reduce((sum, fragment) => sum + fragment.triangles, 0),
    };
  }
  const pieceCount = separate.length;
  return separate.map((component, index) => {
    const centered = centerMesh(component.mesh);
    const assemblyCenterMm = [0, 1, 2].map(
      (axis) => part.assemblyCenterMm[axis] + centered.localCenter[axis],
    ) as [number, number, number];
    return {
      id:
        pieceCount === 1
          ? part.id
          : part.id + "_b" + String(index + 1).padStart(2, "0"),
      assemblyLabel:
        pieceCount === 1
          ? part.assemblyLabel
          : part.assemblyLabel + "-" + (index + 1),
      mesh: centered.mesh,
      triangles: component.triangles,
      volumeMm3: component.volumeMm3,
      sizeMm: centered.sizeMm,
      assemblyCenterMm,
      assemblyBottomMm: assemblyCenterMm[1] - centered.sizeMm[1] / 2,
      fitsPrintVolume: part.fitsPrintVolume,
      sourcePartId: part.id,
      pieceIndex: index + 1,
      pieceCount,
      weldedFragments: index === 0 ? fragments.length : 0,
      forceOwnPlate: false,
      gridIndex: part.gridIndex,
    };
  });
}

export function buildModelSplitterExportPackage(
  request: ModelSplitterExportRequestData,
): ModelSplitterExportResult {
  if (
    !request.sourceResultJobId ||
    request.sourceResultJobId !== request.expectedResultJobId
  ) {
    throw new MoldExportError(
      "STALE_RESULT",
      "The model splitter result is no longer current and cannot be exported.",
    );
  }
  assertModelSplitterResultExportable(request.result);
  const baseName = sanitizeExportBaseName(request.baseName || "split-model");
  const sourceSizeMm: [number, number, number] = [0, 1, 2].map(
    (axis) =>
      request.result.features.sourceBounds.max[axis] -
      request.result.features.sourceBounds.min[axis],
  ) as [number, number, number];
  const largeFigureProfile = Math.max(...sourceSizeMm) > 1_000;
  const exportInfillPercent = largeFigureProfile ? 15 : 8;
  const exportNozzleDiameterMm = largeFigureProfile ? 0.8 : 0.6;
  const exportLayerHeightMm = largeFigureProfile ? 0.4 : 0.36;
  const exportSupportThresholdDeg = largeFigureProfile ? 60 : 55;
  const encodedParts = request.result.parts
    .flatMap(toExportPieces)
    .map((part) => {
      part.forceOwnPlate = pieceHasConnector(
        part,
        request.result.features.connectors,
      );
      const name = `${baseName}_${part.id}`;
      return { part, name, bytes: encodeBinaryStl(part.mesh, name) };
    });
  const separatedBodyCount = Math.max(
    0,
    encodedParts.length - request.result.parts.length,
  );
  const weldedFragmentCount = encodedParts.reduce(
    (sum, { part }) => sum + part.weldedFragments,
    0,
  );
  const plateOrderedParts = [...encodedParts].sort(
    (a, b) =>
      a.part.gridIndex[1] - b.part.gridIndex[1] ||
      a.part.assemblyBottomMm - b.part.assemblyBottomMm ||
      a.part.gridIndex[2] - b.part.gridIndex[2] ||
      a.part.gridIndex[0] - b.part.gridIndex[0] ||
      a.part.id.localeCompare(b.part.id),
  );
  const plateProjects: Array<{
    fileName: string;
    firstPartIndex: number;
    lastPartIndex: number;
    encoded: ReturnType<typeof encodeMultiPlateThreeMf>;
  }> = [];
  const indexDigits = Math.max(2, String(encodedParts.length).length);
  for (
    let firstPartIndex = 0;
    firstPartIndex < encodedParts.length;
    firstPartIndex += BAMBU_STUDIO_MAX_PLATES
  ) {
    const lastPartIndex = Math.min(
      encodedParts.length,
      firstPartIndex + BAMBU_STUDIO_MAX_PLATES,
    );
    const batch = plateOrderedParts.slice(firstPartIndex, lastPartIndex);
    const firstLabel = String(firstPartIndex + 1).padStart(indexDigits, "0");
    const lastLabel = String(lastPartIndex).padStart(indexDigits, "0");
    const fileName =
      encodedParts.length <= BAMBU_STUDIO_MAX_PLATES
        ? baseName + "_split.3mf"
        : baseName + "_split_plates_" + firstLabel + "-" + lastLabel + ".3mf";
    plateProjects.push({
      fileName,
      firstPartIndex,
      lastPartIndex,
      encoded: encodeMultiPlateThreeMf(
        batch.map(({ part, name }) => ({
          mesh: part.mesh,
          name,
          forceOwnPlate: part.forceOwnPlate,
        })),
        {
          title:
            baseName + " - parts " + (firstPartIndex + 1) + "-" + lastPartIndex,
          buildVolumeMm: H2S_EXPORT_BUILD_VOLUME_MM,
          sourceSizeMm,
          lightningInfillPercent: exportInfillPercent,
          wallLoops: 3,
          packSmallParts: true,
          topShellLayers: 3,
          bottomShellLayers: 3,
          nozzleDiameterMm: exportNozzleDiameterMm,
          layerHeightMm: exportLayerHeightMm,
          processPreset: "cloud-fast",
        },
      ),
    });
  }
  const platePlacements = plateProjects.flatMap((project) =>
    project.encoded.placements.map((placement, localIndex) => {
      const orderedPart =
        plateOrderedParts[project.firstPartIndex + localIndex]!;
      return {
        ...placement,
        partId: orderedPart.part.id,
        assemblyCenterMm: orderedPart.part.assemblyCenterMm,
        assemblyBottomMm: orderedPart.part.assemblyBottomMm,
        verticalLayer: orderedPart.part.gridIndex[1] + 1,
        projectFile: project.fileName,
        printSequenceNumber: project.firstPartIndex + localIndex + 1,
      };
    }),
  );
  const placementByPartId = new Map(
    platePlacements.map((placement) => [placement.partId, placement]),
  );
  const partStls = encodedParts.map(({ name, bytes }) => ({
    fileName: `${name}.stl`,
    mimeType: "model/stl",
    data: arrayBuffer(bytes),
  }));
  const manifest = {
    schema: "local-mold-studio/model-splitter-export-v31",
    unit: "millimeter",
    sourceResultJobId: request.sourceResultJobId,
    centeredOrigins: true,
    plateOrder:
      "strict vertical layers Y01 to Ynn, then ascending lowest model Y",
    onePiecePerPlate: false,
    exportBuildVolumeMm: H2S_EXPORT_BUILD_VOLUME_MM,
    pieceCount: encodedParts.length,
    separatedBodyCount,
    weldedFragmentCount,
    printProfile: plateProjects[0]!.encoded.printProfile,
    printSequence: platePlacements.map((placement) => ({
      sequence: placement.printSequenceNumber,
      partId: placement.partId,
      assemblyCenterMm: placement.assemblyCenterMm,
      assemblyBottomMm: placement.assemblyBottomMm,
      verticalLayer: placement.verticalLayer,
      projectFile: placement.projectFile,
      plateNumber: placement.plateNumber,
    })),
    plateProjects: plateProjects.map((project) => ({
      file: project.fileName,
      firstPart: project.firstPartIndex + 1,
      lastPart: project.lastPartIndex,
      plateCount: project.encoded.plateCount,
      printProfile: project.encoded.printProfile,
    })),
    parts: Object.fromEntries(
      encodedParts.map(({ part, name }) => [
        part.id,
        {
          file: `${name}.stl`,
          triangles: part.triangles,
          volumeMm3: part.volumeMm3,
          assemblyCenterMm: part.assemblyCenterMm,
          assemblyLabel: part.assemblyLabel,
          fitsPrintVolume: part.fitsPrintVolume,
          sourcePartId: part.sourcePartId,
          pieceIndex: part.pieceIndex,
          pieceCount: part.pieceCount,
          weldedFragments: part.weldedFragments,
          printSequenceNumber: placementByPartId.get(part.id)
            ?.printSequenceNumber,
          plateProjectFile: placementByPartId.get(part.id)?.projectFile,
          plateNumber: placementByPartId.get(part.id)?.plateNumber,
          plateTranslationMm: placementByPartId.get(part.id)?.translationMm,
          plateRotationMatrix: placementByPartId.get(part.id)?.rotationMatrix,
          orientedSizeMm: placementByPartId.get(part.id)?.orientedSizeMm,
          bedContactAreaMm2: placementByPartId.get(part.id)?.bedContactAreaMm2,
        },
      ]),
    ),
    splitter: request.result.params,
    features: request.result.features,
  };
  const notes = [
    "LOCAL MOLD STUDIO · MODEL SPLITTER ASSEMBLY NOTES",
    "",
    "Unit: millimeters",
    `Parts: ${request.result.features.partCount} watertight, origin-centered model segments`,
    `Printable pieces: ${encodedParts.length} (separate printable bodies are individual objects)`,
    `Cut strategy: ${request.result.features.splitPlan.strategy}`,
    `Planning build volume: ${request.result.features.splitPlan.buildVolumeMm.join(" x ")} mm`,
    `3MF export build volume: ${H2S_EXPORT_BUILD_VOLUME_MM.join(" x ")} mm (Bambu Lab H2S; independent of planning dimensions)`,
    `Base grid: ${request.result.features.gridCounts.join(" x ")} = ${request.result.features.gridCounts.reduce((product, count) => product * count, 1)} primary cells · ${request.result.features.supportSavingCutCount} support-saving secondary cuts · ${request.result.features.partCount} final parts`,
    `Cut planes: ${
      request.result.features.splitPlanes
        .map((plane) => {
          const quality = plane.smartQuality;
          const stageTwo = quality
            ? ` [hidden ${Math.round((1 - quality.seamExposureRatio) * 100)}%, shelter ${Math.round(quality.geometryShelterRatio * 100)}%, support risk ${Math.round(quality.supportRiskRatio * 100)}%]`
            : "";
          const stageThree =
            plane.normal && (plane.tiltDeg ?? 0) > 0.5
              ? ` [free ${plane.tiltDeg?.toFixed(1)} deg, normal ${plane.normal.map((value) => value.toFixed(3)).join("/")}]`
              : "";
          return `${plane.axis.toUpperCase()}${plane.index}=${plane.positionMm.toFixed(2)} mm${stageThree}${stageTwo}`;
        })
        .join(", ") || "none"
    }`,
    `Print-volume result: ${request.result.features.splitPlan.fittingPartCount}/${request.result.features.partCount} parts fit`,
    `Estimated filament: ${request.result.features.filamentEstimate.estimatedLengthM.toFixed(2)} m / ${request.result.features.filamentEstimate.estimatedMassG.toFixed(1)} g`,
    `Model Split ${largeFigureProfile ? "LARGE FAST" : "FAST"} profile: ${plateProjects[0]!.encoded.printProfile.nozzleDiameterMm.toFixed(1)} mm nozzle, ${plateProjects[0]!.encoded.printProfile.layerHeightMm.toFixed(2)} mm layers, 3 walls, ${exportInfillPercent}% Lightning infill, Arachne walls, automatic organic tree supports ${largeFigureProfile ? `for critical regions only (${exportSupportThresholdDeg} degree threshold, sparse support branches)` : `everywhere (${exportSupportThresholdDeg} degree threshold)`}`,
    `Estimate assumptions: Lightning infill at ${request.result.params.infillPercent}% nominal density (${request.result.features.filamentEstimate.assumptions.effectiveInfillPercent.toFixed(2)}% effective interior-volume heuristic), ${request.result.features.filamentEstimate.assumptions.wallLoops} walls at ${request.result.features.filamentEstimate.assumptions.wallLineWidthMm.toFixed(1)} mm (${request.result.features.filamentEstimate.assumptions.shellThicknessMm.toFixed(1)} mm effective shell), ${request.result.params.filamentDiameterMm.toFixed(2)} mm filament, ${request.result.params.filamentDensityGPerCm3.toFixed(2)} g/cm3 density, ${request.result.params.filamentWastePercent}% waste`,
    "",
    `1. File names identify one-based X/Y/Z grid positions in the automatic ${request.result.features.gridCounts.join(" x ")} layout. Relevant disconnected bodies use an additional _bNN suffix and remain separately selectable. Small connector-free pieces are packed side by side on shared H2S plates; connector-bearing and large pieces remain alone.`,
    "2. Every individual STL has its origin at the center of its own bounding box.",
    "   " +
      plateProjects.length +
      " Bambu Studio 3MF project" +
      (plateProjects.length === 1 ? "" : "s") +
      " contain at most " +
      BAMBU_STUDIO_MAX_PLATES +
      " source segments each. Large objects remain alone; small objects are packed collision-free across the full project with up to 36 separately selectable objects per plate. Every object uses a stable right-angle orientation and retains millimeter scale. Plates are ordered by strict original-model vertical layers: all Y01 parts first, then Y02, continuing bottom to top; within a layer, the lowest original model edge comes first.",
    "3. Remove brim, support, and burrs from every connector before assembly.",
    `4. Dry-fit all parts using the ${request.result.params.connectorStyle === "dovetail" ? "male flexible dovetail snap arms and female locking pockets" : request.result.params.connectorStyle === "hex" ? "male hex pegs and female hex sockets" : "male round pins and female sockets"} before applying glue.`,
    `5. Female sockets include ${request.result.params.connectorClearanceMm.toFixed(2)} mm radial print clearance and ${request.result.params.gluePocketMm.toFixed(2)} mm nominal glue depth.`,
    "6. Each mating face has one consistent male side and one female side. Large continuous faces prefer one larger connector; disconnected islands each retain a checked connector where possible.",
    request.result.features.splitPlan.allPartsFit
      ? `7. All ${request.result.features.partCount} parts fit the configured rectangular print volume in at least one right-angle orientation.`
      : "7. WARNING: At least one part exceeds the configured print volume; resize the model or use a larger printer before slicing.",
    "",
    "The files were generated entirely locally in the browser.",
  ].join("\r\n");
  const plateThreeMfs = plateProjects.map((project) => ({
    fileName: project.fileName,
    mimeType: "model/3mf",
    data: arrayBuffer(project.encoded.archive),
  }));
  const archiveFiles: Record<string, Uint8Array> = {
    "parameters.json": strToU8(JSON.stringify(manifest, null, 2)),
    "ASSEMBLY_NOTES.txt": strToU8(notes),
  };
  plateProjects.forEach((project) => {
    archiveFiles[project.fileName] = project.encoded.archive;
  });
  encodedParts.forEach(({ name, bytes }) => {
    archiveFiles[`${name}.stl`] = bytes;
  });
  const archive = zipSync(archiveFiles, { level: 6 });
  return {
    kind: "model-splitter-export",
    sourceResultJobId: request.sourceResultJobId,
    baseName,
    partStls,
    plateThreeMfs,
    combinedThreeMf: plateThreeMfs[0]!,
    printPackageZip: {
      fileName: `${baseName}_split-package.zip`,
      mimeType: "application/zip",
      data: arrayBuffer(archive),
    },
    totalBytes:
      encodedParts.reduce((sum, item) => sum + item.bytes.byteLength, 0) +
      plateProjects.reduce(
        (sum, project) => sum + project.encoded.archive.byteLength,
        0,
      ) +
      archive.byteLength,
  };
}

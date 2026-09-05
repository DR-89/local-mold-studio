"use client";

import GeometryWorker from "../src/workers/geometry.worker?worker";

import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MATERIAL_LABELS,
  MATERIAL_PRESETS,
  MOLD_LIMITS,
  H2S_MOLD_BUILD_VOLUME_MM,
  applyMaterialPreset,
  createDefaultParams,
  setPourGateCount,
  validateMoldParams,
  type MoldMaterial,
  type TwoPartMoldParams,
  type UpAxis,
} from "@/src/domain/mold";
import {
  PRESS_MOLD_LIMITS,
  createDefaultPressMoldParams,
  validatePressMoldParams,
  type PressMoldParams,
} from "@/src/domain/press-mold";
import {
  H2S_BUILD_VOLUME_MM,
  MODEL_SPLITTER_LIMITS,
  MODEL_SPLITTER_MAX_PARTS,
  MODEL_SPLITTER_EFFECTIVE_SHELL_MM,
  MODEL_SPLITTER_WALL_LINE_WIDTH_MM,
  MODEL_SPLITTER_WALL_LOOPS,
  createDefaultModelSplitterParams,
  modelSplitterConnectorPolicy,
  validateModelSplitterParams,
  type ModelSplitterParams,
} from "@/src/domain/model-splitter";
import { chooseAutoUpAxis } from "@/src/domain/orientation";
import { MoldViewer, type VisibleMoldParts } from "@/src/components/MoldViewer";
import {
  DEFAULT_MODEL_PLACEMENT,
  meshBounds,
  placeMeshOnPlate,
  type ModelPlacement,
} from "@/src/domain/placement";
import {
  WORKER_PROTOCOL_VERSION,
  isWorkerResponse,
  type GenerateMoldRequest,
  type ExportMoldRequest,
  type GeneratePressMoldRequest,
  type ExportPressMoldRequest,
  type GenerateModelSplitterRequest,
  type ExportModelSplitterRequest,
  type KernelSelfTestRequest,
  type MeshImportRequest,
  type TriangleMeshData,
  type WorkerRequest,
} from "@/src/workers/protocol";
import {
  MAX_MODEL_BYTES,
  type MeshImportResult,
  type SourceUnit,
} from "@/src/io/import/types";
import type { MoldGenerationResult } from "@/src/geometry/mold/types";
import type { PressMoldGenerationResult } from "@/src/geometry/press-mold/types";
import type { ModelSplitterGenerationResult } from "@/src/geometry/model-splitter/types";
import { planSplitGrid } from "@/src/geometry/model-splitter/planner";
import { fabricationErrorHint } from "@/src/domain/error-guidance";
import { offlineCubeAsciiStl } from "@/src/offline/fixture";
import type {
  ExportArtifact,
  MoldExportResult,
  PressMoldExportResult,
  ModelSplitterExportResult,
} from "@/src/io/export/types";
import {
  GeometryJobCoordinator,
  detectRuntimeCapabilities,
  estimateMoldMemory,
  formatBytes,
  type RuntimeCapabilities,
} from "@/src/workers/orchestration";

type JobState = {
  jobId: string | null;
  status: "idle" | "running" | "cancelling" | "success" | "cancelled" | "error";
  progress: number;
  message: string;
  detail?: string;
  hint?: string;
};

type RangeRowProps = {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  digits?: number;
  numberCommitOnly?: boolean;
  showSlider?: boolean;
  onChange(value: number): void;
};

type CoordinateAxisName = "X" | "Y" | "Z";

function CoordinateAxis({ axis }: { axis: CoordinateAxisName }) {
  return (
    <span className={"coordinate-axis axis-" + axis.toLowerCase()}>{axis}</span>
  );
}

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  digits = 0,
  numberCommitOnly = false,
  showSlider = true,
  onChange,
}: RangeRowProps) {
  const numberRef = useRef<HTMLInputElement>(null);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current && numberRef.current) {
      numberRef.current.value = value.toFixed(digits);
    }
  }, [value, digits]);

  function changeNumber(next: string): void {
    if (next.trim() === "") return;
    const parsed = Number(next);
    if (!Number.isFinite(parsed) || numberCommitOnly) return;
    onChange(Math.min(max, Math.max(min, parsed)));
  }

  function commitNumber(): void {
    const input = numberRef.current;
    if (!input) return;
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed) || input.value.trim() === "") {
      input.value = value.toFixed(digits);
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    input.value = clamped.toFixed(digits);
    onChange(clamped);
  }

  return (
    <label className={"range-row" + (showSlider ? "" : " number-only")}>
      <span className="range-label">{label}</span>
      {showSlider ? (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      ) : null}
      <span className="range-number">
        <input
          ref={numberRef}
          type="number"
          min={min}
          max={max}
          step={step}
          defaultValue={value.toFixed(digits)}
          aria-label={label + " as number"}
          onChange={(event) => changeNumber(event.currentTarget.value)}
          onFocus={(event) => {
            editingRef.current = true;
            event.currentTarget.select();
          }}
          onBlur={() => {
            editingRef.current = false;
            commitNumber();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <span aria-hidden="true">{unit}</span>
      </span>
    </label>
  );
}

function updateParams(
  params: TwoPartMoldParams,
  patch: Partial<TwoPartMoldParams>,
): TwoPartMoldParams {
  return { ...params, ...patch };
}

function assertDownloadableMold(result: MoldGenerationResult): void {
  for (const part of result.parts) {
    const mesh = part.mesh;
    const metrics = part.metrics;
    const vertexCount = mesh.positions.length / 3;
    const arraysValid =
      mesh.positions.length > 0 &&
      mesh.positions.length % 3 === 0 &&
      mesh.indices.length > 0 &&
      mesh.indices.length % 3 === 0 &&
      mesh.positions.every(Number.isFinite) &&
      mesh.indices.every((index) => index < vertexCount);
    if (
      !arraysValid ||
      !metrics.closed ||
      metrics.boundaryEdges !== 0 ||
      metrics.nonManifoldEdges !== 0 ||
      metrics.volumeMm3 <= 0 ||
      metrics.triangles !== mesh.indices.length / 3
    ) {
      throw new Error(
        "The export geometry no longer passes topology validation.",
      );
    }
  }
}

function assertDownloadablePressMold(result: PressMoldGenerationResult): void {
  for (const part of ["die", "piston"] as const) {
    const mesh = result[part];
    const metrics = part === "die" ? result.dieMetrics : result.pistonMetrics;
    const vertexCount = mesh.positions.length / 3;
    const arraysValid =
      mesh.positions.length > 0 &&
      mesh.positions.length % 3 === 0 &&
      mesh.indices.length > 0 &&
      mesh.indices.length % 3 === 0 &&
      mesh.positions.every(Number.isFinite) &&
      mesh.indices.every((index) => index < vertexCount);
    if (
      !arraysValid ||
      !metrics.closed ||
      metrics.boundaryEdges !== 0 ||
      metrics.nonManifoldEdges !== 0 ||
      metrics.volumeMm3 <= 0 ||
      metrics.triangles !== mesh.indices.length / 3
    ) {
      throw new Error(
        "The press mold geometry no longer passes topology validation.",
      );
    }
  }
}
function assertDownloadableModelSplitter(
  result: ModelSplitterGenerationResult,
): void {
  if (
    result.parts.length !== result.features.partCount ||
    !result.features.centeredOrigins
  ) {
    throw new Error(
      "The splitter result no longer contains the selected number of centered parts.",
    );
  }
  for (const part of result.parts) {
    const vertexCount = part.mesh.positions.length / 3;
    if (
      part.mesh.positions.length === 0 ||
      part.mesh.positions.length % 3 !== 0 ||
      part.mesh.indices.length === 0 ||
      part.mesh.indices.length % 3 !== 0 ||
      !part.mesh.positions.every(Number.isFinite) ||
      !part.mesh.indices.every((index) => index < vertexCount) ||
      !part.metrics.closed ||
      part.metrics.boundaryEdges !== 0 ||
      part.metrics.nonManifoldEdges !== 0 ||
      part.metrics.volumeMm3 <= 0
    ) {
      throw new Error(
        `Split part ${part.id} no longer passes topology validation.`,
      );
    }
  }
}
function DownloadButtonLabel({
  label,
  downloaded,
}: {
  label: string;
  downloaded: boolean;
}) {
  return (
    <span className="download-button-label">
      <span>{label}</span>
      {downloaded ? (
        <span className="download-status">✓ Downloaded</span>
      ) : null}
    </span>
  );
}
export function MoldStudio() {
  const [moldType, setMoldType] = useState<
    "two-part" | "silicone" | "press" | "splitter"
  >("two-part");
  const [pressParams, setPressParams] = useState<PressMoldParams>(() =>
    createDefaultPressMoldParams(),
  );
  const [splitterParams, setSplitterParams] = useState<ModelSplitterParams>(
    () => createDefaultModelSplitterParams(),
  );
  const [params, setParamsState] = useState<TwoPartMoldParams>(() =>
    createDefaultParams(),
  );
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [sourceUnit, setSourceUnit] = useState<SourceUnit>("auto");
  const [importResult, setImportResult] = useState<MeshImportResult | null>(
    null,
  );
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [moldResult, setMoldResult] = useState<MoldGenerationResult | null>(
    null,
  );
  const [pressResult, setPressResult] =
    useState<PressMoldGenerationResult | null>(null);
  const [splitterResult, setSplitterResult] =
    useState<ModelSplitterGenerationResult | null>(null);
  const [moldResultJobId, setMoldResultJobId] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<
    MoldExportResult | PressMoldExportResult | ModelSplitterExportResult | null
  >(null);
  const [downloadedFiles, setDownloadedFiles] = useState<Set<string>>(
    () => new Set(),
  );
  const [explode, setExplode] = useState(0);
  const [visibleParts, setVisibleParts] = useState<VisibleMoldParts>("all");
  const [showCavity, setShowCavity] = useState(true);
  const [workerReady, setWorkerReady] = useState(false);
  const [placement, setPlacement] = useState<ModelPlacement>(() => ({
    positionMm: [...DEFAULT_MODEL_PLACEMENT.positionMm],
    rotationDeg: [...DEFAULT_MODEL_PLACEMENT.rotationDeg],
  }));
  const [offlineStatus, setOfflineStatus] = useState<
    "development" | "preparing" | "ready" | "unsupported" | "error"
  >(() => (import.meta.env.PROD ? "preparing" : "development"));
  const [runtimeCapabilities, setRuntimeCapabilities] =
    useState<RuntimeCapabilities>(() => detectRuntimeCapabilities({}));
  const [hasImportedMesh, setHasImportedMesh] = useState(false);
  const [job, setJob] = useState<JobState>({
    jobId: null,
    status: "idle",
    progress: 0,
    message: "Ready for a local model import.",
  });
  const workerRef = useRef<Worker | null>(null);
  const coordinatorRef = useRef(new GeometryJobCoordinator());
  const restartWorkerRef = useRef<() => void>(() => undefined);
  const importedMeshRef = useRef<TriangleMeshData | null>(null);
  const generatedMoldRef = useRef<
    | MoldGenerationResult
    | PressMoldGenerationResult
    | ModelSplitterGenerationResult
    | null
  >(null);
  const twoPartValidation = useMemo(() => validateMoldParams(params), [params]);
  const pressValidation = useMemo(
    () => validatePressMoldParams(pressParams),
    [pressParams],
  );
  const splitterValidation = useMemo(
    () => validateModelSplitterParams(splitterParams),
    [splitterParams],
  );
  const validation =
    moldType === "press"
      ? pressValidation
      : moldType === "splitter"
        ? splitterValidation
        : twoPartValidation;
  const activeResult =
    moldType === "press"
      ? pressResult
      : moldType === "splitter"
        ? splitterResult
        : moldResult;
  const preset = MATERIAL_PRESETS[params.material];
  const jobBusy = job.status === "running" || job.status === "cancelling";
  const downloadableArtifacts = useMemo<ExportArtifact[]>(() => {
    if (!exportResult) return [];
    if (exportResult.kind === "press-mold-export") {
      return [
        exportResult.dieStl,
        exportResult.pistonStl,
        exportResult.combinedThreeMf,
        exportResult.printPackageZip,
      ];
    }
    return [
      ...exportResult.partStls,
      ...(exportResult.kind === "model-splitter-export"
        ? exportResult.plateThreeMfs
        : [exportResult.combinedThreeMf]),
      exportResult.printPackageZip,
    ];
  }, [exportResult]);
  const downloadedArtifactCount = downloadableArtifacts.filter((artifact) =>
    downloadedFiles.has(artifact.fileName),
  ).length;
  const placedMesh = useMemo(
    () =>
      importResult ? placeMeshOnPlate(importResult.mesh, placement) : null,
    [importResult, placement],
  );
  const placedBounds = useMemo(
    () => (placedMesh ? meshBounds(placedMesh) : null),
    [placedMesh],
  );
  const figureHeightAxis = (
    placedBounds
      ? placedBounds.size.reduce(
          (largestAxis, size, axis, dimensions) =>
            size > (dimensions[largestAxis] ?? 0) ? axis : largestAxis,
          0,
        )
      : 1
  ) as 0 | 1 | 2;
  const modelDimensionAxes = ([0, 1, 2] as const).filter(
    (axis) => moldType !== "splitter" || axis !== figureHeightAxis,
  );
  const splitterPlan = useMemo(
    () => (placedBounds ? planSplitGrid(placedBounds, splitterParams) : null),
    [placedBounds, splitterParams],
  );
  const splitterConnectorPolicy = useMemo(
    () =>
      splitterPlan
        ? modelSplitterConnectorPolicy(splitterPlan.gridCounts)
        : null,
    [splitterPlan],
  );
  const splitterAxes = useMemo(
    () =>
      (["x", "y", "z"] as const).filter(
        (_, axis) => (splitterPlan?.gridCounts[axis] ?? 1) > 1,
      ),
    [splitterPlan],
  );
  const splitterInterfaceSlots = useMemo(() => {
    if (!splitterPlan)
      return [] as Array<{ id: string; axis: "x" | "y" | "z" }>;
    const counts = splitterPlan.gridCounts;
    const definitions = [
      { axis: "x" as const, dimension: 0 },
      { axis: "y" as const, dimension: 1 },
      { axis: "z" as const, dimension: 2 },
    ];
    const slots: Array<{ id: string; axis: "x" | "y" | "z" }> = [];
    for (const definition of definitions) {
      for (let x = 0; x < counts[0]; x += 1) {
        for (let y = 0; y < counts[1]; y += 1) {
          for (let z = 0; z < counts[2]; z += 1) {
            const index = [x, y, z];
            if (index[definition.dimension] >= counts[definition.dimension] - 1)
              continue;
            const boundary = index[definition.dimension] + 1;
            slots.push({
              id: `${definition.axis}-${boundary}-${x}:${y}:${z}`,
              axis: definition.axis,
            });
          }
        }
      }
    }
    return slots;
  }, [splitterPlan]);
  const memoryEstimate = useMemo(
    () =>
      placedMesh ? estimateMoldMemory(placedMesh, runtimeCapabilities) : null,
    [placedMesh, runtimeCapabilities],
  );

  const seamRange = useMemo(() => {
    const axis = moldType === "press" ? 1 : 0;
    const halfSize = (placedBounds?.size[axis] ?? 60) / 2;
    const inset = Math.max(0, halfSize - 0.2);
    const limits =
      moldType === "press"
        ? PRESS_MOLD_LIMITS.seamOffsetMm
        : MOLD_LIMITS.seamOffsetMm;
    return {
      min: Math.max(limits.min, -inset),
      max: Math.min(limits.max, inset),
      step: limits.step,
    };
  }, [placedBounds, moldType]);

  const activePartMetrics =
    pressResult && moldType === "press"
      ? [pressResult.dieMetrics, pressResult.pistonMetrics]
      : splitterResult && moldType === "splitter"
        ? splitterResult.parts.map((part) => part.metrics)
        : moldResult && moldType !== "press" && moldType !== "splitter"
          ? moldResult.parts.map((part) => part.metrics)
          : null;
  const commonPrintBedFits =
    splitterResult && moldType === "splitter"
      ? splitterResult.features.splitPlan.allPartsFit
      : activePartMetrics
        ? moldResult && moldType === "two-part"
          ? moldResult.features.printVolume.allPartsFit
          : activePartMetrics.every((metrics) => {
              const size = metrics.bounds.max.map(
                (value, index) => value - metrics.bounds.min[index],
              );
              return size[0] <= 220 && size[2] <= 220 && size[1] <= 250;
            })
        : null;

  const placedCenter = useMemo<[number, number, number]>(
    () =>
      placedBounds
        ? [
            (placedBounds.min[0] + placedBounds.max[0]) / 2,
            (placedBounds.min[1] + placedBounds.max[1]) / 2,
            (placedBounds.min[2] + placedBounds.max[2]) / 2,
          ]
        : [0, 0, 0],
    [placedBounds],
  );
  const seamX =
    moldType === "splitter"
      ? (splitterResult?.features.splitCenterMm[0] ?? placedCenter[0])
      : moldType === "press"
        ? (pressResult?.features.seamYMm ??
          (placedBounds ? (placedBounds.min[1] + placedBounds.max[1]) / 2 : 0) +
            pressParams.seamOffsetMm)
        : (moldResult?.features.seamXMm ??
          (placedBounds ? (placedBounds.min[0] + placedBounds.max[0]) / 2 : 0) +
            params.seamOffsetMm);
  const splitterCenter: [number, number, number] =
    splitterResult?.features.splitCenterMm ??
    splitterPlan?.centerMm ??
    placedCenter;
  const splitterPlanes =
    splitterResult?.features.splitPlanes ?? splitterPlan?.planes ?? [];
  const activeOuterBounds = activeResult
    ? activeResult.kind === "model-splitter"
      ? activeResult.features.sourceBounds
      : activeResult.features.outerBounds
    : null;
  useEffect(() => {
    let worker = new GeometryWorker({ name: "local-mold-geometry" });
    const handleWorkerMessage = (event: MessageEvent<unknown>) => {
      if (!isWorkerResponse(event.data)) return;
      const response = event.data;
      if (!coordinatorRef.current.accepts(response)) return;
      if (response.type === "job.progress") {
        setJob((current) => ({
          ...current,
          status: "running",
          progress: response.progress,
          message: response.message,
        }));
      } else if (response.type === "job.success") {
        if (response.result.kind === "mesh-import") {
          const result: MeshImportResult = response.result;
          importedMeshRef.current = result.mesh;
          generatedMoldRef.current = null;
          setImportResult(result);
          setMoldResult(null);
          setPressResult(null);
          setSplitterResult(null);
          setMoldResultJobId(null);
          setExportResult(null);
          setHasImportedMesh(true);
          const [width, height, depth] = result.measurements.bounds.size;
          setImportSummary(
            result.format.toUpperCase() +
              " · " +
              result.measurements.triangles.toLocaleString("en-US") +
              " triangles · " +
              width.toFixed(1) +
              " × " +
              height.toFixed(1) +
              " × " +
              depth.toFixed(1) +
              " mm",
          );
          const warningCount = result.diagnostics.filter(
            (entry) => entry.severity === "warning",
          ).length;
          setJob({
            jobId: response.jobId,
            status: "success",
            progress: 1,
            message: !result.moldReady
              ? "Model loaded · preview and split plane available · mold generation requires repair"
              : warningCount > 0
                ? "Import complete · " + warningCount + " warning(s)"
                : "Model is closed, oriented, and ready for the mold pipeline.",
          });
        } else if (response.result.kind === "mold") {
          generatedMoldRef.current = response.result;
          setMoldResult(response.result);
          setPressResult(null);
          setSplitterResult(null);
          setMoldResultJobId(response.jobId);
          setExportResult(null);
          setExplode(22);
          setVisibleParts("all");
          setJob({
            jobId: response.jobId,
            status: "success",
            progress: 1,
            message:
              `${response.result.resolvedPieceCount}-part mold generated · ` +
              response.result.parts
                .map(
                  (part) =>
                    `${part.id} ${part.metrics.triangles.toLocaleString("en-US")}`,
                )
                .join(" / ") +
              " triangles · " +
              response.result.totalDurationMs.toFixed(0) +
              " ms",
          });
        } else if (response.result.kind === "press-mold") {
          generatedMoldRef.current = response.result;
          setMoldResult(null);
          setPressResult(response.result);
          setSplitterResult(null);
          setMoldResultJobId(response.jobId);
          setExportResult(null);
          setExplode(22);
          setVisibleParts("all");
          setJob({
            jobId: response.jobId,
            status: "success",
            progress: 1,
            message:
              "Press mold generated · Die " +
              response.result.dieMetrics.triangles.toLocaleString("en-US") +
              " / Piston " +
              response.result.pistonMetrics.triangles.toLocaleString("en-US") +
              " triangles · " +
              response.result.totalDurationMs.toFixed(0) +
              " ms",
          });
        } else if (response.result.kind === "model-splitter") {
          generatedMoldRef.current = response.result;
          setMoldResult(null);
          setPressResult(null);
          setSplitterResult(response.result);
          setMoldResultJobId(response.jobId);
          setExportResult(null);
          setExplode(28);
          setVisibleParts("all");
          setJob({
            jobId: response.jobId,
            status: "success",
            progress: 1,
            message:
              `${response.result.features.partCount} watertight parts generated · ${response.result.features.connectors.length} connectors placed · ${response.result.features.supportSavingCutCount} support-saving cuts` +
              (response.result.features.skippedConnectorCount > 0
                ? ` · ${response.result.features.skippedConnectorCount} unsafe locations skipped`
                : "") +
              ` · ${response.result.totalDurationMs.toFixed(0)} ms`,
          });
        } else if (response.result.kind === "mold-export") {
          setExportResult(response.result);
          setJob({
            jobId: response.jobId,
            status: "success",
            progress: 1,
            message:
              "Export package ready · " +
              formatBytes(response.result.totalBytes) +
              " created locally",
          });
        } else if (response.result.kind === "press-mold-export") {
          setExportResult(response.result);
          setJob({
            jobId: response.jobId,
            status: "success",
            progress: 1,
            message:
              "Press mold package ready · " +
              formatBytes(response.result.totalBytes) +
              " created locally",
          });
        } else if (response.result.kind === "model-splitter-export") {
          setExportResult(response.result);
          setJob({
            jobId: response.jobId,
            status: "success",
            progress: 1,
            message:
              "Plate-by-plate assembly package ready · " +
              formatBytes(response.result.totalBytes) +
              " created locally",
          });
        } else {
          setJob({
            jobId: response.jobId,
            status: "success",
            progress: 1,
            message:
              response.result.kind === "kernel-self-test"
                ? response.result.kernel +
                  " " +
                  response.result.version +
                  ": " +
                  response.result.metrics.length +
                  " checks in " +
                  response.result.totalDurationMs.toFixed(0) +
                  " ms."
                : "Local test complete.",
          });
        }
      } else if (response.type === "job.cancelled") {
        setJob({
          jobId: response.jobId,
          status: "cancelled",
          progress: 0,
          message: "Local job was cancelled.",
        });
      } else if (response.type === "job.error") {
        const exportFailure =
          response.error.code === "STALE_RESULT" ||
          response.error.code === "INVALID_EXPORT_TOPOLOGY" ||
          response.error.code === "EXPORT_FAILED";
        if (exportFailure) {
          setExportResult(null);
        } else {
          if (!importedMeshRef.current) {
            setImportResult(null);
            setHasImportedMesh(false);
            setImportSummary(null);
          }
          generatedMoldRef.current = null;
          setMoldResult(null);
          setPressResult(null);
          setSplitterResult(null);
          setMoldResultJobId(null);
          setExportResult(null);
        }
        setJob({
          jobId: response.jobId,
          status: "error",
          progress: 0,
          message: response.error.message,
          detail: response.error.detail,
          hint: fabricationErrorHint(response.error),
        });
      }
      if (response.type !== "job.progress") {
        coordinatorRef.current.finish(response.jobId);
      }
    };
    worker.onmessage = handleWorkerMessage;
    workerRef.current = worker;
    restartWorkerRef.current = () => {
      worker.terminate();
      worker = new GeometryWorker({ name: "local-mold-geometry" });
      worker.onmessage = handleWorkerMessage;
      workerRef.current = worker;
    };
    const readyTimer = window.setTimeout(() => {
      setRuntimeCapabilities(detectRuntimeCapabilities());
      setWorkerReady(true);
    }, 0);
    return () => {
      window.clearTimeout(readyTimer);
      restartWorkerRef.current = () => undefined;
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let active = true;
    if (!("serviceWorker" in navigator)) {
      queueMicrotask(() => {
        if (active) setOfflineStatus("unsupported");
      });
      return () => {
        active = false;
      };
    }
    void navigator.serviceWorker
      .register(new URL("./sw.js", window.location.href), {
        scope: new URL("./", window.location.href).pathname,
      })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        if (active) setOfflineStatus("ready");
      })
      .catch(() => {
        if (active) setOfflineStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  function invalidateGeneratedResult(message?: string): void {
    if (!generatedMoldRef.current && !activeResult) return;
    generatedMoldRef.current = null;
    setMoldResult(null);
    setPressResult(null);
    setSplitterResult(null);
    setMoldResultJobId(null);
    setExportResult(null);
    setDownloadedFiles(new Set());
    setJob({
      jobId: null,
      status: "idle",
      progress: 0,
      message:
        message ??
        "Settings changed · the result is outdated. Please generate the mold again.",
    });
  }

  function changeParams(
    updater: (current: TwoPartMoldParams) => TwoPartMoldParams,
  ): void {
    setParamsState(updater);
    invalidateGeneratedResult();
  }

  function changePressParams(patch: Partial<PressMoldParams>): void {
    setPressParams((current) => ({ ...current, ...patch }));
    invalidateGeneratedResult();
  }

  function changeSplitterParams(patch: Partial<ModelSplitterParams>): void {
    setSplitterParams((current) => ({ ...current, ...patch }));
    invalidateGeneratedResult(
      "Splitter settings changed · please generate the calculated parts again.",
    );
  }

  function selectMoldType(
    nextType: "two-part" | "silicone" | "press" | "splitter",
  ): void {
    if (nextType === moldType) return;
    setMoldType(nextType);
    generatedMoldRef.current = null;
    setMoldResult(null);
    setPressResult(null);
    setSplitterResult(null);
    setMoldResultJobId(null);
    setExportResult(null);
    setVisibleParts("all");
    setJob({
      jobId: null,
      status: "idle",
      progress: 0,
      message:
        nextType === "press"
          ? "Press Mold selected · model and parameters remain local."
          : nextType === "splitter"
            ? "Model Splitter selected · model and parameters remain local."
            : nextType === "silicone"
              ? "Silicone Box Mold selected · model and parameters remain local."
              : "Two-part Box Mold selected · model and parameters remain local.",
    });
  }

  function selectMaterial(material: MoldMaterial) {
    changeParams((current) => applyMaterialPreset(current, material));
  }

  function resetModelPlacement(resetRotation = true): void {
    setPlacement((current) => ({
      positionMm: [0, 0, 0],
      rotationDeg: resetRotation ? [0, 0, 0] : current.rotationDeg,
    }));
    invalidateGeneratedResult(
      "Model placement changed · please generate the mold again.",
    );
  }

  function changeModelPlacement(
    field: keyof ModelPlacement,
    axis: number,
    value: number,
  ): void {
    setPlacement((current) => {
      const vector = [...current[field]] as [number, number, number];
      vector[axis] = value;
      return { ...current, [field]: vector };
    });
    invalidateGeneratedResult(
      "Model placement changed · please generate the mold again.",
    );
  }
  function changeModelScale(nextScalePercent: number): void {
    const scalePercent = Math.min(
      MOLD_LIMITS.scalePercent.max,
      Math.max(MOLD_LIMITS.scalePercent.min, nextScalePercent),
    );
    setParamsState((current) => updateParams(current, { scalePercent }));
    if (uploadedFile) {
      void importFile(uploadedFile, sourceUnit, { scalePercent }, true);
    }
  }

  function changeModelDimension(axis: number, sizeMm: number): void {
    const currentSize = placedBounds?.size[axis] ?? 0;
    if (currentSize <= 0 || sizeMm <= 0) return;
    changeModelScale((params.scalePercent * sizeMm) / currentSize);
  }

  async function importFile(
    file: File,
    unit: SourceUnit = sourceUnit,
    overrides?: { upAxis?: UpAxis; scalePercent?: number },
    preservePreview = false,
  ): Promise<void> {
    if (!workerRef.current) return;
    generatedMoldRef.current = null;
    setMoldResult(null);
    setPressResult(null);
    setSplitterResult(null);
    setMoldResultJobId(null);
    setExportResult(null);
    if (!preservePreview) {
      importedMeshRef.current = null;
      setImportResult(null);
      setHasImportedMesh(false);
      setImportSummary(null);
    }
    const jobId = crypto.randomUUID();
    coordinatorRef.current.start(jobId, "import");
    if (file.size > MAX_MODEL_BYTES) {
      setJob({
        jobId,
        status: "error",
        progress: 0,
        message: "The file exceeds the local 100 MB limit.",
      });
      coordinatorRef.current.finish(jobId);
      return;
    }
    setJob({
      jobId,
      status: "running",
      progress: 0.04,
      message: "Preparing the file entirely in the browser.",
    });
    try {
      const data = await file.arrayBuffer();
      if (!coordinatorRef.current.accepts({ jobId })) return;
      const request: MeshImportRequest = {
        version: WORKER_PROTOCOL_VERSION,
        type: "mesh.import",
        jobId,
        data,
        options: {
          fileName: file.name,
          mimeType: file.type,
          upAxis: overrides?.upAxis ?? params.upAxis,
          scalePercent: overrides?.scalePercent ?? params.scalePercent,
          sourceUnit: unit,
        },
      };
      workerRef.current?.postMessage(request satisfies WorkerRequest, [data]);
    } catch (error) {
      coordinatorRef.current.finish(jobId);
      setJob({
        jobId,
        status: "error",
        progress: 0,
        message:
          error instanceof Error
            ? error.message
            : "The file could not be read locally.",
      });
    }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    setUploadedFile(file);
    if (file) {
      setPlacement({
        positionMm: [0, 0, 0],
        rotationDeg: [0, 0, 0],
      });
      void importFile(file);
    } else {
      importedMeshRef.current = null;
      generatedMoldRef.current = null;
      setImportResult(null);
      setMoldResult(null);
      setPressResult(null);
      setSplitterResult(null);
      setMoldResultJobId(null);
      setExportResult(null);
      setHasImportedMesh(false);
      setImportSummary(null);
      setPlacement({
        positionMm: [0, 0, 0],
        rotationDeg: [0, 0, 0],
      });
      setJob({
        jobId: null,
        status: "idle",
        progress: 0,
        message: "Ready for a local model import.",
      });
    }
  }

  function loadOfflineFixture(): void {
    const file = new File([offlineCubeAsciiStl()], "offline-testmodell.stl", {
      type: "model/stl",
    });
    setUploadedFile(file);
    setPlacement({
      positionMm: [0, 0, 0],
      rotationDeg: [0, 0, 0],
    });
    void importFile(file);
  }

  function autoOrient(): void {
    if (!uploadedFile || !importResult) return;
    const upAxis = chooseAutoUpAxis(
      importResult.measurements.bounds.size,
      params.upAxis,
    );
    setParamsState((current) => updateParams(current, { upAxis }));
    void importFile(uploadedFile, sourceUnit, { upAxis }, true);
  }

  function selectUpAxis(upAxis: UpAxis): void {
    setParamsState((current) => updateParams(current, { upAxis }));
    if (uploadedFile) {
      void importFile(uploadedFile, sourceUnit, { upAxis }, true);
    }
  }

  function runMoldGeneration(): void {
    const mesh = placedMesh;
    if (
      !workerRef.current ||
      !mesh ||
      !importResult?.moldReady ||
      validation.length > 0 ||
      jobBusy
    )
      return;
    if (memoryEstimate && !memoryEstimate.allowed) {
      setJob({
        jobId: null,
        status: "error",
        progress: 0,
        message: memoryEstimate.reason ?? "Local memory budget exceeded.",
      });
      return;
    }
    const jobId = crypto.randomUUID();
    coordinatorRef.current.start(jobId, "mold");
    setJob({
      jobId,
      status: "running",
      progress: 0.02,
      message:
        moldType === "press"
          ? "Preparing die and piston locally."
          : moldType === "splitter"
            ? splitterParams.splitStrategy === "smart"
              ? `Preparing a geometry-optimized ${splitterPlan?.gridCounts.join(" x ") ?? ""} smart split locally.`
              : `Preparing the automatic ${splitterPlan?.gridCounts.join(" × ") ?? ""} print-bed grid locally.`
            : "Preparing the two-part mold locally.",
    });
    const workerMesh: TriangleMeshData = {
      positions: mesh.positions.slice(),
      indices: mesh.indices.slice(),
    };
    let request:
      | GenerateMoldRequest
      | GeneratePressMoldRequest
      | GenerateModelSplitterRequest;
    if (moldType === "press") {
      request = {
        version: WORKER_PROTOCOL_VERSION,
        type: "press.generate",
        jobId,
        mesh: workerMesh,
        params: pressParams,
      };
    } else if (moldType === "splitter") {
      request = {
        version: WORKER_PROTOCOL_VERSION,
        type: "splitter.generate",
        jobId,
        mesh: workerMesh,
        params: splitterParams,
      };
    } else {
      request = {
        version: WORKER_PROTOCOL_VERSION,
        type: "mold.generate",
        jobId,
        mesh: workerMesh,
        params,
        sourceCacheKey: importResult.sourceCacheKey,
        placement,
      };
    }
    workerRef.current.postMessage(request satisfies WorkerRequest, [
      workerMesh.positions.buffer,
      workerMesh.indices.buffer,
    ]);
  }

  function runExportPackage(): void {
    const result = activeResult;
    if (
      !workerRef.current ||
      !result ||
      !moldResultJobId ||
      generatedMoldRef.current !== result ||
      jobBusy
    )
      return;
    const jobId = crypto.randomUUID();
    coordinatorRef.current.start(jobId, "export");
    setExportResult(null);
    setDownloadedFiles(new Set());
    setJob({
      jobId,
      status: "running",
      progress: 0.02,
      message: "Creating export files entirely locally.",
    });
    if (result.kind === "model-splitter") {
      const workerResult: ModelSplitterGenerationResult = {
        ...result,
        parts: result.parts.map((part) => ({
          ...part,
          mesh: {
            positions: part.mesh.positions.slice(),
            indices: part.mesh.indices.slice(),
          },
        })),
      };
      const request: ExportModelSplitterRequest = {
        version: WORKER_PROTOCOL_VERSION,
        type: "splitter.export",
        jobId,
        sourceResultJobId: moldResultJobId,
        expectedResultJobId: moldResultJobId,
        baseName: uploadedFile?.name ?? "split-model",
        result: workerResult,
      };
      workerRef.current.postMessage(
        request satisfies WorkerRequest,
        workerResult.parts.flatMap((part) => [
          part.mesh.positions.buffer,
          part.mesh.indices.buffer,
        ]),
      );
      return;
    }
    if (result.kind === "press-mold") {
      const workerResult: PressMoldGenerationResult = {
        ...result,
        die: {
          positions: result.die.positions.slice(),
          indices: result.die.indices.slice(),
        },
        piston: {
          positions: result.piston.positions.slice(),
          indices: result.piston.indices.slice(),
        },
      };
      const request: ExportPressMoldRequest = {
        version: WORKER_PROTOCOL_VERSION,
        type: "press.export",
        jobId,
        sourceResultJobId: moldResultJobId,
        expectedResultJobId: moldResultJobId,
        baseName: uploadedFile?.name ?? "press-mold",
        result: workerResult,
      };
      workerRef.current.postMessage(request satisfies WorkerRequest, [
        workerResult.die.positions.buffer,
        workerResult.die.indices.buffer,
        workerResult.piston.positions.buffer,
        workerResult.piston.indices.buffer,
      ]);
      return;
    }
    const workerResult: MoldGenerationResult = {
      ...result,
      front: {
        positions: result.front.positions.slice(),
        indices: result.front.indices.slice(),
      },
      back: {
        positions: result.back.positions.slice(),
        indices: result.back.indices.slice(),
      },
    };
    const request: ExportMoldRequest = {
      version: WORKER_PROTOCOL_VERSION,
      type: "mold.export",
      jobId,
      sourceResultJobId: moldResultJobId,
      expectedResultJobId: moldResultJobId,
      baseName: uploadedFile?.name ?? "two-part-mold",
      result: workerResult,
    };
    workerRef.current.postMessage(request satisfies WorkerRequest, [
      workerResult.front.positions.buffer,
      workerResult.front.indices.buffer,
      workerResult.back.positions.buffer,
      workerResult.back.indices.buffer,
    ]);
  }
  function downloadArtifact(artifact: ExportArtifact): void {
    try {
      const result = activeResult;
      if (
        !result ||
        !moldResultJobId ||
        !exportResult ||
        exportResult.sourceResultJobId !== moldResultJobId ||
        generatedMoldRef.current !== result
      ) {
        throw new Error("The mold result is no longer current.");
      }
      if (result.kind === "press-mold") assertDownloadablePressMold(result);
      else if (result.kind === "model-splitter")
        assertDownloadableModelSplitter(result);
      else assertDownloadableMold(result);
      const url = URL.createObjectURL(
        new Blob([artifact.data], { type: artifact.mimeType }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = artifact.fileName;
      document.body.append(anchor);
      anchor.click();
      setDownloadedFiles((current) => new Set(current).add(artifact.fileName));
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setExportResult(null);
      setJob({
        jobId: null,
        status: "error",
        progress: 0,
        message:
          error instanceof Error
            ? error.message
            : "The export file is no longer valid.",
      });
    }
  }

  function runKernelTest() {
    if (!workerRef.current || validation.length > 0) return;
    const jobId = crypto.randomUUID();
    coordinatorRef.current.start(jobId, "self-test");
    setJob({
      jobId,
      status: "running",
      progress: 0.04,
      message: "Preparing the job locally.",
    });
    const request: KernelSelfTestRequest = {
      version: WORKER_PROTOCOL_VERSION,
      type: "kernel.self-test",
      jobId,
    };
    workerRef.current.postMessage(request satisfies WorkerRequest);
  }

  function cancelJob() {
    if (!workerRef.current) return;
    const jobId = coordinatorRef.current.requestCancel();
    if (!jobId) return;
    setJob((current) => ({
      ...current,
      status: "cancelling",
      message: "Abbruch angefordert · Worker wird sicher neu gestartet.",
    }));
    const request: WorkerRequest = {
      version: WORKER_PROTOCOL_VERSION,
      type: "job.cancel",
      jobId,
    };
    workerRef.current.postMessage(request);
    restartWorkerRef.current();
    coordinatorRef.current.finish(jobId);
    setJob({
      jobId,
      status: "cancelled",
      progress: 0,
      message: "Local job was cancelled.",
    });
  }

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            LM
          </span>
          <div>
            <strong>Local Mold Studio</strong>
            <span>Browser-native fabrication</span>
          </div>
        </div>
        <div className="privacy-chip">
          <span aria-hidden="true">●</span> No uploads · no cloud
        </div>
      </header>

      <div className="workspace">
        <aside className="control-panel" aria-label="Fabrication settings">
          <div className="panel-intro">
            <span className="eyebrow">
              {moldType === "press"
                ? "Press mold"
                : moldType === "splitter"
                  ? "Model splitter"
                  : moldType === "silicone"
                    ? "Silicone box mold"
                    : "Two-part box mold"}
            </span>
            <h1>
              {moldType === "press"
                ? "Press mold, entirely local."
                : moldType === "splitter"
                  ? "Split a model into printable parts."
                  : moldType === "silicone"
                    ? "Silicone box mold, entirely local."
                    : "Two-part mold, entirely local."}
            </h1>
            <p>
              {moldType === "press"
                ? "Create a matched die and piston."
                : moldType === "splitter"
                  ? "Create watertight octants with glue-ready connectors."
                  : moldType === "silicone"
                    ? "Configure a reusable silicone casting mold."
                    : "Configure the mold."}{" "}
              Model and parameters stay in this browser.
            </p>
            <div
              className="segmented"
              role="group"
              aria-label="Fabrication tool"
            >
              <button
                type="button"
                className={moldType === "two-part" ? "active" : ""}
                aria-pressed={moldType === "two-part"}
                onClick={() => selectMoldType("two-part")}
              >
                Two-part Box
              </button>
              <button
                type="button"
                className={moldType === "press" ? "active" : ""}
                aria-pressed={moldType === "press"}
                onClick={() => selectMoldType("press")}
              >
                Press Mold
              </button>{" "}
              <button
                type="button"
                className={moldType === "splitter" ? "active" : ""}
                aria-pressed={moldType === "splitter"}
                onClick={() => selectMoldType("splitter")}
              >
                Model Splitter
              </button>
            </div>
          </div>

          <section className="control-section">
            <div className="section-heading">
              <span>01</span>
              <h2>Model</h2>
            </div>
            <label className="dropzone">
              <input
                type="file"
                accept=".stl,.obj,.3mf,model/stl,application/octet-stream"
                onChange={selectFile}
                disabled={!workerReady || jobBusy}
              />
              <span className="drop-icon" aria-hidden="true">
                +
              </span>
              <strong>
                {uploadedFile ? uploadedFile.name : "Choose 3D model"}
              </strong>
              <small>
                {uploadedFile
                  ? (uploadedFile.size / 1024 / 1024).toFixed(2) +
                    " MB · local validation"
                  : "STL · OBJ · 3MF · maximum 100 MB"}
              </small>
            </label>
            {job.status === "error" && !importResult ? (
              <p className="model-warning" role="alert">
                {job.message}
              </p>
            ) : null}
            <button
              type="button"
              className="secondary-wide offline-fixture"
              onClick={loadOfflineFixture}
              disabled={!workerReady || jobBusy}
            >
              Load built-in offline test model
            </button>
            <label className="unit-row">
              <span>Source file unit</span>
              <select
                value={sourceUnit}
                onChange={(event) => {
                  const unit = event.currentTarget.value as SourceUnit;
                  setSourceUnit(unit);
                  if (uploadedFile) {
                    void importFile(uploadedFile, unit, undefined, true);
                  }
                }}
                disabled={jobBusy}
              >
                <option value="auto">Automatic / millimeters</option>
                <option value="mm">Millimeters</option>
                <option value="cm">Centimeters</option>
                <option value="m">Meters</option>
                <option value="inch">Inches</option>
              </select>
            </label>
            {importSummary ? (
              <p className="import-summary">{importSummary}</p>
            ) : null}
            {memoryEstimate ? (
              <p
                className={
                  memoryEstimate.allowed ? "memory-note" : "model-warning"
                }
              >
                Estimated working memory:{" "}
                {formatBytes(memoryEstimate.estimatedPeakBytes)}
                {memoryEstimate.allowed
                  ? " · within the local budget"
                  : " · too large for this device"}
              </p>
            ) : null}
            {importResult?.diagnostics
              .filter((entry) => entry.severity === "warning")
              .map((entry) => (
                <p className="model-warning" key={entry.code}>
                  {entry.message}
                </p>
              ))}
          </section>

          <section className="control-section">
            <div className="section-heading">
              <span>02</span>
              <h2>Material & size</h2>
            </div>
            {moldType !== "press" && moldType !== "splitter" ? (
              <div className="segmented" aria-label="Casting material">
                {(Object.keys(MATERIAL_LABELS) as MoldMaterial[]).map(
                  (material) => (
                    <button
                      key={material}
                      type="button"
                      className={params.material === material ? "active" : ""}
                      aria-pressed={params.material === material}
                      onClick={() => selectMaterial(material)}
                    >
                      {MATERIAL_LABELS[material]}
                    </button>
                  ),
                )}
              </div>
            ) : null}
            <RangeRow
              label="Model scale"
              value={params.scalePercent}
              {...MOLD_LIMITS.scalePercent}
              unit="%"
              numberCommitOnly
              showSlider={false}
              onChange={changeModelScale}
            />
            {moldType === "two-part" ? (
              <>
                <RangeRow
                  label="Print walls"
                  value={params.wallLoops}
                  {...MOLD_LIMITS.wallLoops}
                  unit="walls"
                  digits={0}
                  onChange={(wallLoops) =>
                    changeParams((current) =>
                      updateParams(current, { wallLoops }),
                    )
                  }
                />
                <RangeRow
                  label="Cubic infill"
                  value={params.infillPercent}
                  {...MOLD_LIMITS.infillPercent}
                  unit="%"
                  digits={0}
                  onChange={(infillPercent) =>
                    changeParams((current) =>
                      updateParams(current, { infillPercent }),
                    )
                  }
                />
              </>
            ) : null}
            {placedBounds ? (
              <div className="model-dimensions">
                <div className="fixed-result">
                  <span>Model size</span>
                  <strong>Proportional</strong>
                </div>
                {moldType === "splitter" ? (
                  <RangeRow
                    label={
                      <>
                        Target figure height{" "}
                        <CoordinateAxis
                          axis={(["X", "Y", "Z"] as const)[figureHeightAxis]}
                        />
                      </>
                    }
                    value={placedBounds.size[figureHeightAxis]}
                    min={
                      (placedBounds.size[figureHeightAxis] /
                        (params.scalePercent / 100)) *
                      (MOLD_LIMITS.scalePercent.min / 100)
                    }
                    max={
                      (placedBounds.size[figureHeightAxis] /
                        (params.scalePercent / 100)) *
                      (MOLD_LIMITS.scalePercent.max / 100)
                    }
                    step={0.1}
                    digits={1}
                    unit="mm"
                    numberCommitOnly
                    showSlider={false}
                    onChange={(sizeMm) =>
                      changeModelDimension(figureHeightAxis, sizeMm)
                    }
                  />
                ) : null}
                {modelDimensionAxes.map((axis) => {
                  const axisLabel = (["X", "Y", "Z"] as const)[axis];
                  const unscaledSize =
                    placedBounds.size[axis] / (params.scalePercent / 100);
                  return (
                    <RangeRow
                      key={axisLabel}
                      label={
                        <>
                          Size <CoordinateAxis axis={axisLabel} />
                        </>
                      }
                      value={placedBounds.size[axis]}
                      min={unscaledSize * (MOLD_LIMITS.scalePercent.min / 100)}
                      max={unscaledSize * (MOLD_LIMITS.scalePercent.max / 100)}
                      step={0.1}
                      digits={1}
                      unit="mm"
                      numberCommitOnly
                      showSlider={false}
                      onChange={(sizeMm) => changeModelDimension(axis, sizeMm)}
                    />
                  );
                })}
              </div>
            ) : null}
            <p className="inline-note">
              {moldType === "press" ? (
                <>
                  For clay, soap, and pressed materials · PETG is a robust
                  starting point.
                </>
              ) : moldType === "splitter" ? (
                <>
                  The longest current model axis is detected as figure height.
                  Enter 1800 mm for a 1.80 m figure without accidentally scaling
                  a shorter source axis. Scale values up to 10,000% are
                  supported before automatic cut planning.
                </>
              ) : (
                <>
                  Preset: {preset.wallMm.toFixed(1)} mm wall · density{" "}
                  {preset.densityGPerMl.toFixed(1)} g/ml
                </>
              )}
            </p>
          </section>

          <section className="control-section">
            <div className="section-heading">
              <span>03</span>
              <h2>
                {moldType === "splitter"
                  ? "Orientation & split"
                  : "Orientation & seam"}
              </h2>
            </div>
            <div className="axis-row" role="group" aria-label="Up axis">
              {(["x", "y", "z"] as UpAxis[]).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  className={params.upAxis === axis ? "active" : ""}
                  aria-pressed={params.upAxis === axis}
                  onClick={() => selectUpAxis(axis)}
                >
                  <CoordinateAxis
                    axis={axis.toUpperCase() as CoordinateAxisName}
                  />{" "}
                  up
                </button>
              ))}
            </div>
            <button
              type="button"
              className="secondary-wide"
              onClick={autoOrient}
              disabled={!importResult || jobBusy}
            >
              Auto orient
            </button>
            <div className="fixed-result">
              <span>Model placement</span>
              <strong>Plate: Y = 0 mm</strong>
            </div>
            <RangeRow
              label={
                <>
                  Position <CoordinateAxis axis="X" />
                </>
              }
              value={placement.positionMm[0]}
              min={-150}
              max={150}
              step={1}
              unit="mm"
              onChange={(value) => changeModelPlacement("positionMm", 0, value)}
            />
            <RangeRow
              label={
                <>
                  Height <CoordinateAxis axis="Y" />
                </>
              }
              value={placement.positionMm[1]}
              min={0}
              max={150}
              step={1}
              unit="mm"
              onChange={(value) => changeModelPlacement("positionMm", 1, value)}
            />
            <RangeRow
              label={
                <>
                  Position <CoordinateAxis axis="Z" />
                </>
              }
              value={placement.positionMm[2]}
              min={-150}
              max={150}
              step={1}
              unit="mm"
              onChange={(value) => changeModelPlacement("positionMm", 2, value)}
            />
            <RangeRow
              label={
                <>
                  Rotation <CoordinateAxis axis="X" />
                </>
              }
              value={placement.rotationDeg[0]}
              min={-180}
              max={180}
              step={1}
              unit="°"
              onChange={(value) =>
                changeModelPlacement("rotationDeg", 0, value)
              }
            />
            <RangeRow
              label={
                <>
                  Rotation <CoordinateAxis axis="Y" />
                </>
              }
              value={placement.rotationDeg[1]}
              min={-180}
              max={180}
              step={1}
              unit="°"
              onChange={(value) =>
                changeModelPlacement("rotationDeg", 1, value)
              }
            />
            <RangeRow
              label={
                <>
                  Rotation <CoordinateAxis axis="Z" />
                </>
              }
              value={placement.rotationDeg[2]}
              min={-180}
              max={180}
              step={1}
              unit="°"
              onChange={(value) =>
                changeModelPlacement("rotationDeg", 2, value)
              }
            />
            <button
              type="button"
              className="secondary-wide"
              onClick={() => resetModelPlacement(false)}
              disabled={!importResult || jobBusy}
            >
              Center on plate
            </button>
            <button
              type="button"
              className="secondary-wide"
              onClick={() => resetModelPlacement(true)}
              disabled={!importResult || jobBusy}
            >
              Reset placement
            </button>
            {moldType === "splitter" ? (
              <>
                <div className="field-label">Automatic split grid</div>
                <div className="fixed-result">
                  <span>Print-bed proposal</span>
                  <strong>
                    {splitterPlan
                      ? `${splitterPlan.gridCounts.join(" × ")} = ${splitterPlan.partCount} part${splitterPlan.partCount === 1 ? "" : "s"}`
                      : "Load a model to calculate"}
                  </strong>
                </div>
                <p className="control-note">
                  The smallest fitting X/Y/Z grid is calculated from the model
                  and configured build volume. No fixed 8-part split is imposed;
                  large-job mode supports up to {MODEL_SPLITTER_MAX_PARTS} parts
                  with adaptive connector density.
                </p>{" "}
                {splitterPlan &&
                splitterPlan.partCount > 64 &&
                splitterConnectorPolicy ? (
                  <div className="fixed-result">
                    <span>Large-job stability mode</span>
                    <strong>
                      {splitterConnectorPolicy.maxPerInterface} connector
                      {splitterConnectorPolicy.maxPerInterface === 1
                        ? ""
                        : "s"}{" "}
                      per face max · simplified edges
                    </strong>
                  </div>
                ) : null}
                <div className="field-label">Cut planning</div>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Cut planning strategy"
                >
                  {(["smart", "automatic", "manual"] as const).map(
                    (splitStrategy) => (
                      <button
                        type="button"
                        key={splitStrategy}
                        className={
                          splitterParams.splitStrategy === splitStrategy
                            ? "active"
                            : ""
                        }
                        aria-pressed={
                          splitterParams.splitStrategy === splitStrategy
                        }
                        onClick={() => changeSplitterParams({ splitStrategy })}
                      >
                        {splitStrategy === "smart"
                          ? "Smart cut"
                          : splitStrategy === "automatic"
                            ? "Bed grid"
                            : "Adjust planes"}
                      </button>
                    ),
                  )}
                </div>
                <p className="control-note">
                  {splitterParams.splitStrategy === "smart"
                    ? "Stage 3 can angle compact joint planes to follow local neck, shoulder, hip, limb, and base transitions. Stage 2 still scores seam visibility, geometric shelter, support risk, slivers, balance, and safe bed-sized spans. Only shorter, balanced free planes are accepted; otherwise the proven X/Y/Z cut remains."
                    : splitterParams.splitStrategy === "automatic"
                      ? "Uses evenly spaced print-bed-sized cells without geometry optimization."
                      : "Uses the individual plane positions configured below."}
                </p>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={splitterParams.supportSavingCuts}
                    onChange={(event) =>
                      changeSplitterParams({
                        supportSavingCuts: event.currentTarget.checked,
                        ...(event.currentTarget.checked
                          ? { connectors: true }
                          : {}),
                      })
                    }
                  />
                  Add support-saving secondary cuts
                </label>
                <p className="control-note">
                  Re-splits rounded parts only when a larger stable print face
                  can be created. Every accepted cut receives a checked
                  male/female connector pair.
                </p>
                {splitterPlan ? (
                  <details className="advanced" open>
                    <summary>Cutline positions</summary>
                    <p className="control-note">
                      The colored lines are visible on the preview model. Moving
                      a line switches the plan to Adjust planes and preserves
                      every other calculated cut.
                    </p>
                    {splitterPlan.planes.map((plane) => {
                      const dimension =
                        plane.axis === "x" ? 0 : plane.axis === "y" ? 1 : 2;
                      const minimum =
                        (placedBounds?.min[dimension] ?? -100) + 0.5;
                      const maximum =
                        (placedBounds?.max[dimension] ?? 100) - 0.5;
                      return (
                        <RangeRow
                          key={plane.id}
                          label={
                            <>
                              Plane {plane.index} ·{" "}
                              <CoordinateAxis
                                axis={
                                  plane.axis.toUpperCase() as "X" | "Y" | "Z"
                                }
                              />
                            </>
                          }
                          value={plane.positionMm}
                          min={minimum}
                          max={Math.max(minimum, maximum)}
                          step={0.5}
                          digits={1}
                          unit="mm"
                          onChange={(value) =>
                            changeSplitterParams({
                              splitStrategy: "manual",
                              manualSplitPlaneMm: {
                                ...Object.fromEntries(
                                  splitterPlan.planes.map((currentPlane) => [
                                    currentPlane.id,
                                    currentPlane.positionMm,
                                  ]),
                                ),
                                ...splitterParams.manualSplitPlaneMm,
                                [plane.id]: value,
                              },
                            })
                          }
                        />
                      );
                    })}
                  </details>
                ) : null}
                <div className="field-label">Printer build volume</div>
                <RangeRow
                  label="Bed width"
                  value={splitterParams.printBedWidthMm}
                  {...MODEL_SPLITTER_LIMITS.printBedWidthMm}
                  digits={0}
                  unit="mm"
                  onChange={(printBedWidthMm) =>
                    changeSplitterParams({ printBedWidthMm })
                  }
                />
                <RangeRow
                  label="Bed depth"
                  value={splitterParams.printBedDepthMm}
                  {...MODEL_SPLITTER_LIMITS.printBedDepthMm}
                  digits={0}
                  unit="mm"
                  onChange={(printBedDepthMm) =>
                    changeSplitterParams({ printBedDepthMm })
                  }
                />
                <RangeRow
                  label="Build height"
                  value={splitterParams.printBedHeightMm}
                  {...MODEL_SPLITTER_LIMITS.printBedHeightMm}
                  digits={0}
                  unit="mm"
                  onChange={(printBedHeightMm) =>
                    changeSplitterParams({ printBedHeightMm })
                  }
                />
                <button
                  type="button"
                  className="secondary-wide"
                  onClick={() =>
                    changeSplitterParams({
                      printBedWidthMm: H2S_BUILD_VOLUME_MM[0],
                      printBedDepthMm: H2S_BUILD_VOLUME_MM[1],
                      printBedHeightMm: H2S_BUILD_VOLUME_MM[2],
                    })
                  }
                >
                  Reset H2S preset · 340 × 320 × 340 mm
                </button>
                {splitterResult ? (
                  <>
                    <div className="fixed-result">
                      <span>Applied cut planes</span>
                      <strong>
                        {splitterResult.features.splitPlanes
                          .map((plane) => {
                            const quality = plane.smartQuality;
                            const qualityLabel = quality
                              ? ` · hidden ${Math.round((1 - quality.seamExposureRatio) * 100)}% · support ${Math.round(quality.supportRiskRatio * 100)}%`
                              : "";
                            const freeLabel =
                              (plane.tiltDeg ?? 0) > 0.5
                                ? ` · free ${plane.tiltDeg?.toFixed(1)}°`
                                : "";
                            return `${plane.reason === "anatomical-joint" ? "Joint " : ""}${plane.axis.toUpperCase()}${plane.index} ${plane.positionMm.toFixed(1)} mm${freeLabel}${qualityLabel}`;
                          })
                          .join(" · ")}
                      </strong>
                    </div>
                    {splitterResult.features.partCount <
                    splitterResult.features.splitPlan.partCount ? (
                      <div className="fixed-result">
                        <span>Sparse model grid</span>
                        <strong>
                          {splitterResult.features.partCount} occupied of{" "}
                          {splitterResult.features.splitPlan.partCount} planned
                          cells · empty cells omitted
                        </strong>
                      </div>
                    ) : null}
                    <div className="fixed-result">
                      <span>Print-volume check</span>
                      <strong>
                        {splitterResult.features.splitPlan.fittingPartCount}/
                        {splitterResult.features.partCount} parts fit ·{" "}
                        {Math.round(
                          splitterResult.features.splitPlan.volumeBalanceRatio *
                            100,
                        )}
                        % balance
                      </strong>
                    </div>
                  </>
                ) : (
                  <div className="fixed-result">
                    <span>Proposal</span>
                    <strong>
                      {splitterPlan
                        ? `${splitterPlan.gridCounts.join(" × ")} = ${splitterPlan.partCount} parts`
                        : "Load a model"}
                    </strong>
                  </div>
                )}
                <p className="control-note">
                  Automatic planning chooses the smallest right-angle grid that
                  fits the configured build volume. Connector depth and
                  clearance are reserved in the calculation.
                </p>
              </>
            ) : (
              <>
                {" "}
                <RangeRow
                  label={
                    moldType === "press"
                      ? "Split plane offset"
                      : "Seam position"
                  }
                  value={
                    moldType === "press"
                      ? pressParams.seamOffsetMm
                      : params.seamOffsetMm
                  }
                  {...seamRange}
                  digits={1}
                  unit="mm"
                  onChange={(seamOffsetMm) =>
                    moldType === "press"
                      ? changePressParams({ seamOffsetMm })
                      : changeParams((current) =>
                          updateParams(current, { seamOffsetMm }),
                        )
                  }
                />
                {moldType === "press" ? (
                  <button
                    type="button"
                    className="secondary-wide"
                    onClick={() => changePressParams({ seamOffsetMm: 0 })}
                  >
                    Reset automatic split plane
                  </button>
                ) : null}
                {moldType === "press" ? (
                  <div className="fixed-result">
                    <span>Press pair</span>
                    <strong>Die + piston</strong>
                  </div>
                ) : (
                  <>
                    <div className="field-label">Mold pieces</div>
                    <div
                      className="segmented piece-count-segmented"
                      role="group"
                      aria-label="Mold piece count"
                    >
                      {([2, 4, 6, 8, "auto"] as const).map((pieceMode) => (
                        <button
                          type="button"
                          key={pieceMode}
                          className={
                            params.pieceMode === pieceMode ? "active" : ""
                          }
                          aria-pressed={params.pieceMode === pieceMode}
                          onClick={() =>
                            changeParams((current) =>
                              updateParams(current, { pieceMode }),
                            )
                          }
                        >
                          {pieceMode === "auto" ? "Auto" : `${pieceMode} parts`}
                        </button>
                      ))}
                    </div>
                    <p className="control-note">
                      Eight parts is the maximum. Auto increases the count only
                      for progressively deeper models.
                    </p>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        aria-label="Split oversized molds by height"
                        checked={params.splitOversizedByHeight}
                        onChange={(event) => {
                          const splitOversizedByHeight =
                            event.currentTarget.checked;
                          changeParams((current) =>
                            updateParams(current, { splitOversizedByHeight }),
                          );
                        }}
                      />
                      <span>
                        <strong>Split oversized molds by height</strong>
                        <small>
                          Adds only the height rows required by the configured
                          print volume.
                        </small>
                      </span>
                    </label>
                    {params.splitOversizedByHeight ? (
                      <>
                        <RangeRow
                          label="Print-bed width"
                          value={params.printBedWidthMm}
                          {...MOLD_LIMITS.printBedWidthMm}
                          unit="mm"
                          onChange={(printBedWidthMm) =>
                            changeParams((current) =>
                              updateParams(current, { printBedWidthMm }),
                            )
                          }
                        />
                        <RangeRow
                          label="Print-bed depth"
                          value={params.printBedDepthMm}
                          {...MOLD_LIMITS.printBedDepthMm}
                          unit="mm"
                          onChange={(printBedDepthMm) =>
                            changeParams((current) =>
                              updateParams(current, { printBedDepthMm }),
                            )
                          }
                        />
                        <RangeRow
                          label="Print height"
                          value={params.printBedHeightMm}
                          {...MOLD_LIMITS.printBedHeightMm}
                          unit="mm"
                          onChange={(printBedHeightMm) =>
                            changeParams((current) =>
                              updateParams(current, { printBedHeightMm }),
                            )
                          }
                        />
                        <button
                          type="button"
                          className="secondary-wide"
                          onClick={() =>
                            changeParams((current) =>
                              updateParams(current, {
                                printBedWidthMm: H2S_MOLD_BUILD_VOLUME_MM[0],
                                printBedDepthMm: H2S_MOLD_BUILD_VOLUME_MM[1],
                                printBedHeightMm: H2S_MOLD_BUILD_VOLUME_MM[2],
                              }),
                            )
                          }
                        >
                          Reset H2S · {H2S_MOLD_BUILD_VOLUME_MM.join(" × ")} mm
                        </button>
                      </>
                    ) : null}
                    <RangeRow
                      label="All hex connector width across flats"
                      value={params.segmentConnectorWidthMm}
                      {...MOLD_LIMITS.segmentConnectorWidthMm}
                      unit="mm"
                      digits={1}
                      onChange={(segmentConnectorWidthMm) =>
                        changeParams((current) =>
                          updateParams(current, { segmentConnectorWidthMm }),
                        )
                      }
                    />
                    <RangeRow
                      label="All hex connector insertion depth"
                      value={params.segmentConnectorDepthMm}
                      {...MOLD_LIMITS.segmentConnectorDepthMm}
                      unit="mm"
                      digits={1}
                      onChange={(segmentConnectorDepthMm) =>
                        changeParams((current) =>
                          updateParams(current, { segmentConnectorDepthMm }),
                        )
                      }
                    />
                    <p className="control-note">
                      These dimensions apply to the inner front/back seam and
                      every height or depth segment connection.
                    </p>
                    {moldResult ? (
                      <div className="fixed-result">
                        <span>Resolved split</span>
                        <strong>
                          {moldResult.resolvedPieceCount} parts ·{" "}
                          {moldResult.features.registration.count} inner +{" "}
                          {moldResult.features.segmentConnectors.count} segment
                          hex connectors
                        </strong>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            )}{" "}
          </section>

          <section className="control-section">
            <div className="section-heading">
              <span>04</span>
              <h2>
                {moldType === "splitter" ? "Connectors & filament" : "Mold"}
              </h2>
            </div>
            {moldType === "splitter" ? (
              <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={splitterParams.connectors}
                    onChange={(event) =>
                      changeSplitterParams({
                        connectors: event.currentTarget.checked,
                        ...(!event.currentTarget.checked
                          ? { supportSavingCuts: false }
                          : {}),
                      })
                    }
                  />
                  Add male and female connectors
                </label>
                <div className="field-label">Connector profile</div>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Connector profile"
                >
                  {(["hex", "pin", "dovetail"] as const).map(
                    (connectorStyle) => (
                      <button
                        type="button"
                        key={connectorStyle}
                        className={
                          splitterParams.connectorStyle === connectorStyle
                            ? "active"
                            : ""
                        }
                        aria-pressed={
                          splitterParams.connectorStyle === connectorStyle
                        }
                        onClick={() => changeSplitterParams({ connectorStyle })}
                      >
                        {connectorStyle === "hex"
                          ? "Hex (default)"
                          : connectorStyle === "pin"
                            ? "Round pin"
                            : "Dovetail snap-fit"}
                      </button>
                    ),
                  )}
                </div>
                <div className="field-label">Connector placement</div>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Connector placement"
                >
                  {(["automatic", "manual"] as const).map(
                    (connectorPlacement) => (
                      <button
                        type="button"
                        key={connectorPlacement}
                        className={
                          splitterParams.connectorPlacement ===
                          connectorPlacement
                            ? "active"
                            : ""
                        }
                        aria-pressed={
                          splitterParams.connectorPlacement ===
                          connectorPlacement
                        }
                        onClick={() =>
                          changeSplitterParams({ connectorPlacement })
                        }
                      >
                        {connectorPlacement === "automatic"
                          ? "Automatic grid"
                          : "Manual per face"}
                      </button>
                    ),
                  )}
                </div>
                {splitterParams.connectorPlacement === "manual" ? (
                  <details className="advanced" open>
                    <summary>Individual connector positions</summary>
                    {splitterInterfaceSlots.map(({ id, axis }) => {
                      const position = splitterParams
                        .manualConnectorPositionPercent[id] ?? [0, 0];
                      return (
                        <div key={id}>
                          <div className="field-label">
                            Connector {id.toUpperCase()} ·{" "}
                            <CoordinateAxis
                              axis={axis.toUpperCase() as "X" | "Y" | "Z"}
                            />{" "}
                            cut face
                          </div>
                          <RangeRow
                            label="Position U"
                            value={position[0]}
                            {...MODEL_SPLITTER_LIMITS.manualConnectorPercent}
                            digits={0}
                            unit="%"
                            onChange={(value) =>
                              changeSplitterParams({
                                manualConnectorPositionPercent: {
                                  ...splitterParams.manualConnectorPositionPercent,
                                  [id]: [value, position[1]],
                                },
                              })
                            }
                          />
                          <RangeRow
                            label="Position V"
                            value={position[1]}
                            {...MODEL_SPLITTER_LIMITS.manualConnectorPercent}
                            digits={0}
                            unit="%"
                            onChange={(value) =>
                              changeSplitterParams({
                                manualConnectorPositionPercent: {
                                  ...splitterParams.manualConnectorPositionPercent,
                                  [id]: [position[0], value],
                                },
                              })
                            }
                          />
                        </div>
                      );
                    })}
                    <p className="inline-note">
                      Manual mode uses one U/V point per mating face. Automatic
                      mode caps connectors at four times the configured diameter
                      and distributes compact pairs across very large faces.
                    </p>
                  </details>
                ) : null}
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={splitterParams.engravedLabels}
                    onChange={(event) =>
                      changeSplitterParams({
                        engravedLabels: event.currentTarget.checked,
                      })
                    }
                  />
                  Optional: drill assembly-code marks into mating faces (creates
                  unmatched recesses)
                </label>{" "}
                <RangeRow
                  label="Connector diameter"
                  value={splitterParams.connectorDiameterMm}
                  {...MODEL_SPLITTER_LIMITS.connectorDiameterMm}
                  digits={1}
                  unit="mm"
                  onChange={(connectorDiameterMm) =>
                    changeSplitterParams({ connectorDiameterMm })
                  }
                />
                <RangeRow
                  label="Connector depth"
                  value={splitterParams.connectorDepthMm}
                  {...MODEL_SPLITTER_LIMITS.connectorDepthMm}
                  digits={1}
                  unit="mm"
                  onChange={(connectorDepthMm) =>
                    changeSplitterParams({ connectorDepthMm })
                  }
                />
                <RangeRow
                  label="Print clearance"
                  value={splitterParams.connectorClearanceMm}
                  {...MODEL_SPLITTER_LIMITS.connectorClearanceMm}
                  digits={2}
                  unit="mm"
                  onChange={(connectorClearanceMm) =>
                    changeSplitterParams({ connectorClearanceMm })
                  }
                />{" "}
                <RangeRow
                  label="Connector spacing"
                  value={splitterParams.connectorSpacingMm}
                  {...MODEL_SPLITTER_LIMITS.connectorSpacingMm}
                  digits={0}
                  unit="mm"
                  onChange={(connectorSpacingMm) =>
                    changeSplitterParams({ connectorSpacingMm })
                  }
                />
                <RangeRow
                  label="Glue pocket"
                  value={splitterParams.gluePocketMm}
                  {...MODEL_SPLITTER_LIMITS.gluePocketMm}
                  digits={1}
                  unit="mm"
                  onChange={(gluePocketMm) =>
                    changeSplitterParams({ gluePocketMm })
                  }
                />
                <p className="inline-note">
                  Automatic diameter ranges from 1 to 120 mm and retries smaller
                  sizes when space is tight. Depth grows with large connectors
                  up to 80 mm while remaining limited by available material. One
                  safe large connector is preferred over several small ones.
                </p>
                {splitterResult ? (
                  <div className="fixed-result">
                    <span>Safe connectors</span>
                    <strong>
                      {splitterResult.features.connectors.length} placed
                      {splitterResult.features.skippedConnectorCount > 0
                        ? ` · ${splitterResult.features.skippedConnectorCount} skipped`
                        : ""}
                    </strong>
                  </div>
                ) : null}
                {splitterResult && splitterParams.supportSavingCuts ? (
                  <div className="fixed-result">
                    <span>Support-saving cuts</span>
                    <strong>
                      {splitterResult.features.supportSavingCutCount} accepted
                    </strong>
                  </div>
                ) : null}
                {splitterResult && splitterResult.features.partCount > 64 ? (
                  <div className="fixed-result">
                    <span>Adaptive connector policy</span>
                    <strong>
                      {splitterResult.features.connectorPolicy.maxPerInterface}{" "}
                      per face max ·{" "}
                      {splitterResult.features.connectorPolicy.totalBudget}{" "}
                      total budget
                    </strong>
                  </div>
                ) : null}
                <details className="advanced">
                  <summary>Filament estimate settings</summary>
                  <RangeRow
                    label="Lightning infill density"
                    value={splitterParams.infillPercent}
                    {...MODEL_SPLITTER_LIMITS.infillPercent}
                    digits={0}
                    unit="%"
                    onChange={(infillPercent) =>
                      changeSplitterParams({ infillPercent })
                    }
                  />
                  <div className="fixed-result">
                    <span>Wall assumption</span>
                    <strong>
                      {MODEL_SPLITTER_WALL_LOOPS} walls ×{" "}
                      {MODEL_SPLITTER_WALL_LINE_WIDTH_MM.toFixed(1)} mm ={" "}
                      {MODEL_SPLITTER_EFFECTIVE_SHELL_MM.toFixed(1)} mm
                    </strong>
                  </div>
                  <RangeRow
                    label="Filament diameter"
                    value={splitterParams.filamentDiameterMm}
                    {...MODEL_SPLITTER_LIMITS.filamentDiameterMm}
                    digits={2}
                    unit="mm"
                    onChange={(filamentDiameterMm) =>
                      changeSplitterParams({ filamentDiameterMm })
                    }
                  />
                  <RangeRow
                    label="Filament density"
                    value={splitterParams.filamentDensityGPerCm3}
                    {...MODEL_SPLITTER_LIMITS.filamentDensityGPerCm3}
                    digits={2}
                    unit="g/cm³"
                    onChange={(filamentDensityGPerCm3) =>
                      changeSplitterParams({ filamentDensityGPerCm3 })
                    }
                  />
                  <RangeRow
                    label="Waste allowance"
                    value={splitterParams.filamentWastePercent}
                    {...MODEL_SPLITTER_LIMITS.filamentWastePercent}
                    digits={0}
                    unit="%"
                    onChange={(filamentWastePercent) =>
                      changeSplitterParams({ filamentWastePercent })
                    }
                  />
                </details>
                {splitterResult ? (
                  <div className="fixed-result">
                    <span>Estimated filament</span>
                    <strong>
                      {splitterResult.features.filamentEstimate.estimatedLengthM.toFixed(
                        1,
                      )}{" "}
                      m ·{" "}
                      {splitterResult.features.filamentEstimate.estimatedMassG.toFixed(
                        0,
                      )}{" "}
                      g
                    </strong>
                  </div>
                ) : null}
                <p className="inline-note">
                  Estimate uses five 0.4 mm walls, Lightning infill, and waste
                  allowance. Your slicer remains authoritative for the exact
                  toolpath, supports, top/bottom layers, and purge.
                </p>{" "}
              </>
            ) : moldType !== "press" ? (
              <>
                <RangeRow
                  label="Pour hole Ø"
                  value={params.pourGates[0]?.diameterMm ?? 0}
                  {...MOLD_LIMITS.pourDiameterMm}
                  digits={1}
                  unit="mm"
                  onChange={(diameterMm) =>
                    changeParams((current) => ({
                      ...current,
                      pourGates: current.pourGates.map((gate) => ({
                        ...gate,
                        diameterMm,
                      })),
                    }))
                  }
                />
                <div className="count-row">
                  <span>Pour holes</span>
                  <div
                    className="mini-segmented"
                    role="group"
                    aria-label="Number of pour holes"
                  >
                    {[1, 2, 3, 4].map((count) => (
                      <button
                        key={count}
                        type="button"
                        className={
                          params.pourGates.length === count ? "active" : ""
                        }
                        aria-pressed={params.pourGates.length === count}
                        onClick={() =>
                          changeParams((current) =>
                            setPourGateCount(current, count),
                          )
                        }
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary-wide"
                  onClick={() =>
                    changeParams((current) => ({
                      ...current,
                      pourGates: current.pourGates.map((gate) => ({
                        ...gate,
                        placement: "auto",
                      })),
                    }))
                  }
                >
                  Distribute across separate high points
                </button>
                <p className="inline-note">
                  Local high points are selected automatically with spacing.
                  Changing X or Z switches that pour hole to manual.
                </p>

                <details className="advanced">
                  <summary>Advanced settings</summary>
                  {params.pourGates.map((gate, index) => (
                    <div className="gate-position" key={gate.id}>
                      <strong>
                        Gate {index + 1} ·{" "}
                        {gate.placement === "manual" ? "Manual" : "Automatic"}
                      </strong>
                      <RangeRow
                        label={
                          <>
                            Gate {index + 1} <CoordinateAxis axis="X" />
                          </>
                        }
                        value={gate.xMm}
                        {...MOLD_LIMITS.pourOffsetMm}
                        unit="mm"
                        onChange={(xMm) =>
                          changeParams((current) => ({
                            ...current,
                            pourGates: current.pourGates.map((item) =>
                              item.id === gate.id
                                ? { ...item, xMm, placement: "manual" }
                                : item,
                            ),
                          }))
                        }
                      />
                      <RangeRow
                        label={
                          <>
                            Gate {index + 1} <CoordinateAxis axis="Z" />
                          </>
                        }
                        value={gate.zMm}
                        {...MOLD_LIMITS.pourOffsetMm}
                        unit="mm"
                        onChange={(zMm) =>
                          changeParams((current) => ({
                            ...current,
                            pourGates: current.pourGates.map((item) =>
                              item.id === gate.id
                                ? { ...item, zMm, placement: "manual" }
                                : item,
                            ),
                          }))
                        }
                      />
                    </div>
                  ))}
                  <RangeRow
                    label="Wall thickness"
                    value={params.wallMm}
                    {...MOLD_LIMITS.wallMm}
                    digits={1}
                    unit="mm"
                    onChange={(wallMm) =>
                      changeParams((current) =>
                        updateParams(current, { wallMm }),
                      )
                    }
                  />
                  <RangeRow
                    label="Vent Ø"
                    value={params.ventDiameterMm}
                    {...MOLD_LIMITS.ventDiameterMm}
                    digits={1}
                    unit="mm"
                    onChange={(ventDiameterMm) =>
                      changeParams((current) =>
                        updateParams(current, { ventDiameterMm }),
                      )
                    }
                  />
                  <RangeRow
                    label="Fit clearance"
                    value={params.fitClearanceMm}
                    {...MOLD_LIMITS.fitClearanceMm}
                    digits={2}
                    unit="mm"
                    onChange={(fitClearanceMm) =>
                      changeParams((current) =>
                        updateParams(current, { fitClearanceMm }),
                      )
                    }
                  />
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={params.rubberBandGrooves}
                      onChange={(event) => {
                        const rubberBandGrooves = event.currentTarget.checked;
                        changeParams((current) =>
                          updateParams(current, { rubberBandGrooves }),
                        );
                      }}
                    />
                    Rubber-band grooves
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={params.pryPockets}
                      onChange={(event) => {
                        const pryPockets = event.currentTarget.checked;
                        changeParams((current) =>
                          updateParams(current, { pryPockets }),
                        );
                      }}
                    />
                    Pry pockets
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={params.closeNarrowOpenings}
                      onChange={(event) => {
                        const closeNarrowOpenings = event.currentTarget.checked;
                        changeParams((current) =>
                          updateParams(current, { closeNarrowOpenings }),
                        );
                      }}
                    />
                    Close narrow openings
                  </label>
                  {params.closeNarrowOpenings ? (
                    <>
                      <RangeRow
                        label="Minimum cavity detail"
                        value={params.narrowOpeningThresholdMm}
                        {...MOLD_LIMITS.narrowOpeningThresholdMm}
                        digits={1}
                        unit="mm"
                        onChange={(narrowOpeningThresholdMm) =>
                          changeParams((current) =>
                            updateParams(current, { narrowOpeningThresholdMm }),
                          )
                        }
                      />
                      <p className="model-warning" role="alert">
                        Warning: intentionally removes isolated narrow cavity
                        details below this size. Whiskers and other separate
                        thin components can disappear from the cast.
                      </p>
                    </>
                  ) : null}
                </details>
              </>
            ) : (
              <>
                <div className="count-row">
                  <span>Outer shape</span>
                  <div
                    className="mini-segmented"
                    role="group"
                    aria-label="Pressform-Outer shape"
                  >
                    {(["auto", "round", "rectangular"] as const).map(
                      (shape) => (
                        <button
                          key={shape}
                          type="button"
                          className={
                            pressParams.shape === shape ? "active" : ""
                          }
                          aria-pressed={pressParams.shape === shape}
                          onClick={() => changePressParams({ shape })}
                        >
                          {shape === "auto"
                            ? "Auto"
                            : shape === "round"
                              ? "Round"
                              : "Rectangular"}
                        </button>
                      ),
                    )}
                  </div>
                </div>
                <RangeRow
                  label="Wall thickness"
                  value={pressParams.wallMm}
                  {...PRESS_MOLD_LIMITS.wallMm}
                  digits={1}
                  unit="mm"
                  onChange={(wallMm) => changePressParams({ wallMm })}
                />
                <RangeRow
                  label="Fit clearance"
                  value={pressParams.fitClearanceMm}
                  {...PRESS_MOLD_LIMITS.fitClearanceMm}
                  digits={2}
                  unit="mm"
                  onChange={(fitClearanceMm) =>
                    changePressParams({ fitClearanceMm })
                  }
                />
                <RangeRow
                  label="Model padding"
                  value={pressParams.paddingMm}
                  {...PRESS_MOLD_LIMITS.paddingMm}
                  digits={1}
                  unit="mm"
                  onChange={(paddingMm) => changePressParams({ paddingMm })}
                />
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={pressParams.ejectorHole}
                    onChange={(event) =>
                      changePressParams({
                        ejectorHole: event.currentTarget.checked,
                      })
                    }
                  />
                  Ejector hole in die
                </label>
                <p className="inline-note">
                  Auto chooses a round press mold for an almost square
                  footprint, otherwise a rectangular one. Two opposing guide
                  rails and matching clearance grooves keep the die and piston
                  aligned during insertion.
                </p>
              </>
            )}
            {validation.length > 0 ? (
              <div className="validation-list" role="alert">
                {validation.map((issue) => (
                  <p key={issue.field + issue.message}>{issue.message}</p>
                ))}
              </div>
            ) : null}
          </section>
        </aside>

        <section className="stage-panel" aria-label="Local fabrication preview">
          <div className="stage-toolbar">
            <div>
              <span className="eyebrow">Local 3D preview</span>
              <strong>
                {activeResult
                  ? moldType === "press"
                    ? "Die & piston"
                    : moldType === "splitter"
                      ? `${splitterResult?.features.partCount ?? splitterPlan?.partCount ?? 1} split parts`
                      : "Mold halves"
                  : importResult
                    ? "Source model"
                    : "Ready to import"}
              </strong>
            </div>
            <span className="milestone-badge">
              {moldType === "splitter" ? "Package Q5" : "Package P"}
            </span>
          </div>
          <div className="viewport-card">
            <MoldViewer
              source={placedMesh}
              result={activeResult}
              seamX={seamX}
              seamAxis={
                moldType === "splitter"
                  ? "xyz"
                  : moldType === "press"
                    ? "y"
                    : "x"
              }
              splitCenter={moldType === "splitter" ? splitterCenter : undefined}
              splitAxes={moldType === "splitter" ? splitterAxes : undefined}
              splitPlanes={moldType === "splitter" ? splitterPlanes : undefined}
              modelViewKey={
                uploadedFile
                  ? `${uploadedFile.name}:${uploadedFile.size}:${uploadedFile.lastModified}`
                  : hasImportedMesh
                    ? "offline-test-model"
                    : "empty"
              }
              explode={explode}
              visibleParts={visibleParts}
              showCavity={showCavity}
              placement={placement}
              onPlacementChange={(nextPlacement) => {
                setPlacement(nextPlacement);
                invalidateGeneratedResult(
                  "Model placement changed · please generate the mold again.",
                );
              }}
            />
            <div className="view-caption">
              <span>
                {activeResult
                  ? moldType === "press"
                    ? "Print-ready die/piston geometry"
                    : moldType === "splitter"
                      ? `${splitterResult?.features.partCount ?? splitterPlan?.partCount ?? 1} watertight parts · centered origins · connector preview`
                      : "Actual front/back geometry"
                  : importResult
                    ? moldType === "splitter"
                      ? `${splitterAxes.map((axis) => axis.toUpperCase()).join("/")} split preview`
                      : "Model geometry · seam preview"
                    : "Local Three.js viewer"}
              </span>
              <span>
                X {placement.positionMm[0].toFixed(0)} · Y{" "}
                {placement.positionMm[1].toFixed(0)} · Z{" "}
                {placement.positionMm[2].toFixed(0)} mm · Seam{" "}
                {moldType === "splitter"
                  ? `${splitterAxes.map((axis) => axis.toUpperCase()).join("/")} planes`
                  : `${(moldType === "press" ? pressParams.seamOffsetMm : params.seamOffsetMm).toFixed(1)} mm`}
              </span>
            </div>
          </div>
          <div className="stage-controls">
            <div className="viewer-options">
              <div
                className="dark-segmented"
                role="group"
                aria-label="Visible fabrication parts"
              >
                {(["all", "front", "back"] as VisibleMoldParts[]).map(
                  (part) => (
                    <button
                      type="button"
                      key={part}
                      className={visibleParts === part ? "active" : ""}
                      aria-pressed={visibleParts === part}
                      onClick={() => setVisibleParts(part)}
                      disabled={!activeResult}
                    >
                      {part === "all"
                        ? "All"
                        : part === "front"
                          ? moldType === "press"
                            ? "Die"
                            : moldType === "splitter"
                              ? "Left"
                              : "Front"
                          : moldType === "press"
                            ? "Piston"
                            : moldType === "splitter"
                              ? "Right"
                              : "Back"}
                    </button>
                  ),
                )}
              </div>
              <label className="dark-check">
                <input
                  type="checkbox"
                  checked={showCavity}
                  onChange={(event) =>
                    setShowCavity(event.currentTarget.checked)
                  }
                  disabled={
                    !activeResult ||
                    moldType === "press" ||
                    moldType === "splitter"
                  }
                />
                {moldType === "press"
                  ? "Inspect parts separately"
                  : moldType === "splitter"
                    ? `${splitterResult?.features.partCount ?? splitterPlan?.partCount ?? 1} centered parts`
                    : "Cavity transparent"}
              </label>
            </div>
            <RangeRow
              label="Explosion view"
              value={explode}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={setExplode}
            />
          </div>
          {activeResult && activeOuterBounds ? (
            <div className="result-strip" aria-label="Fabrication result">
              <div className="result-metric-card">
                <span>
                  {activeResult.kind === "model-splitter"
                    ? "Model size"
                    : "Outer size"}
                </span>
                <strong>
                  {(
                    activeOuterBounds.max[0] - activeOuterBounds.min[0]
                  ).toFixed(1)}{" "}
                  ×{" "}
                  {(
                    activeOuterBounds.max[1] - activeOuterBounds.min[1]
                  ).toFixed(1)}{" "}
                  ×{" "}
                  {(
                    activeOuterBounds.max[2] - activeOuterBounds.min[2]
                  ).toFixed(1)}{" "}
                  mm
                </strong>
              </div>
              <div className="result-material-card">
                <span>
                  {activeResult.kind === "model-splitter"
                    ? "Split output"
                    : activeResult.kind === "press-mold"
                      ? "Model volume"
                      : "Material required"}
                </span>
                {activeResult.kind === "mold" ? (
                  <div className="material-result-values">
                    <strong>
                      <small>Filament</small>
                      {activeResult.features.materialEstimate.filament.estimatedMassG.toFixed(
                        0,
                      )}{" "}
                      g PETG
                    </strong>
                    <strong>
                      <small>Filling</small>
                      {activeResult.features.materialEstimate.filling.estimatedMassG.toFixed(
                        1,
                      )}{" "}
                      g{" "}
                      {
                        MATERIAL_LABELS[
                          activeResult.features.materialEstimate.filling
                            .material
                        ]
                      }
                      <em>
                        {activeResult.features.materialEstimate.filling.volumeMl.toFixed(
                          1,
                        )}{" "}
                        ml
                      </em>
                    </strong>
                  </div>
                ) : (
                  <strong>
                    {activeResult.kind === "model-splitter"
                      ? `${activeResult.features.partCount} parts · ${activeResult.features.filamentEstimate.estimatedLengthM.toFixed(1)} m · ${activeResult.features.filamentEstimate.estimatedMassG.toFixed(0)} g`
                      : `${(activeResult.features.cavityVolumeMm3 / 1000).toFixed(1)} ml`}
                  </strong>
                )}
              </div>
              <div className="result-metric-card">
                <span>
                  {activeResult.kind === "model-splitter"
                    ? "Connectors"
                    : activeResult.kind === "press-mold"
                      ? "Outer shape"
                      : "Min. wall"}
                </span>
                <strong>
                  {activeResult.kind === "model-splitter"
                    ? `${activeResult.features.connectors.length}/${activeResult.features.requestedConnectorCount} placed`
                    : activeResult.kind === "press-mold"
                      ? activeResult.features.shapeResolved === "round"
                        ? "Round"
                        : "Rectangular"
                      : activeResult.features.estimatedMinimumWallMm.toFixed(
                          2,
                        ) + " mm"}
                </strong>
              </div>
              <div className="result-metric-card print-bed-result-card">
                <span>Print bed</span>
                <strong>
                  {activeResult.kind === "model-splitter"
                    ? `${activeResult.features.splitPlan.fittingPartCount}/${activeResult.features.partCount} fit ${activeResult.features.splitPlan.buildVolumeMm.join(" × ")} mm`
                    : moldResult && moldType === "two-part"
                      ? `${moldResult.features.printVolume.fittingPartCount}/${moldResult.resolvedPieceCount} fit ${moldResult.features.printVolume.buildVolumeMm.join(" × ")} mm`
                      : commonPrintBedFits
                        ? "Fits 220 × 220 mm"
                        : "Check size: exceeds 220 × 220 mm"}
                </strong>
              </div>
            </div>
          ) : null}{" "}
          {activeResult ? (
            <div className="export-card" aria-label="Local export">
              <div>
                <span className="eyebrow">Print-ready files</span>
                <strong>
                  {exportResult
                    ? "Export package is ready"
                    : "Create files in the browser"}
                </strong>
                <p>
                  {moldType === "press"
                    ? "Binary STL for die and piston, combined 3MF, and ZIP with parameters."
                    : moldType === "splitter"
                      ? "Origin-centered STL parts, Bambu-compatible one-object plates, and ZIP with assembly notes."
                      : `${moldResult?.resolvedPieceCount ?? 2} individual STL parts, combined 3MF, and ZIP with parameters.`}
                </p>
                {exportResult ? (
                  <p className="download-progress" aria-live="polite">
                    {downloadedArtifactCount} of {downloadableArtifacts.length}{" "}
                    files downloaded
                  </p>
                ) : null}
              </div>
              {exportResult ? (
                <div className="export-actions">
                  {exportResult.kind === "press-mold-export" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => downloadArtifact(exportResult.dieStl)}
                      >
                        <DownloadButtonLabel
                          label="Die STL"
                          downloaded={downloadedFiles.has(
                            exportResult.dieStl.fileName,
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadArtifact(exportResult.pistonStl)}
                      >
                        <DownloadButtonLabel
                          label="Piston STL"
                          downloaded={downloadedFiles.has(
                            exportResult.pistonStl.fileName,
                          )}
                        />
                      </button>
                    </>
                  ) : (
                    <>
                      {exportResult.partStls.map((artifact) => (
                        <button
                          type="button"
                          key={artifact.fileName}
                          onClick={() => downloadArtifact(artifact)}
                        >
                          <DownloadButtonLabel
                            label={`${artifact.fileName.replace(exportResult.baseName, "").replace(/^[-_]/, "").replace(".stl", "")} STL`}
                            downloaded={downloadedFiles.has(artifact.fileName)}
                          />
                        </button>
                      ))}
                    </>
                  )}
                  {exportResult.kind === "model-splitter-export" ? (
                    exportResult.plateThreeMfs.map((artifact, index) => (
                      <button
                        type="button"
                        key={artifact.fileName}
                        onClick={() => downloadArtifact(artifact)}
                      >
                        <DownloadButtonLabel
                          label={`3MF project ${index + 1}/${exportResult.plateThreeMfs.length}`}
                          downloaded={downloadedFiles.has(artifact.fileName)}
                        />
                      </button>
                    ))
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        downloadArtifact(exportResult.combinedThreeMf)
                      }
                    >
                      <DownloadButtonLabel
                        label="3MF"
                        downloaded={downloadedFiles.has(
                          exportResult.combinedThreeMf.fileName,
                        )}
                      />
                    </button>
                  )}{" "}
                  <button
                    type="button"
                    className="export-primary"
                    onClick={() =>
                      downloadArtifact(exportResult.printPackageZip)
                    }
                  >
                    <DownloadButtonLabel
                      label={
                        moldType === "splitter"
                          ? "Assembly package ZIP"
                          : "Print package ZIP"
                      }
                      downloaded={downloadedFiles.has(
                        exportResult.printPackageZip.fileName,
                      )}
                    />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="export-build"
                  onClick={runExportPackage}
                  disabled={jobBusy}
                >
                  Create export package
                </button>
              )}
            </div>
          ) : null}
          <div className={"job-card " + job.status} aria-live="polite">
            <div className="job-copy">
              <span className="status-dot" aria-hidden="true" />
              <div>
                <strong>Client-only Pipeline</strong>
                <p>{job.message}</p>
                {job.detail ? (
                  <p className="job-detail">Technical detail: {job.detail}</p>
                ) : null}
                {job.status === "error" && job.hint ? (
                  <p className="job-hint">
                    <strong>How to fix:</strong> {job.hint}
                  </p>
                ) : null}
              </div>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Local job progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(job.progress * 100)}
            >
              <span style={{ width: job.progress * 100 + "%" }} />
            </div>
            <div className="job-actions">
              <button
                type="button"
                className="primary-action"
                onClick={runMoldGeneration}
                disabled={
                  !workerReady ||
                  !hasImportedMesh ||
                  jobBusy ||
                  !importResult?.moldReady ||
                  validation.length > 0 ||
                  memoryEstimate?.allowed === false
                }
              >
                {activeResult
                  ? moldType === "press"
                    ? "Regenerate press mold"
                    : moldType === "splitter"
                      ? splitterParams.splitStrategy === "smart"
                        ? "Regenerate smart split"
                        : "Regenerate bed-grid split"
                      : moldType === "silicone"
                        ? "Regenerate silicone box mold"
                        : "Regenerate mold"
                  : moldType === "press"
                    ? "Generate press mold"
                    : moldType === "splitter"
                      ? splitterParams.splitStrategy === "smart"
                        ? "Generate smart split"
                        : "Generate bed-grid split"
                      : moldType === "silicone"
                        ? "Generate silicone box mold"
                        : "Generate two-part mold"}
              </button>
              {jobBusy ? (
                <button
                  type="button"
                  className="quiet-action"
                  onClick={cancelJob}
                  disabled={job.status === "cancelling"}
                >
                  {job.status === "cancelling" ? "Cancelling…" : "Cancel"}
                </button>
              ) : (
                <>
                  {uploadedFile ? (
                    <button
                      type="button"
                      className="quiet-action"
                      onClick={() => void importFile(uploadedFile)}
                    >
                      Revalidate model
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="quiet-action"
                    onClick={runKernelTest}
                    disabled={!workerReady || jobBusy}
                  >
                    Check kernel
                  </button>
                </>
              )}
            </div>
          </div>
          <footer className="stage-footer">
            <span>No API</span>
            <span>No account</span>
            <span>Worker-based</span>
            <span>
              {runtimeCapabilities.mode === "single-thread-fallback"
                ? "Single-thread fallback"
                : "Isolated worker"}
            </span>
            <span>
              {offlineStatus === "ready"
                ? "Offline app ready"
                : offlineStatus === "development"
                  ? "Offline in production bundle"
                  : offlineStatus === "preparing"
                    ? "Preparing offline app"
                    : "Offline app unavailable"}
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}

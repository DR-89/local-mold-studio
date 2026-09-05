import type { MoldGenerationResult } from "../../geometry/mold/types";
import type { PressMoldGenerationResult } from "../../geometry/press-mold/types";
import type { ModelSplitterGenerationResult } from "../../geometry/model-splitter/types";

export type MoldExportErrorCode =
  | "STALE_RESULT"
  | "INVALID_EXPORT_TOPOLOGY"
  | "EXPORT_FAILED";

export class MoldExportError extends Error {
  constructor(
    readonly code: MoldExportErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "MoldExportError";
  }
}

export type MoldExportRequestData = {
  sourceResultJobId: string;
  expectedResultJobId: string;
  baseName: string;
  result: MoldGenerationResult;
};

export type ExportArtifact = {
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
};

export type MoldExportResult = {
  kind: "mold-export";
  sourceResultJobId: string;
  baseName: string;
  frontStl: ExportArtifact;
  backStl: ExportArtifact;
  partStls: ExportArtifact[];
  combinedThreeMf: ExportArtifact;
  printPackageZip: ExportArtifact;
  totalBytes: number;
};
export type PressMoldExportRequestData = {
  sourceResultJobId: string;
  expectedResultJobId: string;
  baseName: string;
  result: PressMoldGenerationResult;
};

export type PressMoldExportResult = {
  kind: "press-mold-export";
  sourceResultJobId: string;
  baseName: string;
  dieStl: ExportArtifact;
  pistonStl: ExportArtifact;
  combinedThreeMf: ExportArtifact;
  printPackageZip: ExportArtifact;
  totalBytes: number;
};
export type ModelSplitterExportRequestData = {
  sourceResultJobId: string;
  expectedResultJobId: string;
  baseName: string;
  result: ModelSplitterGenerationResult;
};

export type ModelSplitterExportResult = {
  kind: "model-splitter-export";
  sourceResultJobId: string;
  baseName: string;
  partStls: ExportArtifact[];
  plateThreeMfs: ExportArtifact[];
  combinedThreeMf: ExportArtifact;
  printPackageZip: ExportArtifact;
  totalBytes: number;
};

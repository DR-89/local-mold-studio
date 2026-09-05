import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { createDefaultParams } from "../../src/domain/mold";
import { generateTwoPartMold } from "../../src/geometry/mold";
import { buildMoldExportPackage, sanitizeExportBaseName } from "../../src/io/export";
import { importAndNormalizeMesh } from "../../src/io/import";
import { indexedCube } from "../../src/testing/fixtures";

function asArrayBuffer(data: ArrayBuffer): ArrayBuffer {
  return data.slice(0);
}

describe("local mold export", () => {
  it("sanitizes file names deterministically", () => {
    expect(sanitizeExportBaseName("  Kerze ÄÖ / final.stl ")).toBe(
      "Kerze-AO-final",
    );
    expect(sanitizeExportBaseName("../../...")).toBe("two-part-mold");
    expect(sanitizeExportBaseName("a".repeat(100))).toHaveLength(64);
  });

  it("roundtrips both binary STL files and the combined 3MF", async () => {
    const mold = await generateTwoPartMold(
      indexedCube(20),
      createDefaultParams(),
    );
    const exported = buildMoldExportPackage({
      sourceResultJobId: "result-1",
      expectedResultJobId: "result-1",
      baseName: "Test Kerze.stl",
      result: mold,
    });

    const front = await importAndNormalizeMesh(
      asArrayBuffer(exported.frontStl.data),
      {
        fileName: exported.frontStl.fileName,
        upAxis: "y",
        scalePercent: 100,
        sourceUnit: "mm",
      },
    );
    const back = await importAndNormalizeMesh(
      asArrayBuffer(exported.backStl.data),
      {
        fileName: exported.backStl.fileName,
        upAxis: "y",
        scalePercent: 100,
        sourceUnit: "mm",
      },
    );
    expect(front.measurements.volumeMm3).toBeCloseTo(
      mold.frontMetrics.volumeMm3,
      1,
    );
    expect(back.measurements.volumeMm3).toBeCloseTo(
      mold.backMetrics.volumeMm3,
      1,
    );
    expect(front.measurements.bounds.min).toEqual(
      mold.frontMetrics.bounds.min,
    );
    expect(back.measurements.bounds.min).toEqual(
      mold.backMetrics.bounds.min,
    );

    const combined = await importAndNormalizeMesh(
      asArrayBuffer(exported.combinedThreeMf.data),
      {
        fileName: exported.combinedThreeMf.fileName,
        upAxis: "y",
        scalePercent: 100,
        sourceUnit: "auto",
      },
    );
    expect(combined.measurements.componentCount).toBe(2);
    expect(combined.measurements.volumeMm3).toBeCloseTo(
      mold.frontMetrics.volumeMm3 + mold.backMetrics.volumeMm3,
      1,
    );
    expect(exported.combinedThreeMf.fileName).toBe("Test-Kerze.3mf");
  });

  it("embeds the strength profile only in the two-part box 3MF", async () => {
    const params = createDefaultParams();
    params.infillPercent = 30;
    params.wallLoops = 6;
    const mold = await generateTwoPartMold(indexedCube(20), params);
    const exported = buildMoldExportPackage({
      sourceResultJobId: "box-profile",
      expectedResultJobId: "box-profile",
      baseName: "box profile",
      result: mold,
    });
    const project = unzipSync(new Uint8Array(exported.combinedThreeMf.data));
    const settings = JSON.parse(new TextDecoder().decode(
      project["Metadata/project_settings.config"],
    )) as Record<string, unknown>;

    expect(settings).toMatchObject({
      sparse_infill_pattern: "cubic",
      sparse_infill_density: "30%",
      wall_loops: "6",
      top_shell_layers: "4",
      bottom_shell_layers: "4",
      filament_type: ["PETG"],
      enable_support: "0",
    });

    const archive = unzipSync(new Uint8Array(exported.printPackageZip.data));
    const notes = new TextDecoder().decode(archive["PRINT_NOTES.txt"]);
    const manifest = new TextDecoder().decode(archive["parameters.json"]);
    expect(notes).toContain("PRINT SETTINGS · TWO-PART BOX ONLY");
    expect(notes).toContain("0.4 mm / 0.28 mm");
    expect(notes).toContain("30% cubic");
    expect(notes).toContain("Walls (perimeters): 6");
    expect(notes).toContain("Estimated print filament:");
    expect(notes).toContain("Estimated filling material: 7.2 g wax");
    expect(notes).toContain("5 across 4 sides per horizontal interface");
    expect(manifest).toContain("two-part-box-only");
    expect(manifest).toContain('"schema": "local-mold-studio/export-v10"');
    expect(manifest).toContain('"infillPercent": 30');
    expect(manifest).toContain('"walls": 6');
    expect(notes).toContain("Inner seam connectors: 6 hex");
    expect(manifest).toContain('"materialEstimate"');
  });

  it("exports every mold segment as an independently selectable, bed-oriented 3MF object", async () => {
    const mold = await generateTwoPartMold(indexedCube(20), createDefaultParams());
    const exported = buildMoldExportPackage({
      sourceResultJobId: "box-objects",
      expectedResultJobId: "box-objects",
      baseName: "box objects",
      result: mold,
    });
    const project = unzipSync(new Uint8Array(exported.combinedThreeMf.data));
    const decoder = new TextDecoder();
    const modelSettings = decoder.decode(project["Metadata/model_settings.config"]);
    const coreModel = decoder.decode(project["3D/3dmodel.model"]);
    const manifest = JSON.parse(decoder.decode(
      unzipSync(new Uint8Array(exported.printPackageZip.data))["parameters.json"],
    )) as { parts: Record<string, { plateNumber: number; translationMm: number[]; rotationMatrix: number[] }> };
    expect(modelSettings.match(/<object id="\d+">/g)).toHaveLength(2);
    expect(modelSettings.match(/<model_instance>/g)).toHaveLength(2);
    expect(coreModel.match(/<item objectid="\d+"/g)).toHaveLength(2);
    expect(Object.values(manifest.parts)).toHaveLength(2);
    for (const part of Object.values(manifest.parts)) {
      expect(part.plateNumber).toBeGreaterThanOrEqual(1);
      expect(part.translationMm).toHaveLength(3);
      expect(part.rotationMatrix).toHaveLength(9);
    }
  });

  it("exports four, six, and eight individual STL parts and matching 3MF components", async () => {
    for (const pieceMode of [4, 6, 8] as const) {
      const mold = await generateTwoPartMold(indexedCube(40), {
        ...createDefaultParams(),
        pieceMode,
      });
      const exported = buildMoldExportPackage({
        sourceResultJobId: `parts-${pieceMode}`,
        expectedResultJobId: `parts-${pieceMode}`,
        baseName: `${pieceMode} part`,
        result: mold,
      });
      expect(exported.partStls).toHaveLength(pieceMode);
      const archive = unzipSync(new Uint8Array(exported.printPackageZip.data));
      expect(Object.keys(archive).filter((name) => name.endsWith(".stl"))).toHaveLength(pieceMode);
      const combined = await importAndNormalizeMesh(
        asArrayBuffer(exported.combinedThreeMf.data),
        {
          fileName: exported.combinedThreeMf.fileName,
          upAxis: "y",
          scalePercent: 100,
          sourceUnit: "auto",
        },
      );
      expect(combined.measurements.componentCount).toBe(pieceMode);
    }
  });  it("builds a complete local ZIP without remote references", async () => {
    const mold = await generateTwoPartMold(
      indexedCube(20),
      createDefaultParams("resin"),
    );
    const exported = buildMoldExportPackage({
      sourceResultJobId: "result-zip",
      expectedResultJobId: "result-zip",
      baseName: "resin mold",
      result: mold,
    });
    const archive = unzipSync(new Uint8Array(exported.printPackageZip.data));
    expect(Object.keys(archive).sort()).toEqual([
      "PRINT_NOTES.txt",
      "parameters.json",
      "resin-mold-back.stl",
      "resin-mold-front.stl",
      "resin-mold.3mf",
    ]);
    const decoder = new TextDecoder();
    const manifest = decoder.decode(archive["parameters.json"]);
    const notes = decoder.decode(archive["PRINT_NOTES.txt"]);
    expect(manifest).toContain('"sourceResultJobId": "result-zip"');
    expect(manifest).toContain('"unit": "millimeter"');
    expect(notes).toContain("generated entirely locally in the browser");
    expect(manifest + notes).not.toMatch(/https?:\/\//i);
  });

  it("rejects stale ids and invalid topology before writing files", async () => {
    const mold = await generateTwoPartMold(
      indexedCube(20),
      createDefaultParams(),
    );
    expect(() =>
      buildMoldExportPackage({
        sourceResultJobId: "old",
        expectedResultJobId: "new",
        baseName: "stale",
        result: mold,
      }),
    ).toThrow(/no longer current/);

    const invalid = {
      ...mold,
      frontMetrics: { ...mold.frontMetrics, closed: false },
    };
    expect(() =>
      buildMoldExportPackage({
        sourceResultJobId: "current",
        expectedResultJobId: "current",
        baseName: "invalid",
        result: invalid,
      }),
    ).toThrow(/topology validation/);
  });
  it("roundtrips a complete press mold package without remote references", async () => {
    const { createDefaultPressMoldParams } = await import("../../src/domain/press-mold");
    const { generatePressMold } = await import("../../src/geometry/press-mold");
    const { buildPressMoldExportPackage } = await import("../../src/io/export");
    const press = await generatePressMold(indexedCube(20), createDefaultPressMoldParams());
    const exported = buildPressMoldExportPackage({
      sourceResultJobId: "press-1",
      expectedResultJobId: "press-1",
      baseName: "test press",
      result: press,
    });
    const die = await importAndNormalizeMesh(asArrayBuffer(exported.dieStl.data), {
      fileName: exported.dieStl.fileName,
      upAxis: "y",
      scalePercent: 100,
      sourceUnit: "mm",
    });
    const piston = await importAndNormalizeMesh(asArrayBuffer(exported.pistonStl.data), {
      fileName: exported.pistonStl.fileName,
      upAxis: "y",
      scalePercent: 100,
      sourceUnit: "mm",
    });
    expect(die.measurements.volumeMm3).toBeCloseTo(press.dieMetrics.volumeMm3, 1);
    expect(piston.measurements.volumeMm3).toBeCloseTo(press.pistonMetrics.volumeMm3, 1);
    const archive = unzipSync(new Uint8Array(exported.printPackageZip.data));
    expect(Object.keys(archive).sort()).toEqual([
      "PRINT_NOTES.txt",
      "parameters.json",
      "test-press-die.stl",
      "test-press-piston.stl",
      "test-press.3mf",
    ]);
    const content = new TextDecoder().decode(archive["parameters.json"]) +
      new TextDecoder().decode(archive["PRINT_NOTES.txt"]);
    expect(content).toContain("Die and piston");
    expect(content).toContain('"guideRails"');
    expect(content).toContain("align both guide grooves with the rails");
    expect(content).not.toMatch(/https?:\/\//i);
  });
});

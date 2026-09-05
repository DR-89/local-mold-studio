import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createDefaultModelSplitterParams } from "../../src/domain/model-splitter";
import { generateModelSplitter } from "../../src/geometry/model-splitter";
import {
  manifoldToTriangleMesh,
  splitMeshIntoConnectedComponents,
} from "../../src/geometry/kernel/adapter";
import { loadManifold } from "../../src/geometry/kernel/loader";
import { buildModelSplitterExportPackage } from "../../src/io/export";
import {
  encodeMultiPlateThreeMf,
  recommendThreeMfPrintProfile,
} from "../../src/io/export/three-mf";
import { importAndNormalizeMesh } from "../../src/io/import";
import { indexedCube } from "../../src/testing/fixtures";

function copyBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

describe("model splitter export", () => {
  it("exports automatic grid names, centered STL files, 3MF, and a local ZIP", async () => {
    const params = createDefaultModelSplitterParams();
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    params.engravedLabels = false;
    const result = await generateModelSplitter(indexedCube(110), params);
    result.features.splitPlanes[0]!.smartQuality = {
      seamExposureRatio: 0.25,
      geometryShelterRatio: 0.5,
      supportRiskRatio: 0.1,
    };
    result.features.splitPlanes[0]!.normal = [0.985, 0.174, 0];
    result.features.splitPlanes[0]!.planeOffsetMm = 1.25;
    result.features.splitPlanes[0]!.tiltDeg = 10;
    const exported = buildModelSplitterExportPackage({
      sourceResultJobId: "split-1",
      expectedResultJobId: "split-1",
      baseName: "ModelName.3mf",
      result,
    });
    expect(exported.partStls).toHaveLength(8);
    expect(exported.plateThreeMfs).toHaveLength(1);
    expect(exported.combinedThreeMf).toBe(exported.plateThreeMfs[0]);
    expect(exported.partStls.map((part) => part.fileName)).toContain(
      "ModelName_x02_y02_z02.stl",
    );
    for (const artifact of exported.partStls) {
      const imported = await importAndNormalizeMesh(copyBuffer(artifact.data), {
        fileName: artifact.fileName,
        upAxis: "y",
        scalePercent: 100,
        sourceUnit: "mm",
      });
      for (let axis = 0; axis < 3; axis += 1) {
        expect(
          imported.measurements.bounds.min[axis] +
            imported.measurements.bounds.max[axis],
        ).toBeCloseTo(0, 3);
      }
    }
    const combinedArchive = unzipSync(
      new Uint8Array(exported.combinedThreeMf.data),
    );
    const coreModel = new TextDecoder().decode(
      combinedArchive["3D/3dmodel.model"],
    );
    const modelSettings = new TextDecoder().decode(
      combinedArchive["Metadata/model_settings.config"],
    );
    const projectSettings = JSON.parse(
      new TextDecoder().decode(
        combinedArchive["Metadata/project_settings.config"],
      ),
    ) as Record<string, string | string[]>;
    expect(coreModel).toContain('unit="millimeter"');
    expect(coreModel).toContain(
      '<metadata name="Application">BambuStudio-02.08.02.61</metadata>',
    );
    expect(coreModel).toContain(
      '<metadata name="Generator">Local Mold Studio</metadata>',
    );
    expect(coreModel.match(/<object id="\d+"/g)).toHaveLength(8);
    expect(
      coreModel.match(/<item objectid="\d+"[^>]* transform="[^"]+"/g),
    ).toHaveLength(8);
    expect(coreModel.match(/p:UUID="[^"]+"/g)?.length).toBeGreaterThanOrEqual(
      17,
    );
    const embeddedModels = Object.keys(combinedArchive).filter((name) =>
      /^3D\/Objects\/object_\d+\.model$/.test(name),
    );
    expect(embeddedModels).toHaveLength(8);
    const modelRelationships = new TextDecoder().decode(
      combinedArchive["3D/_rels/3dmodel.model.rels"],
    );
    expect(modelRelationships.match(/<Relationship /g)).toHaveLength(8);
    expect(modelSettings).not.toContain("<assemble_item");
    for (let index = 0; index < 8; index += 1) {
      const meshId = index * 2 + 1;
      const objectId = meshId + 1;
      expect(coreModel).toContain(`<object id="${objectId}"`);
      expect(coreModel).toContain(
        `p:path="/3D/Objects/object_${meshId}.model" objectid="${meshId}"`,
      );
      expect(coreModel).toContain(`<item objectid="${objectId}"`);
      expect(modelRelationships).toContain(
        `Target="/3D/Objects/object_${meshId}.model"`,
      );
      expect(modelSettings).toContain(`<object id="${objectId}">`);
      expect(modelSettings).toContain(`<part id="${meshId}"`);
      expect(modelSettings).toContain(
        `<metadata key="object_id" value="${objectId}"/>`,
      );
      const embeddedModel = new TextDecoder().decode(
        combinedArchive[`3D/Objects/object_${meshId}.model`],
      );
      expect(embeddedModel).toContain(`<object id="${meshId}"`);
      expect(embeddedModel).toContain("<mesh>");
    }
    expect(modelSettings.match(/<plate>/g)).toHaveLength(1);
    expect(modelSettings.match(/<model_instance>/g)).toHaveLength(8);
    expect(projectSettings).toMatchObject({
      sparse_infill_pattern: "lightning",
      version: "02.08.02.61",
      printer_technology: "FFF",
      printable_area: ["0x0", "340x0", "340x320", "0x320"],
      printable_height: "340",
      sparse_infill_density: "8%",
      wall_loops: "3",
      wall_generator: "arachne",
      top_shell_layers: "3",
      bottom_shell_layers: "3",
      printer_model: "Bambu Lab H2S",
      printer_variant: "0.6",
      printer_settings_id: "Bambu Lab H2S 0.6 nozzle",
      nozzle_diameter: ["0.6"],
      layer_height: "0.36",
      initial_layer_print_height: "0.3",
      line_width: "0.63",
      initial_layer_line_width: "0.75",
      outer_wall_line_width: "0.63",
      inner_wall_line_width: "0.675",
      sparse_infill_line_width: "0.675",
      enable_support: "1",
      support_type: "tree(auto)",
      support_style: "tree_organic",
      support_on_build_plate_only: "0",
      support_threshold_angle: "55",
      support_interface_top_layers: "2",
      support_interface_bottom_layers: "1",
      support_top_z_distance: "0.3",
      support_bottom_z_distance: "0.3",
      support_object_xy_distance: "0.35",
      brim_type: "auto_brim",
      seam_position: "aligned",
      outer_wall_speed: ["100"],
      inner_wall_speed: ["150"],
      sparse_infill_speed: ["200"],
      travel_speed: ["300"],
    });

    const archive = unzipSync(new Uint8Array(exported.printPackageZip.data));
    expect(
      Object.keys(archive).filter((name) => name.endsWith(".stl")),
    ).toHaveLength(8);
    const manifest = new TextDecoder().decode(archive["parameters.json"]);
    const notes = new TextDecoder().decode(archive["ASSEMBLY_NOTES.txt"]);
    expect(manifest).toContain('"centeredOrigins": true');
    expect(manifest).toContain("model-splitter-export-v31");
    expect(manifest).toContain('"gridCounts"');
    expect(manifest).toContain('"seamExposureRatio": 0.25');
    expect(manifest).toContain('"geometryShelterRatio": 0.5');
    expect(manifest).toContain('"supportRiskRatio": 0.1');
    expect(manifest).toContain('"assemblyCenterMm"');
    expect(manifest).toContain('"buildVolumeMm"');
    expect(manifest).toContain('"normal": [');
    expect(manifest).toContain('"planeOffsetMm": 1.25');
    expect(manifest).toContain('"tiltDeg": 10');
    expect(manifest).toContain('"plateNumber"');
    expect(manifest).toContain('"plateTranslationMm"');
    expect(manifest).toContain('"plateProjects"');
    expect(manifest).toContain(
      '"plateOrder": "strict vertical layers Y01 to Ynn, then ascending lowest model Y"',
    );
    expect(manifest).toContain('"printSequence"');
    expect(manifest).toContain('"printSequenceNumber"');
    expect(manifest).toContain('"plateProjectFile"');
    expect(notes).toContain("Base grid: 2 x 2 x 2 = 8 primary cells");
    expect(notes).toContain("free 10.0 deg, normal 0.985/0.174/0.000");
    expect(notes).toContain("hidden 75%, shelter 50%, support risk 10%");
    expect(notes).toContain("male hex pegs and female hex sockets");
    expect(notes).toContain("one consistent male side and one female side");
    expect(notes).toContain("Lightning infill");
    expect(notes).toContain("0.6 mm nozzle, 0.36 mm layers");
    expect(notes).toContain("3 walls, 8% Lightning infill, Arachne walls");
    expect(notes).toContain(
      "automatic organic tree supports everywhere (55 degree threshold)",
    );
    expect(notes).toContain("small objects are packed collision-free");
    expect(notes).toContain("all Y01 parts first, then Y02");
    expect(manifest + notes).not.toContain("http");
  });

  it("packs 180 small parts onto shared H2S plates", async () => {
    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 50;
    params.printBedDepthMm = 50;
    params.printBedHeightMm = 50;
    const kernel = await loadManifold();
    const solid = kernel.Manifold.cube([200, 250, 250], true);
    const mesh = manifoldToTriangleMesh(solid);
    solid.delete();
    const result = await generateModelSplitter(mesh, params);
    const exported = buildModelSplitterExportPackage({
      sourceResultJobId: "split-180",
      expectedResultJobId: "split-180",
      baseName: "LargeModel.stl",
      result,
    });
    expect(exported.partStls).toHaveLength(180);
    expect(exported.partStls.at(-1)?.fileName).toBe(
      "LargeModel_x05_y06_z06.stl",
    );
    expect(exported.plateThreeMfs.map((artifact) => artifact.fileName)).toEqual(
      [
        "LargeModel_split_plates_001-036.3mf",
        "LargeModel_split_plates_037-072.3mf",
        "LargeModel_split_plates_073-108.3mf",
        "LargeModel_split_plates_109-144.3mf",
        "LargeModel_split_plates_145-180.3mf",
      ],
    );
    let exportedPlateCount = 0;
    for (const project of exported.plateThreeMfs) {
      const projectArchive = unzipSync(new Uint8Array(project.data));
      const coreModel = new TextDecoder().decode(
        projectArchive["3D/3dmodel.model"],
      );
      const modelSettings = new TextDecoder().decode(
        projectArchive["Metadata/model_settings.config"],
      );
      const objectCount = coreModel.match(/<object id="\d+"/g)?.length ?? 0;
      const embeddedModelCount = Object.keys(projectArchive).filter((name) =>
        /^3D\/Objects\/object_\d+\.model$/.test(name),
      ).length;
      const plates = modelSettings.match(/<plate>.*?<\/plate>/gs) ?? [];
      expect(objectCount).toBeLessThanOrEqual(36);
      expect(embeddedModelCount).toBe(objectCount);
      expect(plates.length).toBeLessThan(objectCount);
      for (const plate of plates) {
        const instanceCount = plate.match(/<model_instance>/g)?.length ?? 0;
        expect(instanceCount).toBeGreaterThanOrEqual(1);
        expect(instanceCount).toBeLessThanOrEqual(36);
      }
      const projectSettings = JSON.parse(
        new TextDecoder().decode(
          projectArchive["Metadata/project_settings.config"],
        ),
      ) as Record<string, string | string[]>;
      expect(projectSettings.printable_area).toEqual([
        "0x0",
        "340x0",
        "340x320",
        "0x320",
      ]);
      expect(projectSettings.printable_height).toBe("340");
      exportedPlateCount += plates.length;
    }
    expect(exportedPlateCount).toBe(5);
    const archive = unzipSync(new Uint8Array(exported.printPackageZip.data));
    expect(
      Object.keys(archive).filter((name) => name.endsWith(".stl")),
    ).toHaveLength(180);
    expect(
      Object.keys(archive).filter((name) => name.endsWith(".3mf")),
    ).toHaveLength(5);
    const manifest = JSON.parse(
      new TextDecoder().decode(archive["parameters.json"]),
    ) as {
      plateProjects: Array<{
        firstPart: number;
        lastPart: number;
        plateCount: number;
      }>;
      printSequence: Array<{
        sequence: number;
        partId: string;
        assemblyCenterMm: [number, number, number];
        assemblyBottomMm: number;
        verticalLayer: number;
        projectFile: string;
        plateNumber: number;
      }>;
      parts: Record<string, { plateProjectFile: string; plateNumber: number }>;
    };
    expect(manifest.plateProjects).toHaveLength(5);
    expect(manifest.plateProjects[0]).toMatchObject({
      firstPart: 1,
      lastPart: 36,
      plateCount: 1,
    });
    expect(manifest.plateProjects.at(-1)).toMatchObject({
      firstPart: 145,
      lastPart: 180,
      plateCount: 1,
    });
    expect(manifest.printSequence).toHaveLength(180);
    expect(manifest.printSequence[0]).toMatchObject({
      sequence: 1,
      plateNumber: 1,
      verticalLayer: 1,
      partId: expect.stringContaining("_y01_"),
    });
    expect(manifest.printSequence.at(-1)).toMatchObject({
      sequence: 180,
      projectFile: "LargeModel_split_plates_145-180.3mf",
      plateNumber: 1,
    });
    for (let index = 1; index < manifest.printSequence.length; index += 1) {
      const previous = manifest.printSequence[index - 1]!;
      const current = manifest.printSequence[index]!;
      expect(current.verticalLayer).toBeGreaterThanOrEqual(
        previous.verticalLayer,
      );
      if (current.verticalLayer === previous.verticalLayer) {
        expect(current.assemblyBottomMm).toBeGreaterThanOrEqual(
          previous.assemblyBottomMm,
        );
      }
      expect(current.partId).toContain(
        `_y${String(current.verticalLayer).padStart(2, "0")}_`,
      );
    }
  });
  it("selects the nozzle and fixed layer height from the complete source size", () => {
    expect(recommendThreeMfPrintProfile([80, 40, 20])).toMatchObject({
      nozzleDiameterMm: 0.2,
      layerHeightMm: 0.1,
    });
    expect(recommendThreeMfPrintProfile([350, 100, 100])).toMatchObject({
      nozzleDiameterMm: 0.4,
      layerHeightMm: 0.2,
    });
    expect(recommendThreeMfPrintProfile([1_000, 300, 300])).toMatchObject({
      nozzleDiameterMm: 0.6,
      layerHeightMm: 0.3,
    });
    expect(recommendThreeMfPrintProfile([1_800, 500, 500])).toEqual({
      nozzleDiameterMm: 0.8,
      layerHeightMm: 0.4,
      supportType: "tree(auto)",
      supportStyle: "tree_organic",
    });
  });
  it("writes a complete valid H2S 0.8 mm profile with no missing line widths", () => {
    const encoded = encodeMultiPlateThreeMf(
      [{ mesh: indexedCube(20), name: "LargePart" }],
      {
        title: "Large H2S part",
        buildVolumeMm: [340, 320, 340],
        sourceSizeMm: [1_800, 500, 500],
        lightningInfillPercent: 15,
        wallLoops: 5,
      },
    );
    const archive = unzipSync(encoded.archive);
    const settings = JSON.parse(
      new TextDecoder().decode(archive["Metadata/project_settings.config"]),
    ) as Record<string, string | string[]>;

    expect(settings).toMatchObject({
      printer_model: "Bambu Lab H2S",
      printer_variant: "0.8",
      printer_settings_id: "Bambu Lab H2S 0.8 nozzle",
      nozzle_diameter: ["0.8"],
      min_layer_height: ["0.16"],
      max_layer_height: ["0.6"],
      layer_height: "0.4",
      line_width: "0.84",
      initial_layer_line_width: "1",
      outer_wall_line_width: "0.84",
      inner_wall_line_width: "0.9",
      sparse_infill_line_width: "0.9",
      skeleton_infill_line_width: "0.9",
      skin_infill_line_width: "0.9",
      internal_solid_infill_line_width: "0.84",
      top_surface_line_width: "0.84",
      support_line_width: "0.84",
    });
  });
  it("automatically exports very large split figures with the 0.8 mm organic-tree profile", async () => {
    const params = createDefaultModelSplitterParams();
    params.engravedLabels = false;
    params.printBedWidthMm = 80;
    params.printBedDepthMm = 80;
    params.printBedHeightMm = 80;
    const result = await generateModelSplitter(indexedCube(120), params);
    result.features.sourceBounds = {
      min: [0, 0, 0],
      max: [1_800, 500, 500],
    };
    const exported = buildModelSplitterExportPackage({
      sourceResultJobId: "large-profile",
      expectedResultJobId: "large-profile",
      baseName: "LargeFigure.3mf",
      result,
    });
    const archive = unzipSync(new Uint8Array(exported.combinedThreeMf.data));
    const settings = JSON.parse(
      new TextDecoder().decode(archive["Metadata/project_settings.config"]),
    ) as Record<string, string | string[]>;

    expect(settings).toMatchObject({
      printer_variant: "0.8",
      print_settings_id: "0.40mm Local Mold Studio LARGE FAST @BBL H2S",
      nozzle_diameter: ["0.8"],
      layer_height: "0.4",
      initial_layer_print_height: "0.4",
      sparse_infill_pattern: "lightning",
      sparse_infill_density: "15%",
      wall_loops: "3",
      top_shell_layers: "3",
      bottom_shell_layers: "3",
      wall_generator: "arachne",
      enable_support: "1",
      support_type: "tree(auto)",
      support_style: "tree_organic",
      support_threshold_angle: "60",
      support_interface_top_layers: "2",
      support_interface_bottom_layers: "0",
      support_top_z_distance: "0.4",
      support_bottom_z_distance: "0.4",
      support_base_pattern_spacing: "6",
      support_interface_spacing: "0.7",
      support_critical_regions_only: "1",
      minimum_sparse_infill_area: "30",
      resolution: "0.04",
    });
  });
  it("places every Bambu project object inside its own world-space plate", async () => {
    const kernel = await loadManifold();
    const solid = kernel.Manifold.cube([20, 20, 20], true);
    const mesh = manifoldToTriangleMesh(solid);
    solid.delete();
    const parts = Array.from({ length: 4 }, (_, index) => ({
      mesh,
      name: `PlatePart${index + 1}`,
    }));
    const encoded = encodeMultiPlateThreeMf(parts, {
      title: "Four physical plates",
      buildVolumeMm: [100, 80, 100],
      sourceSizeMm: [20, 20, 20],
      lightningInfillPercent: 15,
      wallLoops: 5,
    });
    const archive = unzipSync(encoded.archive);
    const coreModel = new TextDecoder().decode(archive["3D/3dmodel.model"]);
    const translations = [
      ...coreModel.matchAll(/<item objectid="\d+"[^>]* transform="([^"]+)"/g),
    ].map((match) => match[1].split(" ").map(Number).slice(9, 12));

    expect(translations).toEqual([
      [50, 40, 10],
      [170, 40, 10],
      [50, -56, 10],
      [170, -56, 10],
    ]);
    expect(new Set(translations.map(([x, y]) => `${x}:${y}`))).toHaveLength(4);
    expect(
      encoded.placements.map((placement) => placement.translationMm),
    ).toEqual(translations);
  });
  it("packs small objects together on one collision-free plate", async () => {
    const kernel = await loadManifold();
    const solid = kernel.Manifold.cube([20, 20, 20], true);
    const mesh = manifoldToTriangleMesh(solid);
    solid.delete();
    const parts = Array.from({ length: 4 }, (_, index) => ({
      mesh,
      name: `SmallPart${index + 1}`,
    }));
    const encoded = encodeMultiPlateThreeMf(parts, {
      title: "Packed small parts",
      buildVolumeMm: [100, 80, 100],
      sourceSizeMm: [20, 20, 20],
      lightningInfillPercent: 15,
      wallLoops: 5,
      packSmallParts: true,
    });
    const archive = unzipSync(encoded.archive);
    const modelSettings = new TextDecoder().decode(
      archive["Metadata/model_settings.config"],
    );
    const plates = modelSettings.match(/<plate>.*?<\/plate>/gs) ?? [];

    expect(encoded.plateCount).toBe(1);
    expect(
      encoded.placements.map((placement) => placement.plateNumber),
    ).toEqual([1, 1, 1, 1]);
    expect(
      new Set(
        encoded.placements.map(({ translationMm: [x, y] }) => `${x}:${y}`),
      ).size,
    ).toBe(4);
    for (const placement of encoded.placements) {
      const [x, y] = placement.translationMm;
      const [width, depth] = placement.orientedSizeMm;
      expect(x - width / 2).toBeGreaterThanOrEqual(10);
      expect(x + width / 2).toBeLessThanOrEqual(90);
      expect(y - depth / 2).toBeGreaterThanOrEqual(10);
      expect(y + depth / 2).toBeLessThanOrEqual(70);
    }
    expect(plates).toHaveLength(1);
    expect(plates[0]?.match(/<model_instance>/g)).toHaveLength(4);
  });
  it("collects tiny parts across interleaved large parts and connector flags", async () => {
    const kernel = await loadManifold();
    const tinySolid = kernel.Manifold.cube([20, 20, 20], true);
    const largeSolid = kernel.Manifold.cube([180, 180, 60], true);
    const tinyMesh = manifoldToTriangleMesh(tinySolid);
    const largeMesh = manifoldToTriangleMesh(largeSolid);
    tinySolid.delete();
    largeSolid.delete();

    const encoded = encodeMultiPlateThreeMf(
      [
        { mesh: tinyMesh, name: "TinyA", forceOwnPlate: true },
        { mesh: largeMesh, name: "LargeA", forceOwnPlate: true },
        { mesh: tinyMesh, name: "TinyB", forceOwnPlate: true },
        { mesh: largeMesh, name: "LargeB", forceOwnPlate: true },
        { mesh: tinyMesh, name: "TinyC", forceOwnPlate: true },
      ],
      {
        title: "Interleaved tiny parts",
        buildVolumeMm: [340, 320, 340],
        sourceSizeMm: [180, 180, 60],
        lightningInfillPercent: 8,
        wallLoops: 3,
        packSmallParts: true,
      },
    );

    expect(encoded.plateCount).toBe(3);
    expect(
      encoded.placements.map((placement) => placement.plateNumber),
    ).toEqual([1, 2, 1, 3, 1]);
    const archive = unzipSync(encoded.archive);
    const modelSettings = new TextDecoder().decode(
      archive["Metadata/model_settings.config"],
    );
    const plates = modelSettings.match(/<plate>.*?<\/plate>/gs) ?? [];
    expect(plates).toHaveLength(3);
    expect(plates[0]?.match(/<model_instance>/g)).toHaveLength(3);
  });
  it("opens each plate in the flattest fitting right-angle orientation without scaling", async () => {
    const kernel = await loadManifold();
    const solid = kernel.Manifold.cube([20, 120, 40], true);
    const mesh = manifoldToTriangleMesh(solid);
    solid.delete();

    const encoded = encodeMultiPlateThreeMf([{ mesh, name: "TallPart" }], {
      title: "Optimized plate",
      buildVolumeMm: [150, 100, 100],
      sourceSizeMm: [20, 120, 40],
      lightningInfillPercent: 15,
      wallLoops: 5,
    });
    expect(encoded.placements[0]).toMatchObject({
      plateNumber: 1,
      orientedSizeMm: [120, 40, 20],
      bedContactAreaMm2: 4800,
    });
    const archive = unzipSync(encoded.archive);
    const coreModel = new TextDecoder().decode(archive["3D/3dmodel.model"]);
    const transform = coreModel
      .match(/<item objectid="\d+"[^>]* transform="([^"]+)"/)?.[1]
      .split(" ")
      .map(Number);
    expect(transform).toHaveLength(12);
    const rotation = transform?.slice(0, 9) ?? [];
    expect(rotation.every((value) => [-1, 0, 1].includes(value))).toBe(true);
    expect(rotation.filter((value) => Math.abs(value) === 1)).toHaveLength(3);
    const translation = transform?.slice(9, 12) ?? [];
    const transformedPoints: Array<[number, number, number]> = [];
    for (let offset = 0; offset < mesh.positions.length; offset += 3) {
      const point = [
        mesh.positions[offset] ?? 0,
        mesh.positions[offset + 1] ?? 0,
        mesh.positions[offset + 2] ?? 0,
      ];
      transformedPoints.push([
        point[0] * (rotation[0] ?? 0) +
          point[1] * (rotation[3] ?? 0) +
          point[2] * (rotation[6] ?? 0) +
          (translation[0] ?? 0),
        point[0] * (rotation[1] ?? 0) +
          point[1] * (rotation[4] ?? 0) +
          point[2] * (rotation[7] ?? 0) +
          (translation[1] ?? 0),
        point[0] * (rotation[2] ?? 0) +
          point[1] * (rotation[5] ?? 0) +
          point[2] * (rotation[8] ?? 0) +
          (translation[2] ?? 0),
      ]);
    }
    const xs = transformedPoints.map((point) => point[0]);
    const ys = transformedPoints.map((point) => point[1]);
    const zs = transformedPoints.map((point) => point[2]);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(150);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });
  it("exports disconnected bodies as selectable objects and shares plates for small connector-free pieces", async () => {
    // Two pillars joined only by a bridge at the top, plus a paper-thin shard
    // floating in the gap. The horizontal cut below the bridge leaves one grid
    // cell holding two real bodies and the shard. They must remain one logical
    // print-bed segment, one STL, and one plate instead of becoming _sNN files.
    const params = createDefaultModelSplitterParams();
    params.connectors = false;
    params.engravedLabels = false;
    params.printBedWidthMm = 60;
    params.printBedDepthMm = 60;
    params.printBedHeightMm = 60;
    const kernel = await loadManifold();
    const leftPillar = kernel.Manifold.cube([20, 100, 20], true).translate([
      -15, 0, 0,
    ]);
    const rightPillar = kernel.Manifold.cube([20, 100, 20], true).translate([
      15, 0, 0,
    ]);
    const bridge = kernel.Manifold.cube([50, 20, 20], true).translate([
      0, 40, 0,
    ]);
    const shard = kernel.Manifold.cube([6, 0.05, 4], true).translate([
      0, -20, 0,
    ]);
    const solid = kernel.Manifold.union([
      leftPillar,
      rightPillar,
      bridge,
      shard,
    ]);
    const mesh = manifoldToTriangleMesh(solid);
    for (const item of [leftPillar, rightPillar, bridge, shard, solid])
      item.delete();

    const result = await generateModelSplitter(mesh, params);
    const looseParts = result.parts.filter(
      (part) => splitMeshIntoConnectedComponents(part.mesh).length > 1,
    );
    expect(looseParts.length).toBeGreaterThan(0);

    const exported = buildModelSplitterExportPackage({
      sourceResultJobId: "split-loose",
      expectedResultJobId: "split-loose",
      baseName: "Bridged",
      result,
    });
    expect(exported.partStls.length).toBeGreaterThan(result.parts.length);
    expect(
      exported.partStls.some((artifact) =>
        /_b\d+\.stl$/i.test(artifact.fileName),
      ),
    ).toBe(true);

    let plateCount = 0;
    for (const project of exported.plateThreeMfs) {
      const projectArchive = unzipSync(new Uint8Array(project.data));
      const modelSettings = new TextDecoder().decode(
        projectArchive["Metadata/model_settings.config"],
      );
      const plates = modelSettings.match(/<plate>.*?<\/plate>/gs) ?? [];
      expect(
        plates.some(
          (plate) => (plate.match(/<model_instance>/g)?.length ?? 0) > 1,
        ),
      ).toBe(true);
      plateCount += plates.length;
    }
    expect(plateCount).toBeLessThan(exported.partStls.length);

    const archive = unzipSync(new Uint8Array(exported.printPackageZip.data));
    const manifest = JSON.parse(
      new TextDecoder().decode(archive["parameters.json"]),
    ) as {
      pieceCount: number;
      separatedBodyCount: number;
      weldedFragmentCount: number;
      onePiecePerPlate: boolean;
      parts: Record<
        string,
        {
          sourcePartId: string;
          volumeMm3: number;
          plateNumber: number;
        }
      >;
    };
    expect(manifest.onePiecePerPlate).toBe(false);
    expect(manifest.pieceCount).toBe(exported.partStls.length);
    expect(plateCount).toBeLessThanOrEqual(exported.partStls.length);
    expect(manifest.separatedBodyCount).toBe(
      exported.partStls.length - result.parts.length,
    );
    expect(manifest.weldedFragmentCount).toBeGreaterThanOrEqual(1);
    for (const entry of Object.values(manifest.parts)) {
      expect(entry.volumeMm3).toBeGreaterThan(25);
    }
    const loosePartId = looseParts[0]!.id;
    const loosePieces = Object.values(manifest.parts).filter(
      (entry) => entry.sourcePartId === loosePartId,
    );
    expect(loosePieces.length).toBeGreaterThan(1);
    expect(new Set(loosePieces.map((entry) => entry.plateNumber)).size).toBe(1);

    // Nothing was thrown away: the pieces still add up to the original volume.
    const exportedVolume = Object.values(manifest.parts).reduce(
      (sum, entry) => sum + entry.volumeMm3,
      0,
    );
    const sourceVolume = result.parts.reduce(
      (sum, part) => sum + part.metrics.volumeMm3,
      0,
    );
    expect(exportedVolume).toBeCloseTo(sourceVolume, 1);
  });
  it("rejects stale export ids", async () => {
    const result = await generateModelSplitter(
      indexedCube(24),
      createDefaultModelSplitterParams(),
    );
    expect(() =>
      buildModelSplitterExportPackage({
        sourceResultJobId: "old",
        expectedResultJobId: "new",
        baseName: "stale",
        result,
      }),
    ).toThrow(/no longer current/);
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { offlineCubeAsciiStl } from "../../src/offline/fixture";
import { importAndNormalizeMesh } from "../../src/io/import";

const projectRoot = path.resolve(import.meta.dirname, "../..");

describe("offline application shell", () => {
  it("uses a same-origin-only service worker and installable manifest", async () => {
    const serviceWorker = await readFile(
      path.join(projectRoot, "public", "sw.js"),
      "utf8",
    );
    const manifest = JSON.parse(
      await readFile(
        path.join(projectRoot, "public", "manifest.webmanifest"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(serviceWorker).toContain("url.origin !== self.location.origin");
    expect(serviceWorker).toContain("discoverAssetUrls");
    expect(serviceWorker).not.toMatch(/https?:\/\//i);
    expect(manifest).toMatchObject({
      name: "Local Mold Studio",
      start_url: "./",
      scope: "./",
      display: "standalone",
    });
  });

  it("generates the bundled fixture deterministically and imports it in mm", async () => {
    const first = offlineCubeAsciiStl();
    const second = offlineCubeAsciiStl();
    expect(new Uint8Array(first)).toEqual(new Uint8Array(second));
    const imported = await importAndNormalizeMesh(first, {
      fileName: "offline-testmodell.stl",
      upAxis: "y",
      scalePercent: 100,
      sourceUnit: "mm",
    });
    expect(imported.measurements.bounds.size).toEqual([20, 20, 20]);
    expect(imported.measurements.triangles).toBe(12);
    expect(imported.measurements.volumeMm3).toBeCloseTo(8_000, 3);
  });
});

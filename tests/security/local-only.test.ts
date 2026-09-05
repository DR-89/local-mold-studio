import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const guardedRoots = ["app", "src"];
const forbidden = [
  /https?:\/\//i,
  /wss?:\/\//i,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsendBeacon\b/,
];

const allowedThreeMfNamespaces = [
  "http://schemas.microsoft.com/3dmanufacturing/core/2015/02",
  "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel",
  "http://schemas.microsoft.com/3dmanufacturing/production/2015/06",
  "http://schemas.bambulab.com/package/2021",
  "http://schemas.openxmlformats.org/package/2006/content-types",
  "http://schemas.openxmlformats.org/package/2006/relationships",
];

function sourceWithoutNonTransportNamespaces(
  file: string,
  source: string,
): string {
  if (!file.endsWith(path.join("src", "io", "export", "three-mf.ts"))) {
    return source;
  }
  return allowedThreeMfNamespaces.reduce(
    (result, namespace) => result.replaceAll(namespace, "3mf-namespace"),
    source,
  );
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await sourceFiles(fullPath)));
    else if (/\.(?:ts|tsx|js|jsx|css)$/.test(entry.name)) result.push(fullPath);
  }
  return result;
}

describe("local-only source boundary", () => {
  it("contains no remote transport in application or geometry sources", async () => {
    const files = (
      await Promise.all(
        guardedRoots.map((root) => sourceFiles(path.join(projectRoot, root))),
      )
    ).flat();
    const violations: string[] = [];
    for (const file of files) {
      const source = sourceWithoutNonTransportNamespaces(
        file,
        await readFile(file, "utf8"),
      );
      for (const pattern of forbidden) {
        if (pattern.test(source)) {
          violations.push(
            `${path.relative(projectRoot, file)} matches ${pattern}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not define application API routes", async () => {
    const files = await sourceFiles(path.join(projectRoot, "app"));
    expect(
      files.filter((file) => /[\\/]route\.(?:ts|tsx|js|jsx)$/.test(file)),
    ).toEqual([]);
  });
});

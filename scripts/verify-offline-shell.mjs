import { access, readFile } from "node:fs/promises";
import path from "node:path";

const clientRoot = path.resolve("dist/client");
const serviceWorkerPath = path.join(clientRoot, "sw.js");
const manifestPath = path.join(clientRoot, "manifest.webmanifest");
await access(serviceWorkerPath);
await access(manifestPath);
const serviceWorker = await readFile(serviceWorkerPath, "utf8");
if (
  !serviceWorker.includes("cacheAppShell") ||
  !serviceWorker.includes("discoverAssetUrls")
) {
  throw new Error(
    "Der Offline-App-Shell wurde nicht vollständig in den Build übernommen.",
  );
}
console.log(
  "Offline-App-Shell und Web-App-Manifest sind im Produktions-Build enthalten.",
);

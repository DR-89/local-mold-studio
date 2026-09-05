import createManifoldModule, {
  type ManifoldToplevel,
} from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";

let modulePromise: Promise<ManifoldToplevel> | null = null;

function isNodeRuntime(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions?.node === "string"
  );
}

export function loadManifold(): Promise<ManifoldToplevel> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const kernel = isNodeRuntime()
        ? await createManifoldModule()
        : await createManifoldModule({ locateFile: () => wasmUrl });
      kernel.setup();
      return kernel;
    })();
  }
  return modulePromise;
}

export function resetManifoldForTests(): void {
  modulePromise = null;
}

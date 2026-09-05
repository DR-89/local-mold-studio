import { expect, test } from "@playwright/test";

type TransportCall = { kind: string; url: string };

test("starts offline and completes the bundled import-to-export workflow", async ({
  context,
  page,
}) => {
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __localTransportCalls: TransportCall[];
    };
    target.__localTransportCalls = [];
    const remember = (kind: string, value: unknown) => {
      target.__localTransportCalls.push({ kind, url: String(value) });
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      remember("fetch", input instanceof Request ? input.url : input);
      return originalFetch(input, init);
    }) as typeof window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      remember("xhr", url);
      return originalOpen.call(
        this,
        method,
        url,
        async ?? true,
        username ?? null,
        password ?? null,
      );
    };
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = class extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        remember("websocket", url);
        super(url, protocols);
      }
    };
    const originalBeacon = navigator.sendBeacon?.bind(navigator);
    if (originalBeacon) {
      navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
        remember("beacon", url);
        return originalBeacon(url, data);
      }) as typeof navigator.sendBeacon;
    }
  });

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const observedUrls: string[] = [];
  page.on("request", (request) => observedUrls.push(request.url()));
  page.on("websocket", (socket) => observedUrls.push(socket.url()));

  await page.goto("/");
  await expect(page.getByText("Offline app ready")).toBeVisible({
    timeout: 30_000,
  });

  const cachedAssets = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(
      keys.find((key) => key.includes("local-mold-studio")) ?? "",
    );
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cachedAssets).toContain("/");
  expect(cachedAssets).toContain("/manifest.webmanifest");
  expect(cachedAssets.some((url) => /geometry\.worker-.*\.js$/.test(url))).toBe(
    true,
  );
  expect(cachedAssets.some((url) => /manifold-.*\.wasm$/.test(url))).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Two-part mold, entirely local." }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Load built-in offline test model" })
    .click();
  await expect(
    page.getByText("STL · 12 triangles · 20.0 × 20.0 × 20.0 mm"),
  ).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Model Splitter" }).click();
  await expect(page.getByRole("heading", { name: "Split a model into printable parts." })).toBeVisible();
  const filamentDetails = page.locator("details").filter({ hasText: "Filament estimate settings" }).first();
  await filamentDetails.locator("summary").click();
  await expect(filamentDetails.getByText("5 walls × 0.4 mm = 2.0 mm")).toBeVisible();
  expect(pageErrors).toEqual([]);
  await expect(page.getByRole("button", { name: "Generate bed-grid split" })).toBeEnabled();
  await page.getByRole("button", { name: "Two-part Box" }).click();
  await page.getByRole("button", { name: "Generate two-part mold" }).click();
  await expect(page.getByText(/2-part mold generated ·/)).toBeVisible({
    timeout: 30_000,
  });
  const materialCard = page.locator(".result-material-card");
  await expect(materialCard.getByText("Filament")).toBeVisible();
  await expect(materialCard.getByText(/\d+ g PETG/)).toBeVisible();
  await expect(materialCard.getByText("Filling")).toBeVisible();
  await expect(materialCard.getByText("7.2 g Wax")).toBeVisible();
  await expect(materialCard.getByText("8.0 ml")).toBeVisible();
  await expect(page.getByText("2/2 fit 340 × 320 × 340 mm")).toBeVisible();
  await page.getByRole("button", { name: "Create export package" }).click();
  await expect(page.getByText(/Export package ready/)).toBeVisible({
    timeout: 30_000,
  });

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Print package ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "offline-testmodell-print-package.zip",
  );
  await expect(page.getByText("1 of 4 files downloaded")).toBeVisible();
  await expect(page.getByText("✓ Downloaded")).toBeVisible();


  const transportCalls = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __localTransportCalls: TransportCall[];
        }
      ).__localTransportCalls,
  );
  for (const call of transportCalls) {
    const url = new URL(call.url, windowOrigin);
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  }
  for (const value of observedUrls) {
    const url = new URL(value);
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  }
});

const windowOrigin = "http://localhost:4174";

import { expect, test, type Page } from "@playwright/test";
import {
  cubeAsciiStl,
  cubeObj,
  cubeThreeMfCentimeters,
} from "../../src/testing/import-fixtures";
import { subdividedCubeBinaryStl } from "../helpers/dense-stl";

function watchRemoteRequests(page: Page): string[] {
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !["127.0.0.1", "localhost"].includes(url.hostname)
    ) {
      remoteRequests.push(request.url());
    }
  });
  return remoteRequests;
}

test("runs the WASM kernel without remote requests", async ({ page }) => {
  const remoteRequests = watchRemoteRequests(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Two-part mold, entirely local." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check kernel" }).click();
  await expect(page.getByText(/manifold-3d 3\.5\.1: 8 checks/)).toBeVisible({
    timeout: 30_000,
  });
  expect(remoteRequests).toEqual([]);
});

test("imports, previews and generates locally, then marks stale results", async ({
  page,
}) => {
  const remoteRequests = watchRemoteRequests(page);
  await page.goto("/");
  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeEnabled();

  await fileInput.setInputFiles({
    name: "cube.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(cubeAsciiStl()),
  });
  await expect(
    page.getByText("STL · 12 triangles · 20.0 × 20.0 × 20.0 mm"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/smaller than 40 mm/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Interactive 3D preview of the imported model",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Auto orient" }),
  ).toBeEnabled();
  const walls = page.getByRole("spinbutton", {
    name: "Print walls as number",
  });
  await expect(walls).toHaveValue("3");
  await walls.fill("6");
  await expect(walls).toHaveValue("6");
  const infill = page.getByRole("spinbutton", {
    name: "Cubic infill as number",
  });
  await expect(infill).toHaveValue("15");
  await infill.fill("30");
  await expect(infill).toHaveValue("30");

  await page.getByRole("button", { name: "Generate two-part mold" }).click();
  await expect(page.getByText(/2-part mold generated/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Actual front/back geometry")).toBeVisible();
  const materialCard = page.locator(".result-material-card");
  await expect(materialCard.getByText(/\d+ g PETG/)).toBeVisible();
  await expect(materialCard.getByText("7.2 g Wax")).toBeVisible();
  await expect(materialCard.getByText("8.0 ml")).toBeVisible();
  await expect(page.getByText("2/2 fit 340 × 320 × 340 mm")).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Interactive 3D preview of the two-part mold",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "All" })).toBeEnabled();
  await expect(
    page
      .getByRole("group", { name: "Visible fabrication parts" })
      .getByRole("button", { name: "Front" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("checkbox", { name: "Cavity transparent" }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Create export package" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create export package" }).click();
  await expect(page.getByText(/Export package ready/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /front STL/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /back STL/i })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "3MF", exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Print package ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("cube-print-package.zip");

  await page
    .getByRole("spinbutton", { name: "Seam position as number" })
    .fill("0.2");
  await expect(page.getByText(/result is outdated/)).toBeVisible();
  await expect(page.getByText("Actual front/back geometry")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Print package ZIP" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Generate two-part mold" }),
  ).toBeEnabled();

  await fileInput.setInputFiles({
    name: "cube.obj",
    mimeType: "text/plain",
    buffer: Buffer.from(cubeObj()),
  });
  await expect(
    page.getByText("OBJ · 12 triangles · 20.0 × 20.0 × 20.0 mm"),
  ).toBeVisible({ timeout: 30_000 });

  await fileInput.setInputFiles({
    name: "cube.3mf",
    mimeType: "model/3mf",
    buffer: Buffer.from(cubeThreeMfCentimeters()),
  });
  await expect(
    page.getByText("3MF · 12 triangles · 20.0 × 20.0 × 20.0 mm"),
  ).toBeVisible({ timeout: 30_000 });

  await fileInput.setInputFiles({
    name: "open.obj",
    mimeType: "text/plain",
    buffer: Buffer.from(cubeObj({ open: true })),
  });
  await expect(
    page.getByText(
      /Open component boundaries were closed locally/,
    ),
  ).toBeVisible({ timeout: 30_000 });

  expect(remoteRequests).toEqual([]);
});

test("keeps the UI responsive, cancels safely and starts a fresh job", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const remoteRequests = watchRemoteRequests(page);
  await page.goto("/");
  await expect(page.getByText("Single-thread Fallback")).toBeVisible();

  const fileInput = page.locator('input[type="file"]');
  await expect(fileInput).toBeEnabled();
  await fileInput.setInputFiles({
    name: "cancel-dense.stl",
    mimeType: "model/stl",
    buffer: subdividedCubeBinaryStl(91),
  });
  await expect(page.getByText(/STL · 99,372 triangles/)).toBeVisible({
    timeout: 30_000,
  });

  const intervalId = await page.evaluate(() => {
    document.documentElement.dataset.uiTicks = "0";
    return window.setInterval(() => {
      const ticks = Number(document.documentElement.dataset.uiTicks ?? "0");
      document.documentElement.dataset.uiTicks = String(ticks + 1);
    }, 20);
  });

  await page.getByRole("button", { name: "Generate two-part mold" }).click();
  const cancelStarted = await page.evaluate(() => performance.now());
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .dispatchEvent("click");
  await expect(page.getByText("Local job was cancelled.")).toBeVisible({
    timeout: 30_000,
  });

  const cancelMs = await page.evaluate(
    (started) => performance.now() - started,
    cancelStarted,
  );
  expect(cancelMs).toBeLessThan(1_000);

  const uiTicks = await page.evaluate((id) => {
    window.clearInterval(id);
    return Number(document.documentElement.dataset.uiTicks ?? "0");
  }, intervalId);
  expect(uiTicks).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Generate two-part mold" }).click();
  await expect(page.getByText(/2-part mold generated/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Actual front/back geometry")).toBeVisible();
  const materialCard = page.locator(".result-material-card");
  await expect(materialCard.getByText(/\d+ g PETG/)).toBeVisible();
  await expect(materialCard.getByText("7.2 g Wax")).toBeVisible();
  await expect(materialCard.getByText("8.0 ml")).toBeVisible();
  await expect(page.getByText("2/2 fit 340 × 320 × 340 mm")).toBeVisible();
  expect(remoteRequests).toEqual([]);
});

import { expect, test } from "@playwright/test";
import { cubeAsciiStl } from "../../src/testing/import-fixtures";

function tallCubeStl(): Buffer {
  const source = Buffer.from(cubeAsciiStl()).toString("utf8");
  return Buffer.from(
    source.replace(
      /vertex (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g,
      (_line, x: string, y: string, z: string) =>
        `vertex ${x} ${Number(y) * 35} ${z}`,
    ),
  );
}

test("splits a 700 mm two-part mold into H2S-fitting height rows", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");

  const heightSplit = page.getByRole("checkbox", {
    name: "Split oversized molds by height",
  });
  await expect(heightSplit).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Reset H2S · 340 × 320 × 340 mm" }),
  ).toBeVisible();
  const connectorWidth = page.getByRole("spinbutton", {
    name: "All hex connector width across flats as number",
  });
  await heightSplit.uncheck();
  await expect(connectorWidth).toBeVisible();
  await heightSplit.check();
  await connectorWidth.fill("2.0");
  await page
    .getByRole("spinbutton", {
      name: "All hex connector insertion depth as number",
    })
    .fill("6.0");

  await page.locator('input[type="file"]').setInputFiles({
    name: "tall-cube.stl",
    mimeType: "model/stl",
    buffer: tallCubeStl(),
  });
  await expect(page.getByText(/STL · 12 triangles · 20\.0 × 700\.0 × 20\.0 mm/)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Generate two-part mold" }).click();

  await expect(page.getByText(/6-part mold generated/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(/6 parts · 14 inner \+ 20 segment hex connectors/),
  ).toBeVisible();
  await expect(page.getByText(/6\/6 fit 340 × 320 × 340 mm/)).toBeVisible();
  const materialCard = page.locator(".result-material-card");
  await expect(materialCard.getByText("Filament")).toBeVisible();
  await expect(materialCard.getByText(/\d+ g PETG/)).toBeVisible();
  await expect(materialCard.getByText("Filling")).toBeVisible();
  await expect(materialCard.getByText("252.0 g Wax")).toBeVisible();
  await expect(materialCard.getByText("280.0 ml")).toBeVisible();
  const resultStrip = page.locator('[aria-label="Fabrication result"]');
  await expect(resultStrip).toBeVisible();
  expect(
    await resultStrip.evaluate(
      (element) => element.getBoundingClientRect().height,
    ),
  ).toBeGreaterThan(100);
  const resultAndExportBounds = await page.evaluate(() => {
    const result = document.querySelector(".result-strip")?.getBoundingClientRect();
    const exportCard = document.querySelector(".export-card")?.getBoundingClientRect();
    return {
      resultBottom: result?.bottom ?? 0,
      exportTop: exportCard?.top ?? 0,
    };
  });
  expect(resultAndExportBounds.resultBottom).toBeLessThanOrEqual(resultAndExportBounds.exportTop);
  await page.getByRole("button", { name: "Create export package" }).click();
  await expect(page.getByText(/Export package ready/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: /h\d{2}-d\d{2} STL/i }),
  ).toHaveCount(6);
});

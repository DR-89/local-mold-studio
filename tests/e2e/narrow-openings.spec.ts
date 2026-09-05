import { expect, test } from "@playwright/test";

test("toggles narrow-opening cleanup without a loaded model", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await page.getByText("Advanced settings", { exact: true }).click();

  const toggle = page.getByRole("checkbox", {
    name: "Close narrow openings",
  });
  await toggle.check();

  await expect(toggle).toBeChecked();
  await expect(page.getByLabel("Minimum cavity detail as number")).toHaveValue(
    "2.0",
  );
  await expect(page.getByText("Ready to import")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

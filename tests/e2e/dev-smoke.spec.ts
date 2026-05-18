// Mandatory P0 smoke spec. Verifies the dev shell's golden path end-to-end:
// mount → tick advances → save persists → reload restores tick.

import { expect, test } from "@playwright/test";

test("dev smoke: tick + save + reload restores", async ({ page }) => {
  await page.goto("/");

  // Mount + initial readout.
  const readout = page.getByTestId("tick-readout");
  await expect(readout).toHaveText("0");

  // Tick 0 → 1 → 2.
  await page.getByTestId("tick-button").click();
  await expect(readout).toHaveText("1");
  await page.getByTestId("tick-button").click();
  await expect(readout).toHaveText("2");

  // Save.
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("status")).toHaveText("Saved.");

  // Reload — readout resets to 0 (default seed), then Load restores 2.
  await page.reload();
  await expect(readout).toHaveText("0");
  await page.getByTestId("load-button").click();
  await expect(readout).toHaveText("2");
});

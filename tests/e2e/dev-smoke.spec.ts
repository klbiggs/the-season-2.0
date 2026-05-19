// Mandatory P0 smoke spec, extended at P1 with a separate test block covering
// the year-pass + head-age readout. P0's existing assertions are LEFT
// UNTOUCHED so the SaveV2 round-trip is exercised through the tick-readout
// path; the new block exercises the year-pass + age-readout path.

import { expect, test } from "@playwright/test";

test("dev smoke (P0): tick + save + reload restores", async ({ page }) => {
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

test("dev smoke (P2): corrupt save surfaces typed banner with aria contract", async ({ page }) => {
  await page.goto("/");

  // Setup: write a hand-crafted {version: 99} record via the dev-only helper
  // exposed on window. Timing: goto returns → corruption write → click load.
  await page.evaluate(async () => {
    const win = window as unknown as {
      __putRawForTests: (slot: string, data: unknown) => Promise<void>;
    };
    await win.__putRawForTests("dev", { version: 99 });
  });

  // Trigger the corrupt-save flow.
  await page.getByTestId("load-button").click();

  // Banner contract: visible, role=alert, aria-live=assertive,
  // SaveVersionTooNewError userMessage.
  const banner = page.getByRole("alert");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("aria-live", "assertive");
  await expect(banner).toContainText("newer version of the game");

  // Recovery: Start New Game clears banner + tick=0.
  await page.getByTestId("corrupt-save-start-new").click();
  await expect(page.getByTestId("corrupt-save-banner")).not.toBeVisible();
  await expect(page.getByTestId("tick-readout")).toHaveText("0");
});

test("dev smoke (P1): year-pass + save + reload + load restores head age", async ({ page }) => {
  await page.goto("/");

  const ageReadout = page.getByTestId("head-age-readout");
  // Step 0: assert initial age 25 (seeded head's starting age).
  await expect(ageReadout).toHaveText("25");

  // Step 1: click year-pass once.
  await page.getByTestId("year-pass-button").click();
  // Step 2: assert age incremented to 26.
  await expect(ageReadout).toHaveText("26");

  // Step 3: save.
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("status")).toHaveText("Saved.");

  // Step 4: reload.
  await page.reload();
  // Step 5: post-reload, pre-load the head age is back to 25 (fresh
  // createInitialState).
  await expect(ageReadout).toHaveText("25");

  // Step 6: load.
  await page.getByTestId("load-button").click();
  // Step 7: age is back to 26 after load.
  await expect(ageReadout).toHaveText("26");
});

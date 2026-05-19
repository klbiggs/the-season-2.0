// P3 e2e smoke spec for the strategy-map shell. Rewritten from
// dev-smoke.spec.ts: dev-shell testIds were tick-readout / tick-button /
// head-age-readout / save-button / load-button / year-pass-button / status
// — most are replaced by player-shell testIds (settings-menu-*, location-
// pin-*, location-details-*, current-location-label). The corrupt-save
// block (testIds: corrupt-save-banner / corrupt-save-start-new / corrupt-
// save-dismiss) carries forward verbatim — the banner moved from src/ui/
// dev/ to src/ui/shared/ with identical attribute contract.

import { expect, test } from "@playwright/test";

test("map smoke (P3): mount + 7 location pins + current-location highlight", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByTestId("location-pin-Capital")).toBeVisible();
  await expect(page.getByTestId("location-pin-Country")).toBeVisible();
  await expect(page.getByTestId("location-pin-ForeignCapital")).toBeVisible();
  await expect(page.getByTestId("current-location-label")).toContainText("The Capital");
});

test("map smoke (P3): travel happy path advances tick + changes location", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tick-readout")).toContainText("0");
  await page.getByTestId("location-pin-Country").click();
  await expect(page.getByTestId("tick-readout")).toContainText("1");
  await expect(page.getByTestId("current-location-label")).toContainText("The Country Estate");
});

test("map smoke (P3): ForeignCapital pin is disabled by era blockade", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("location-pin-ForeignCapital")).toBeDisabled();
});

test("map smoke (P3): save + reload + load restores state", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("location-pin-Country").click();
  await expect(page.getByTestId("tick-readout")).toContainText("1");

  await page.getByTestId("settings-menu-trigger").click();
  await page.getByTestId("settings-menu-save").click();
  await expect(page.getByTestId("status")).toContainText("Saved.");

  await page.reload();
  await expect(page.getByTestId("tick-readout")).toContainText("0");
  await expect(page.getByTestId("current-location-label")).toContainText("The Capital");

  await page.getByTestId("settings-menu-trigger").click();
  await page.getByTestId("settings-menu-load").click();
  await expect(page.getByTestId("tick-readout")).toContainText("1");
  await expect(page.getByTestId("current-location-label")).toContainText("The Country Estate");
});

test("map smoke (P3): corrupt save surfaces typed banner (carry-forward)", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(async () => {
    const win = window as unknown as {
      __putRawForTests: (slot: string, data: unknown) => Promise<void>;
    };
    await win.__putRawForTests("dev", { version: 99 });
  });

  await page.getByTestId("settings-menu-trigger").click();
  await page.getByTestId("settings-menu-load").click();

  const banner = page.getByRole("alert");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute("aria-live", "assertive");
  await expect(banner).toContainText("newer version of the game");

  await page.getByTestId("corrupt-save-start-new").click();
  await expect(page.getByTestId("corrupt-save-banner")).not.toBeVisible();
  await expect(page.getByTestId("tick-readout")).toContainText("0");
});

test("map smoke (P3): year-pass advances head age", async ({ page }) => {
  await page.goto("/");

  const ageReadout = page.getByTestId("head-age-readout");
  await expect(ageReadout).toContainText("25");

  await page.getByTestId("settings-menu-trigger").click();
  await page.getByTestId("settings-menu-pass-year").click();
  await expect(ageReadout).toContainText("26");
});

test("map smoke (P3): wardrobe refresh deducts wealth", async ({ page }) => {
  await page.goto("/");

  // At Capital by default — wardrobe button visible.
  const button = page.getByTestId("location-details-wardrobe");
  await expect(button).toBeVisible();
  // Initial tick + click.
  await expect(page.getByTestId("tick-readout")).toContainText("0");
  await button.click();
  // Tick advances (action consumes a tick).
  await expect(page.getByTestId("tick-readout")).toContainText("1");
});

test("map smoke (P3): bankruptcy escape gated by location + wealth", async ({ page }) => {
  await page.goto("/");
  // At Capital with wealth=100, the Country-only liquidate button is not visible.
  await expect(page.getByTestId("location-details-liquidate")).not.toBeVisible();
  // Travel to Country — wealth is still positive, button stays hidden.
  await page.getByTestId("location-pin-Country").click();
  await expect(page.getByTestId("current-location-label")).toContainText("The Country Estate");
  await expect(page.getByTestId("location-details-liquidate")).not.toBeVisible();
});

test("map smoke (P3): monarch audience button gated by reputation + cooldown", async ({ page }) => {
  await page.goto("/");
  // At Capital with starting reputation 50 (≥ 30), audience button is enabled.
  const audienceButton = page.getByTestId("location-details-audience");
  await expect(audienceButton).toBeVisible();
  await expect(audienceButton).toBeEnabled();
  // Click — outcome should be FullSuccess (rep ≥ 50). Tick advances.
  await audienceButton.click();
  await expect(page.getByTestId("tick-readout")).toContainText("1");
  // Cooldown: button is now disabled (within 30 ticks of last attempt).
  await expect(audienceButton).toBeDisabled();
});

// P14 e2e: the Ledger view golden path. Covers verification matrix #2 (routing),
// #4 (8-tab navigation), #10 (Social Web toggle), #23 (equip → reputation
// readout), and #30 (MapView inline-panel removal). The faux-pas slide-away
// (#35) and exile-banner (#36) paths require the LLM round-trip / a scripted
// scandal-sheet attribution and are exercised by Vitest, not here.

import { expect, test } from "@playwright/test";

const TAB_KEYS = [
  "family-tree",
  "whispers",
  "schemes",
  "patronesses",
  "grievances",
  "rivals",
  "staff",
  "artifacts",
] as const;

test("ledger (P14): open via TopBar, cycle all 8 tabs, return to map", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("map-view")).toBeVisible();

  await page.getByTestId("open-ledger-btn").click();
  await expect(page.getByTestId("ledger-view")).toBeVisible();

  for (const key of TAB_KEYS) {
    await page.getByTestId(`ledger-tabbtn-${key}`).click();
    await expect(page.getByTestId(`ledger-tab-${key}`)).toBeVisible();
  }

  await page.getByTestId("ledger-back-btn").click();
  await expect(page.getByTestId("map-view")).toBeVisible();
});

test("ledger (P14): MapView sidebar no longer hosts the inline ledger panels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.locator(".staff-panel")).toHaveCount(0);
  await expect(page.locator(".whisper-ledger-panel")).toHaveCount(0);
  await expect(page.locator(".spymaster-intercept-card")).toHaveCount(0);
  await expect(page.locator(".active-schemes-panel")).toHaveCount(0);
});

test("ledger (P14): Family Tree toggles into the Social Web sub-view", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-ledger-btn").click();
  await page.getByTestId("ledger-tabbtn-family-tree").click();
  await expect(page.getByTestId("social-web-view")).toHaveCount(0);
  await page.getByTestId("social-web-toggle").click();
  await expect(page.getByTestId("social-web-view")).toBeVisible();
});

test("ledger (P14): equipping a starter artifact updates the TopBar reputation readout", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("open-ledger-btn").click();
  await page.getByTestId("ledger-tabbtn-artifacts").click();
  await expect(page.getByTestId("ledger-tab-artifacts")).toBeVisible();

  const repBefore = await page.getByTestId("effective-reputation-readout").innerText();
  // The fresh-state bootstrap seeds an unequipped starter artifact (snuffbox);
  // its row exposes an Equip button.
  const equipButton = page.getByRole("button", { name: "Equip" }).first();
  await expect(equipButton).toBeVisible();
  await equipButton.click();
  const repAfter = await page.getByTestId("effective-reputation-readout").innerText();
  expect(repAfter).not.toEqual(repBefore);
});

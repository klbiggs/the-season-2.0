// P20 e2e: the core dynasty loop is reachable through the UI alone —
// marry (propose → accept) → conceive (year-pass birth) → succeed (heir
// inherits) — plus the scandal legibility cue.
//
// A fresh campaign cannot reach affection ≥ 80 without the LLM, so the
// precondition is injected via the DEV-only window.__store seam (replaceState
// is the SAME sink the load path feeds — fromSaveV1 → replaceState — so this
// faithfully stands in for a loaded high-affection save without a brittle
// hand-built SaveV1 blob; the save/load path itself is covered by
// map-smoke.spec). Conception cadence is keyed on state.tick (dt = tick -
// marriedAtTick), and runYearPass does NOT advance the tick, so a birth needs
// a tick advance ("Stay here a while") to reach dt = 2 BEFORE the year-pass
// runs the conception step.

import { type Page, expect, test } from "@playwright/test";

const PLAYER_HOUSE_ID = "player";
const INDEPENDENT_HOUSE_ID = "independent";

// Loose mirrors of the runtime entities — only the fields this spec reads. The
// real objects carry every GameState field; runtime spreads preserve them.
type LooseChar = {
  id: string;
  houseId: string;
  alive: boolean;
  marriageId: string | null;
  age: number;
  deathAge: number;
  role: string;
};
type LooseHouse = { headOfHouseCharacterId: string; scandal: number };
type LooseState = {
  characters: Map<string, LooseChar>;
  houses: Map<string, LooseHouse>;
  affectionMap: Map<string, number>;
  replaceState: (next: unknown) => void;
};
type BrowserGlobals = { __store: { getState: () => LooseState } };

// Inject affection ≥ 80 from the player head to an adult, unmarried procedural
// society NPC. Returns the chosen NPC id. A proc-npc (id "proc-npc-N") sorts
// AFTER "player-head", so the conception child joins the PLAYER house (the
// child joins the lex-first spouse's house — conception.ts:126).
async function injectHighAffectionTarget(page: Page): Promise<string> {
  return page.evaluate(
    ({ playerHouseId, independentHouseId }) => {
      const store = (window as unknown as BrowserGlobals).__store;
      const s = store.getState();
      let chosen: string | null = null;
      for (const [id, c] of s.characters) {
        if (
          c.alive &&
          c.marriageId === null &&
          c.age >= 18 &&
          c.age <= 38 && // < fertility ceiling (40) even after the year-pass +1 aging
          c.houseId === independentHouseId &&
          id.startsWith("proc-npc-")
        ) {
          chosen = id;
          break;
        }
      }
      if (chosen === null) throw new Error("no eligible procedural NPC for the propose target");
      const affectionMap = new Map(s.affectionMap);
      affectionMap.set(`${playerHouseId}|${chosen}`, 100);
      s.replaceState({ ...s, affectionMap });
      return chosen;
    },
    { playerHouseId: PLAYER_HOUSE_ID, independentHouseId: INDEPENDENT_HOUSE_ID },
  );
}

test("core loop (P20): propose → accept → conceive through the UI", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("map-view")).toBeVisible();

  const npcId = await injectHighAffectionTarget(page);

  // Enter the ballroom (fresh state starts at the Capital) and select the
  // high-affection target.
  await page.getByTestId("location-details-enter-ballroom").click();
  await expect(page.getByTestId("ballroom-view")).toBeVisible();
  await page.getByTestId(`portrait-card-${npcId}`).click();

  // Propose. Acceptance is probabilistic (slope ≤ 0.95); a roll-reject advances
  // the RNG + tick, so re-propose until accepted (essentially certain within a
  // few attempts at affection 100).
  let accepted = false;
  for (let i = 0; i < 25; i++) {
    await page.getByTestId("propose-marriage-btn").click();
    const banner = page.getByTestId("proposal-outcome-banner");
    await expect(banner).toBeVisible();
    if ((await banner.getAttribute("data-tone")) === "success") {
      accepted = true;
      break;
    }
  }
  expect(accepted).toBe(true);
  await expect(page.getByTestId("proposal-outcome-banner")).toContainText("accepted");

  // Back to the map to advance the dynasty clock.
  await page.getByTestId("ballroom-exit").click();
  await expect(page.getByTestId("map-view")).toBeVisible();

  // After acceptance tick = marriedAtTick + 1. One tick advance reaches dt = 2;
  // then the year-pass runs the conception step (dt % 2 === 0) and a child is
  // born into the player house.
  await page.getByTestId("location-details-stay").click();
  await page.getByTestId("pass-year-btn").click();
  await expect(page.getByTestId("year-pass-summary")).toContainText("child");
});

test("core loop (P20): year-pass surfaces succession when the head dies", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("map-view")).toBeVisible();

  // Inject: age the player head to the brink of its rolled deathAge and add an
  // adult player-house heir so the next year-pass kills the head and promotes
  // the heir (succession family pool = living adult Spouse|Heir|Dependent).
  await page.evaluate(
    ({ playerHouseId }) => {
      const store = (window as unknown as BrowserGlobals).__store;
      const s = store.getState();
      const headId = s.houses.get(playerHouseId)?.headOfHouseCharacterId;
      if (headId === undefined) throw new Error("no player head");
      const head = s.characters.get(headId);
      if (head === undefined) throw new Error("no player head character");
      const characters = new Map(s.characters);
      characters.set(headId, { ...head, age: head.deathAge - 1 });
      const heirId = "test-heir";
      characters.set(heirId, {
        ...head,
        id: heirId,
        name: "The Heir",
        role: "Dependent",
        age: 30,
        alive: true,
        marriageId: null,
      } as LooseChar);
      s.replaceState({ ...s, characters });
    },
    { playerHouseId: PLAYER_HOUSE_ID },
  );

  await page.getByTestId("pass-year-btn").click();
  await expect(page.getByTestId("year-pass-summary")).toContainText("inherits");
  await expect(page.getByTestId("generation-readout")).toContainText("1");
});

test("core loop (P20): scandal readout surfaces the censure cue at the threshold", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("map-view")).toBeVisible();

  await page.evaluate(
    ({ playerHouseId }) => {
      const store = (window as unknown as BrowserGlobals).__store;
      const s = store.getState();
      const houses = new Map(s.houses);
      const ph = houses.get(playerHouseId);
      if (ph === undefined) throw new Error("no player house");
      houses.set(playerHouseId, { ...ph, scandal: 60 });
      s.replaceState({ ...s, houses });
    },
    { playerHouseId: PLAYER_HOUSE_ID },
  );

  await expect(page.getByTestId("scandal-readout")).toContainText("60");
  await expect(page.getByTestId("scandal-censure-cue")).toBeVisible();
});

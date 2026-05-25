// P16 D3 end-to-end: a PROCEDURALLY-GENERATED society officer (BohemianRake
// profile guarantees MilitaryOfficer) is subject to the P13 WarEffort
// officer-death branch. Proves the dormant branch is now activated by a real
// acquisition path — no fixture-literal officer needed.

import { describe, expect, it } from "vitest";
import type { GameState } from "../entities";
import type { GlobalEvent } from "../entities";
import { type GlobalEventId, INDEPENDENT_HOUSE_ID, type TraitId } from "../rng";
import { createInitialState } from "../store";
import { applyGlobalEventPhase } from "./globalEvents";

const MILITARY_OFFICER = "MilitaryOfficer" as TraitId;

describe("P16 D3 — procedural society officer trips the WarEffort branch", () => {
  it("a generated Independent-house officer is killed by a sustained WarEffort", () => {
    let state: GameState = createInitialState("officer-e2e");

    // The society batch produced officers in the Independent house.
    const officerIds = [...state.characters.values()]
      .filter(
        (c) => c.houseId === INDEPENDENT_HOUSE_ID && c.alive && c.traits.includes(MILITARY_OFFICER),
      )
      .map((c) => c.id);
    expect(officerIds.length).toBeGreaterThan(0);

    // Inject a sustained WarEffort (endTick far beyond the loop so it never
    // expires) — the per-tick officer-death roll then fires every phase call.
    const event: GlobalEvent = {
      kind: "WarEffort",
      id: "globalevent-WarEffort-0" as GlobalEventId,
      startTick: 0,
      endTick: 1_000_000,
    };
    state = { ...state, globalEvents: new Map([[event.id, event]]) };

    let anyDead = false;
    for (let i = 0; i < 500 && !anyDead; i++) {
      state = applyGlobalEventPhase(state);
      state = { ...state, tick: state.tick + 1 };
      anyDead = officerIds.some((id) => state.characters.get(id)?.alive === false);
    }
    expect(anyDead).toBe(true);
  });
});

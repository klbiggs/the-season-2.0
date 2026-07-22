import { describe, expect, it } from "vitest";
import { makeCharacter, makeGameState } from "../__test-utils__/factories";
import { CALLING_CARD_EXPIRY_TICKS } from "../constants";
import type { CallingCard, GameState } from "../entities";
import { type CallingCardId, type CharacterId, PLAYER_HOUSE_ID, createRngState } from "../rng";
import { INDEPENDENT_HOUSE_ID } from "../rng.seeds";
import { applyCallingCardPhase } from "./callingCards";

// State with the player rng stream + a pool of adult non-player NPCs so the
// caller pool is non-empty. Society (Independent) house characters are eligible.
function stateWithPool(seed: string, npcCount = 6): GameState {
  const chars = Array.from({ length: npcCount }, (_, i) =>
    makeCharacter({
      id: `npc-${i}` as CharacterId,
      houseId: INDEPENDENT_HOUSE_ID,
      age: 25,
      alive: true,
    }),
  );
  return makeGameState({
    tick: 0,
    rng: new Map([[PLAYER_HOUSE_ID, createRngState(seed)]]),
    characters: new Map(chars.map((c) => [c.id, c])),
  });
}

function pending(state: GameState): CallingCard[] {
  return [...state.callingCards.values()].filter((c) => c.status === "Pending");
}

// Drive the phase for N ticks (advancing state.tick between phases, mirroring
// the orchestrator's advanceTickPhase) and return the final state.
function runTicks(state: GameState, ticks: number): GameState {
  let s = state;
  for (let i = 0; i < ticks; i += 1) {
    s = { ...s, tick: s.tick + 1 };
    s = applyCallingCardPhase(s);
  }
  return s;
}

describe("applyCallingCardPhase — burn-on-all-outcomes trigger draw", () => {
  it("advances the player rng callCount by exactly 1 on a no-spawn tick", () => {
    // A Pending card already exists → the roll's outcome is discarded, but the
    // trigger draw still fires (burn-on-all-outcomes). Exactly 1 draw, no more.
    const base = stateWithPool("cc-burn");
    const existing: CallingCard = {
      id: "card-0" as CallingCardId,
      callerCharacterId: "npc-0" as CharacterId,
      issuedAtTick: 0,
      expiresAtTick: 100, // far future — stays Pending
      status: "Pending",
    };
    const state: GameState = {
      ...base,
      tick: 1,
      callingCards: new Map([[existing.id, existing]]),
    };
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const after = applyCallingCardPhase(state);
    const afterCount = after.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    expect(afterCount).toBe(before + 1); // exactly one trigger draw, discarded outcome
    expect(pending(after)).toHaveLength(1); // no second Pending minted
  });

  it("is deterministic — same seed produces identical calling cards over 200 ticks", () => {
    const a = runTicks(stateWithPool("cc-determinism"), 200);
    const b = runTicks(stateWithPool("cc-determinism"), 200);
    expect([...a.callingCards.entries()]).toEqual([...b.callingCards.entries()]);
  });
});

describe("applyCallingCardPhase — Pending cap + expiry", () => {
  it("mints at most one Pending card at a time across a long run", () => {
    let s = stateWithPool("cc-cap");
    let maxPending = 0;
    for (let i = 0; i < 300; i += 1) {
      s = { ...s, tick: s.tick + 1 };
      s = applyCallingCardPhase(s);
      maxPending = Math.max(maxPending, pending(s).length);
    }
    expect(maxPending).toBe(1); // never two Pending at once
  });

  it("expires a Pending card exactly at its absolute end-tick", () => {
    const base = stateWithPool("cc-expiry");
    const card: CallingCard = {
      id: "card-0" as CallingCardId,
      callerCharacterId: "npc-0" as CharacterId,
      issuedAtTick: 0,
      expiresAtTick: 5, // absolute end-tick
      status: "Pending",
    };
    // At tick 4 (< expiresAtTick) it stays Pending.
    const atTick4 = applyCallingCardPhase({
      ...base,
      tick: 4,
      callingCards: new Map([[card.id, card]]),
    });
    expect(atTick4.callingCards.get(card.id)?.status).toBe("Pending");
    // At tick 5 (>= expiresAtTick) it flips to Expired.
    const atTick5 = applyCallingCardPhase({
      ...base,
      tick: 5,
      callingCards: new Map([[card.id, card]]),
    });
    expect(atTick5.callingCards.get(card.id)?.status).toBe("Expired");
  });

  it("mints a new card only after the prior Pending clears (expiry frees the slot)", () => {
    // Run long enough that at least one card mints, then expires, then a
    // successor can mint — proving cards are never deleted (ids stay unique).
    const s = runTicks(stateWithPool("cc-successor"), 400);
    const all = [...s.callingCards.values()];
    expect(all.length).toBeGreaterThan(0);
    // Never-delete invariant: ids are contiguous card-0..card-N.
    const ids = all.map((c) => c.id).sort();
    expect(new Set(ids).size).toBe(all.length); // all unique
    // Every minted card carries an absolute end-tick = issue + EXPIRY.
    for (const c of all) {
      expect(c.expiresAtTick).toBe(c.issuedAtTick + CALLING_CARD_EXPIRY_TICKS);
    }
  });
});

describe("applyCallingCardPhase — empty pool", () => {
  it("burns the trigger draw but mints nothing when no eligible caller exists", () => {
    const base = makeGameState({
      tick: 1,
      rng: new Map([[PLAYER_HOUSE_ID, createRngState("cc-empty")]]),
      characters: new Map(), // no NPCs
    });
    const before = base.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const after = runTicks(base, 100);
    const afterCount = after.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    expect(afterCount).toBe(before + 100); // one trigger draw per tick, no caller-pick draws
    expect(after.callingCards.size).toBe(0);
  });
});

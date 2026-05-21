// P8: patroness erosion + ball-veto tests.

import { describe, expect, it } from "vitest";
import { makeGameState, makeHouse } from "../__test-utils__/factories";
import type { PatronessRecord, RivalActorState } from "../entities";
import { FACTION_PAIRS, makeFactionPairKey } from "../fixtures/factions";
import { PATRONESSES_FIXTURE } from "../fixtures/patronesses";
import { RIVAL_HOUSES_FIXTURE } from "../fixtures/rivals";
import {
  type FactionPairKey,
  type HouseId,
  PLAYER_HOUSE_ID,
  type PatronessId,
} from "../rng";
import { applyPatronessErosionPhase, checkBallVeto } from "./patronesses";

function seedPatronesses(): Map<PatronessId, PatronessRecord> {
  const m = new Map<PatronessId, PatronessRecord>();
  for (const p of PATRONESSES_FIXTURE) m.set(p.id, p);
  return m;
}

function seedFactionTensions(): Map<FactionPairKey, number> {
  const m = new Map<FactionPairKey, number>();
  for (const pair of FACTION_PAIRS) m.set(pair, 0);
  return m;
}

describe("applyPatronessErosionPhase", () => {
  it("is a no-op when scandal < threshold", () => {
    const state = makeGameState({
      tick: 1,
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ scandal: 49 })]]),
      patronesses: seedPatronesses(),
      factionTensions: seedFactionTensions(),
    });
    const next = applyPatronessErosionPhase(state);
    for (const p of next.patronesses.values()) {
      expect(p.favor).toBe(50);
    }
  });

  it("erodes ONE patroness by -1 when scandal >= 50 and no high tension", () => {
    const state = makeGameState({
      tick: 1,
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ scandal: 60 })]]),
      patronesses: seedPatronesses(),
      factionTensions: seedFactionTensions(),
    });
    const next = applyPatronessErosionPhase(state);
    let drops = 0;
    for (const p of next.patronesses.values()) {
      if (p.favor < 50) drops += 1;
    }
    expect(drops).toBe(1);
  });

  it("doubles erosion to -2 when an active rival has tension ≥ 50 on the picked patroness's faction", () => {
    const patronesses = seedPatronesses();
    const tensions = seedFactionTensions();
    // Find the picked patroness for tick=1.
    const sortedIds = [...patronesses.keys()].sort();
    const pickedId = sortedIds[1] ?? sortedIds[0];
    if (pickedId === undefined) throw new Error("expected ≥1 patroness");
    const picked = patronesses.get(pickedId);
    if (picked === undefined) throw new Error("picked id not in fixture");
    // Set up an active rival on a different faction with high tension to her.
    const rivalSeed = RIVAL_HOUSES_FIXTURE.find((r) => r.factionId !== picked.factionId);
    if (rivalSeed === undefined) throw new Error("expected ≥1 non-self-faction rival");
    tensions.set(makeFactionPairKey(rivalSeed.factionId, picked.factionId), 60);
    const rivalActors = new Map<HouseId, RivalActorState>();
    rivalActors.set(rivalSeed.houseId, {
      houseId: rivalSeed.houseId,
      factionId: rivalSeed.factionId,
      associatedCharacterIds: [],
      lastActionTick: null,
    });
    const houses = new Map([
      [PLAYER_HOUSE_ID, makeHouse({ scandal: 60 })],
      [rivalSeed.houseId, makeHouse({ id: rivalSeed.houseId, hostility: 30, factionId: rivalSeed.factionId })],
    ]);
    const state = makeGameState({
      tick: 1,
      houses,
      patronesses,
      factionTensions: tensions,
      rivalActors,
    });
    const next = applyPatronessErosionPhase(state);
    const after = next.patronesses.get(pickedId);
    expect(after?.favor).toBe(48); // 50 + (-2) doubled erosion
  });
});

describe("checkBallVeto", () => {
  it("returns empty vetoedBy when all patronesses have favor >= threshold", () => {
    const state = makeGameState({ patronesses: seedPatronesses() });
    expect(checkBallVeto(state)).toEqual({ vetoedBy: [] });
  });

  it("returns the snubbing patroness when one is below threshold", () => {
    const patronesses = seedPatronesses();
    const firstId = [...patronesses.keys()].sort()[0];
    if (firstId === undefined) throw new Error("expected ≥1 patroness");
    const first = patronesses.get(firstId);
    if (first === undefined) throw new Error("first id not in fixture");
    patronesses.set(firstId, { ...first, favor: 15 });
    const state = makeGameState({ patronesses });
    const result = checkBallVeto(state);
    expect(result.vetoedBy).toEqual([firstId]);
  });

  it("returns ALL snubbing patronesses (multiple)", () => {
    const patronesses = seedPatronesses();
    const ids = [...patronesses.keys()].sort();
    const id0 = ids[0];
    const id2 = ids[2];
    if (id0 === undefined || id2 === undefined) throw new Error("expected ≥3 patronesses");
    const p0 = patronesses.get(id0);
    const p2 = patronesses.get(id2);
    if (p0 === undefined || p2 === undefined) throw new Error("expected ids in fixture");
    patronesses.set(id0, { ...p0, favor: 10 });
    patronesses.set(id2, { ...p2, favor: 5 });
    const state = makeGameState({ patronesses });
    const result = checkBallVeto(state);
    expect(result.vetoedBy.sort()).toEqual([id0, id2].sort());
  });
});


// P24b (E3/E4/E6): non-player artifact loops — Observant private detection on a
// non-surfacing forgery, and NPC thefts that fire + auto-resolve against
// non-player houses. Low-probability branches are exercised deterministically by
// searching for a seed whose draw sequence matches the phase's
// `Math.floor(roll * 10000) < basisPoints` comparison.

import { describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse } from "../__test-utils__/factories";
import {
  FORGERY_SURFACING_PROBABILITY_BASIS_POINTS,
  OBSERVANT_FORGERY_AFFECTION_PENALTY,
  OBSERVANT_FORGERY_DETECTION_PROBABILITY_BASIS_POINTS,
  THIEF_NOTICE_PROBABILITY_BASIS_POINTS,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { ArtifactInstance, ForgeryRecord, ThiefAttempt } from "../entities";
import {
  type ArtifactDefinitionId,
  type ArtifactInstanceId,
  type CharacterId,
  type ForgeryId,
  type HouseId,
  type ThiefAttemptId,
  type TraitId,
  createRngState,
  drawNext,
} from "../rng";
import { applyForgerySurfacingPhase, applyThiefNoticePhase } from "./artifacts";

const OWNER_HOUSE = "owner-house" as HouseId;
const OBSERVER_HOUSE = "observer-house" as HouseId;
const OWNER_HEAD = "owner-head" as CharacterId;
const OBSERVER = "observer-npc" as CharacterId;

function findSeed(predicate: (seed: string) => boolean): string {
  for (let i = 0; i < 5000; i++) {
    const s = `search-${i}`;
    if (predicate(s)) return s;
  }
  throw new Error("findSeed: no matching seed in range");
}

describe("E3 — Observant private forgery detection", () => {
  it("applies a private affection penalty toward the owner WITHOUT surfacing the forgery", () => {
    // Seed where the owner's first draw does NOT surface AND the next draw (the
    // single Observant NPC) detects.
    const seed = findSeed((s) => {
      const d1 = drawNext(createRngState(s));
      if (Math.floor(d1.next * 10000) < FORGERY_SURFACING_PROBABILITY_BASIS_POINTS) return false;
      const d2 = drawNext(d1.rngState);
      return Math.floor(d2.next * 10000) < OBSERVANT_FORGERY_DETECTION_PROBABILITY_BASIS_POINTS;
    });

    const inst: ArtifactInstance = {
      id: "art-forged" as ArtifactInstanceId,
      definitionId: "sapphires" as ArtifactDefinitionId,
      ownerHouseId: OWNER_HOUSE,
      ownerCharacterId: OWNER_HEAD,
      lastRefreshTick: 0,
      forgedFlag: true,
    };
    const forgery: ForgeryRecord = {
      id: "f-1" as ForgeryId,
      forgedArtifactInstanceId: inst.id,
      forgerCharacterId: OWNER_HEAD,
      forgedAtTick: 0,
      surfaced: false,
      surfacedAtTick: null,
    };
    const pairKey = makePairKey(OBSERVER_HOUSE, OWNER_HEAD);
    const state = makeGameState({
      tick: 10,
      rng: new Map([[OWNER_HOUSE, createRngState(seed)]]),
      houses: new Map([
        [OWNER_HOUSE, makeHouse({ id: OWNER_HOUSE, headOfHouseCharacterId: OWNER_HEAD })],
        [OBSERVER_HOUSE, makeHouse({ id: OBSERVER_HOUSE, headOfHouseCharacterId: OBSERVER })],
      ]),
      characters: new Map([
        [OWNER_HEAD, makeCharacter({ id: OWNER_HEAD, houseId: OWNER_HOUSE })],
        [
          OBSERVER,
          makeCharacter({
            id: OBSERVER,
            houseId: OBSERVER_HOUSE,
            traits: ["Observant" as TraitId],
          }),
        ],
      ]),
      artifactInstances: new Map([[inst.id, inst]]),
      forgeries: new Map([[forgery.id, forgery]]),
      affectionMap: new Map([[pairKey, 50]]),
    });

    const after = applyForgerySurfacingPhase(state);
    // Forgery did NOT surface (private detection only).
    expect(after.forgeries.get(forgery.id)?.surfaced).toBe(false);
    // Private affection penalty applied toward the owner head.
    expect(after.affectionMap.get(pairKey)).toBe(50 + OBSERVANT_FORGERY_AFFECTION_PENALTY);
    // No public Vain cascade → observer's mood is NOT Defensive-locked.
    expect(after.characters.get(OBSERVER)?.mood).toBe(state.characters.get(OBSERVER)?.mood);
    expect(after.characters.get(OBSERVER)?.moodLockUntilTick).toBe(0);
  });
});

describe("E4 — NPC thefts fire + auto-resolve against non-player houses", () => {
  const VALUABLE_DEF = "tiara" as ArtifactDefinitionId; // rep 10 ≥ VALUABLE_ARTIFACT_THRESHOLD

  function nonPlayerStateWith(extra: { attempt?: ThiefAttempt; seed: string; tick: number }) {
    const inst: ArtifactInstance = {
      id: "art-rival" as ArtifactInstanceId,
      definitionId: VALUABLE_DEF,
      ownerHouseId: OWNER_HOUSE,
      ownerCharacterId: OWNER_HEAD,
      lastRefreshTick: 0,
      forgedFlag: false,
    };
    return makeGameState({
      tick: extra.tick,
      rng: new Map([[OWNER_HOUSE, createRngState(extra.seed)]]),
      houses: new Map([
        // High reputation so the per-house thief-notice rep gate passes.
        [
          OWNER_HOUSE,
          makeHouse({ id: OWNER_HOUSE, headOfHouseCharacterId: OWNER_HEAD, reputation: 80 }),
        ],
      ]),
      characters: new Map([
        [
          OWNER_HEAD,
          makeCharacter({
            id: OWNER_HEAD,
            houseId: OWNER_HOUSE,
            equippedArtifactIds: [inst.id],
          }),
        ],
      ]),
      artifactInstances: new Map([[inst.id, inst]]),
      thiefAttempts: extra.attempt ? new Map([[extra.attempt.id, extra.attempt]]) : new Map(),
    });
  }

  it("fires a thief notice against a high-reputation non-player house with a valuable artifact", () => {
    const seed = findSeed((s) => {
      const d = drawNext(createRngState(s));
      return Math.floor(d.next * 10000) < THIEF_NOTICE_PROBABILITY_BASIS_POINTS;
    });
    const state = nonPlayerStateWith({ seed, tick: 5 });
    const after = applyThiefNoticePhase(state);
    const created = [...after.thiefAttempts.values()];
    expect(created).toHaveLength(1);
    expect(created[0]?.targetedArtifactInstanceId).toBe("art-rival" as ArtifactInstanceId);
    expect(created[0]?.noticedAtTick).toBe(5);
    expect(created[0]?.thwarted).toBe(null); // in-flight
  });

  it("auto-resolves a non-player in-flight attempt (theft succeeds; no thwart UI)", () => {
    // An attempt noticed at an EARLIER tick auto-resolves in the sweep. Use a
    // seed that does NOT also create a new notice this tick (keeps the assertion
    // about the single swept attempt clean).
    const seed = findSeed((s) => {
      const d = drawNext(createRngState(s));
      return Math.floor(d.next * 10000) >= THIEF_NOTICE_PROBABILITY_BASIS_POINTS;
    });
    const attempt: ThiefAttempt = {
      id: "thief-art-rival-0" as ThiefAttemptId,
      targetedArtifactInstanceId: "art-rival" as ArtifactInstanceId,
      ownerCharacterId: OWNER_HEAD,
      noticedAtTick: 4,
      thwarted: null,
      resolvedAtTick: null,
    };
    const state = nonPlayerStateWith({ attempt, seed, tick: 5 });
    const after = applyThiefNoticePhase(state);
    const resolved = after.thiefAttempts.get(attempt.id);
    expect(resolved?.thwarted).toBe(false); // stolen (non-player auto-resolve, equipped → succeeds)
    expect(resolved?.resolvedAtTick).toBe(5);
    // Theft removed the instance + unequipped it from the owner.
    expect(after.artifactInstances.has("art-rival" as ArtifactInstanceId)).toBe(false);
    expect(after.characters.get(OWNER_HEAD)?.equippedArtifactIds).not.toContain(
      "art-rival" as ArtifactInstanceId,
    );
  });
});

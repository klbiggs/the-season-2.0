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
  THWART_SUCCESS_PROBABILITY_BASIS_POINTS,
  THWART_WEALTH_COST,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { ArtifactInstance, CourierPayload, ForgeryRecord, ThiefAttempt } from "../entities";
import {
  type ArtifactDefinitionId,
  type ArtifactInstanceId,
  type CharacterId,
  type CourierPayloadId,
  type ForgeryId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type ThiefAttemptId,
  type TraitId,
  type WhisperId,
  createRngState,
  drawNext,
} from "../rng";
import {
  applyForgerySurfacingPhase,
  applyThiefNoticePhase,
  applyThwartTheftPure,
} from "./artifacts";

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

// ── E4 close-out — the thwart affordance is player-house-only ──────────────
//
// applyThwartTheftPure gates on the targeted instance's ownerHouseId: a
// non-player theft (in-flight for one tick by the strict-< sweep predicate)
// must reject rather than burn player wealth + a courier — and on a failed
// roll, delete the OTHER house's artifact. The player-side success/failure
// paths are pinned here too (the E4 "player still thwarts their own" half).
describe("E4 — applyThwartTheftPure owner-house gate + player thwart paths", () => {
  const PLAYER_HEAD = "player-head" as CharacterId;
  const PLAYER_INST = "art-player" as ArtifactInstanceId;
  const ATTEMPT_ID = "thief-art-player-0" as ThiefAttemptId;

  function playerThwartState(opts: { seed: string; ownerHouseId: HouseId }) {
    const inst: ArtifactInstance = {
      id: PLAYER_INST,
      definitionId: "tiara" as ArtifactDefinitionId,
      ownerHouseId: opts.ownerHouseId,
      ownerCharacterId: PLAYER_HEAD,
      lastRefreshTick: 0,
      forgedFlag: false,
    };
    const attempt: ThiefAttempt = {
      id: ATTEMPT_ID,
      targetedArtifactInstanceId: PLAYER_INST,
      ownerCharacterId: PLAYER_HEAD,
      noticedAtTick: 4,
      thwarted: null,
      resolvedAtTick: null,
    };
    const courier: CourierPayload = {
      id: "c-0001" as CourierPayloadId,
      payloadType: "Whisper",
      whisperId: "w-0001" as WhisperId,
      originHouseId: OWNER_HOUSE,
      destinationHouseId: PLAYER_HOUSE_ID,
      originLocation: "Capital",
      destinationLocation: "Capital",
      originTick: 0,
      arrivalTick: 9,
      interceptable: true,
      direction: "Inbound",
      status: "InFlight",
      resolvedAtTick: null,
    };
    return makeGameState({
      tick: 5,
      rng: new Map([[PLAYER_HOUSE_ID, createRngState(opts.seed)]]),
      houses: new Map([
        [
          PLAYER_HOUSE_ID,
          makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: PLAYER_HEAD, wealth: 100 }),
        ],
      ]),
      characters: new Map([
        [
          PLAYER_HEAD,
          makeCharacter({
            id: PLAYER_HEAD,
            houseId: PLAYER_HOUSE_ID,
            archetype: "Spymaster",
            equippedArtifactIds: [PLAYER_INST],
          }),
        ],
      ]),
      artifactInstances: new Map([[inst.id, inst]]),
      thiefAttempts: new Map([[attempt.id, attempt]]),
      couriers: new Map([[courier.id, courier]]),
    });
  }

  it("rejects NotPlayerOwnedTarget when the targeted instance belongs to another house", () => {
    const state = playerThwartState({ seed: "any-seed", ownerHouseId: OWNER_HOUSE });
    const result = applyThwartTheftPure(state, ATTEMPT_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "NotPlayerOwnedTarget" } });
  });

  it("Thwarted path: artifact survives; wealth + courier burned; attempt resolved", () => {
    const seed = findSeed((s) => {
      const d = drawNext(createRngState(s));
      return Math.floor(d.next * 10000) < THWART_SUCCESS_PROBABILITY_BASIS_POINTS;
    });
    const state = playerThwartState({ seed, ownerHouseId: PLAYER_HOUSE_ID });
    const result = applyThwartTheftPure(state, ATTEMPT_ID);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason.kind}`);
    expect(result.outcome).toBe("Thwarted");
    const after = result.state;
    expect(after.thiefAttempts.get(ATTEMPT_ID)?.thwarted).toBe(true);
    expect(after.thiefAttempts.get(ATTEMPT_ID)?.resolvedAtTick).toBe(5);
    expect(after.artifactInstances.has(PLAYER_INST)).toBe(true);
    expect(after.characters.get(PLAYER_HEAD)?.equippedArtifactIds).toContain(PLAYER_INST);
    expect(after.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(100 - THWART_WEALTH_COST);
    expect(after.couriers.get("c-0001" as CourierPayloadId)?.status).toBe("Intercepted");
  });

  it("Stolen path: artifact deleted + unequipped; wealth + courier still burned", () => {
    const seed = findSeed((s) => {
      const d = drawNext(createRngState(s));
      return Math.floor(d.next * 10000) >= THWART_SUCCESS_PROBABILITY_BASIS_POINTS;
    });
    const state = playerThwartState({ seed, ownerHouseId: PLAYER_HOUSE_ID });
    const result = applyThwartTheftPure(state, ATTEMPT_ID);
    if (!result.ok) throw new Error(`expected ok, got ${result.reason.kind}`);
    expect(result.outcome).toBe("Stolen");
    const after = result.state;
    expect(after.thiefAttempts.get(ATTEMPT_ID)?.thwarted).toBe(false);
    expect(after.artifactInstances.has(PLAYER_INST)).toBe(false);
    expect(after.characters.get(PLAYER_HEAD)?.equippedArtifactIds).not.toContain(PLAYER_INST);
    expect(after.houses.get(PLAYER_HOUSE_ID)?.wealth).toBe(100 - THWART_WEALTH_COST);
    expect(after.couriers.get("c-0001" as CourierPayloadId)?.status).toBe("Intercepted");
  });
});

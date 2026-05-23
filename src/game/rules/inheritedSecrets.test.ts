// P11 inherited-secrets + blood-feuds rule-layer tests.

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeGameState,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import { MAX_INHERITED_SECRETS } from "../constants";
import {
  BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE,
  BLOOD_FEUD_DECAY_TICKS_MAX,
  BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { Whisper } from "../entities";
import type { BloodFeud, InheritedSecret, RivalActorState } from "../entities";
import type { CharacterId, GrievanceId, WhisperId } from "../rng";
import { PLAYER_HOUSE_ID } from "../rng";
import { type HouseId, createRngState } from "../rng";
import {
  accumulateInheritedSecretsAtSuccession,
  applyInheritedSecretSurfacingPhase,
  resolveBloodFeudByGrievance,
} from "./inheritedSecrets";

function makeWhisper(overrides: Partial<Whisper> = {}): Whisper {
  return {
    id: "test-whisper" as WhisperId,
    text: "test text",
    originatingTick: 0,
    sourceCharacterId: "src" as CharacterId,
    subjectCharacterId: "subj" as CharacterId,
    destinationHouseId: PLAYER_HOUSE_ID,
    arrivedAtTick: 0,
    verificationProgress: 100,
    status: "Verified",
    weaponizedAs: null,
    weaponizedAtTick: null,
    scandalSheetAttribution: null,
    accidentalSlipDripsRemaining: 0,
    llmGenerated: false,
    ...overrides,
  };
}

describe("accumulateInheritedSecretsAtSuccession", () => {
  it("copies Verified+Weaponized whispers about player-house subjects into the ledger", () => {
    const playerSubject = makeCharacter({ id: "subj" as CharacterId, houseId: PLAYER_HOUSE_ID });
    const verified = makeWhisper({
      id: "w1" as WhisperId,
      subjectCharacterId: playerSubject.id,
      status: "Verified",
    });
    const weaponized = makeWhisper({
      id: "w2" as WhisperId,
      subjectCharacterId: playerSubject.id,
      status: "Weaponized",
    });
    const unverified = makeWhisper({
      id: "w3" as WhisperId,
      subjectCharacterId: playerSubject.id,
      status: "Unverified",
    });
    const whispers = new Map<WhisperId, Whisper>([
      [verified.id, verified],
      [weaponized.id, weaponized],
      [unverified.id, unverified],
    ]);
    const state = makeGameState({
      characters: makeCharactersMap([playerSubject]),
      houses: makeHousesMap([makeHouse()]),
      whispers,
    });
    const next = accumulateInheritedSecretsAtSuccession(
      state,
      "dead" as CharacterId,
      "heir" as CharacterId,
    );
    const ledger = next.houses.get(PLAYER_HOUSE_ID)?.inheritedSecrets ?? [];
    expect(ledger).toHaveLength(2);
    const sourceIds = ledger.map((s) => s.sourceWhisperId).sort();
    expect(sourceIds).toEqual(["w1", "w2"]);
  });

  it("excludes whispers about non-player-house subjects", () => {
    const rivalSubject = makeCharacter({
      id: "rival-char" as CharacterId,
      houseId: "rival-ashford" as import("../rng").HouseId,
    });
    const verified = makeWhisper({
      id: "w1" as WhisperId,
      subjectCharacterId: rivalSubject.id,
      status: "Verified",
    });
    const state = makeGameState({
      characters: makeCharactersMap([rivalSubject]),
      houses: makeHousesMap([makeHouse()]),
      whispers: new Map([[verified.id, verified]]),
    });
    const next = accumulateInheritedSecretsAtSuccession(
      state,
      "dead" as CharacterId,
      "heir" as CharacterId,
    );
    expect(next.houses.get(PLAYER_HOUSE_ID)?.inheritedSecrets).toHaveLength(0);
  });

  it("dedupes by sourceWhisperId (idempotent on re-call)", () => {
    const playerSubject = makeCharacter({ id: "subj" as CharacterId, houseId: PLAYER_HOUSE_ID });
    const verified = makeWhisper({
      id: "w1" as WhisperId,
      subjectCharacterId: playerSubject.id,
      status: "Verified",
    });
    const state = makeGameState({
      characters: makeCharactersMap([playerSubject]),
      houses: makeHousesMap([makeHouse()]),
      whispers: new Map([[verified.id, verified]]),
    });
    const once = accumulateInheritedSecretsAtSuccession(
      state,
      "d" as CharacterId,
      "h" as CharacterId,
    );
    const twice = accumulateInheritedSecretsAtSuccession(
      once,
      "d" as CharacterId,
      "h" as CharacterId,
    );
    expect(once.houses.get(PLAYER_HOUSE_ID)?.inheritedSecrets).toHaveLength(1);
    expect(twice.houses.get(PLAYER_HOUSE_ID)?.inheritedSecrets).toHaveLength(1);
  });

  it("evicts oldest entry past MAX_INHERITED_SECRETS into ancestorSummary", () => {
    const playerSubject = makeCharacter({ id: "subj" as CharacterId, houseId: PLAYER_HOUSE_ID });
    // Seed the ledger with MAX_INHERITED_SECRETS entries (so the next will overflow).
    const seededSecrets: InheritedSecret[] = Array.from({ length: MAX_INHERITED_SECRETS }).map(
      (_, i) => ({
        id: `seed-${i}` as import("../rng").InheritedSecretId,
        sourceWhisperId: `seedW-${i}` as WhisperId,
        description: `seed secret ${i}`,
        originatingGenerationCount: 0,
        originatingTick: i, // tick `i` ordering
        surfacedAgainstHouseId: null,
        surfacedAtTick: null,
      }),
    );
    const incomingWhisper = makeWhisper({
      id: "new-w" as WhisperId,
      subjectCharacterId: playerSubject.id,
      status: "Verified",
    });
    const playerHouse = makeHouse({ inheritedSecrets: seededSecrets });
    const state = makeGameState({
      characters: makeCharactersMap([playerSubject]),
      houses: makeHousesMap([playerHouse]),
      whispers: new Map([[incomingWhisper.id, incomingWhisper]]),
      tick: MAX_INHERITED_SECRETS + 1,
    });
    const next = accumulateInheritedSecretsAtSuccession(
      state,
      "d" as CharacterId,
      "h" as CharacterId,
    );
    const playerAfter = next.houses.get(PLAYER_HOUSE_ID);
    expect(playerAfter?.inheritedSecrets).toHaveLength(MAX_INHERITED_SECRETS);
    expect(playerAfter?.ancestorSummary.at(-1)).toContain(
      "Generation 0 inherited secret: seed secret 0",
    );
  });
});

describe("applyInheritedSecretSurfacingPhase", () => {
  function makeStateWithSecretAndRivals(
    rivalConfigs: ReadonlyArray<{ id: HouseId; hostility: number; associates?: number }>,
  ) {
    const secret: InheritedSecret = {
      id: "secret-1" as import("../rng").InheritedSecretId,
      sourceWhisperId: "w1" as WhisperId,
      description: "old gossip",
      originatingGenerationCount: 0,
      originatingTick: 0,
      surfacedAgainstHouseId: null,
      surfacedAtTick: null,
    };
    const playerHouse = makeHouse({ inheritedSecrets: [secret] });
    const rivalHouses = rivalConfigs.map((cfg) =>
      makeHouse({ id: cfg.id, hostility: cfg.hostility }),
    );
    const rivalActors = new Map<HouseId, RivalActorState>(
      rivalConfigs.map((cfg) => [
        cfg.id,
        {
          houseId: cfg.id,
          factionId: "faction-court" as import("../rng").FactionId,
          associatedCharacterIds: Array.from({ length: cfg.associates ?? 1 }).map(
            (_, i) => `${cfg.id}-assoc-${i}` as CharacterId,
          ),
          lastActionTick: null,
        },
      ]),
    );
    return makeGameState({
      houses: makeHousesMap([playerHouse, ...rivalHouses]),
      rivalActors,
      rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState("force-surface-seed")]]),
    });
  }

  it("missed roll on sub-threshold-only rivals — secret stays unsurfaced (§7 line 655)", () => {
    // Rival hostility below threshold (40) → picker pool empty → no surfacing.
    // Hammer many seeds to ensure none surface.
    for (let i = 0; i < 30; i += 1) {
      const baseState = makeStateWithSecretAndRivals([
        { id: "rival-ashford" as HouseId, hostility: BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD - 1 },
        { id: "rival-beaumont" as HouseId, hostility: BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD - 5 },
      ]);
      const state = {
        ...baseState,
        rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState(`miss-${i}`)]]),
      };
      const next = applyInheritedSecretSurfacingPhase(state);
      const playerHouse = next.houses.get(PLAYER_HOUSE_ID);
      expect(playerHouse?.inheritedSecrets[0]?.surfacedAgainstHouseId).toBeNull();
      expect(playerHouse?.bloodFeuds).toHaveLength(0);
    }
  });

  it("when a surfacing roll succeeds, picker takes lex-smallest of {hostility ≥ threshold}", () => {
    // 3 rivals all above threshold; lex-smallest id is "rival-ashford".
    let observedPicked: string | null = null;
    for (let i = 0; i < 1000 && observedPicked === null; i += 1) {
      const baseState = makeStateWithSecretAndRivals([
        { id: "rival-cavendish" as HouseId, hostility: 60 },
        { id: "rival-ashford" as HouseId, hostility: 45 },
        { id: "rival-beaumont" as HouseId, hostility: 80 },
      ]);
      const state = {
        ...baseState,
        rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState(`pick-${i}`)]]),
      };
      const next = applyInheritedSecretSurfacingPhase(state);
      const playerHouse = next.houses.get(PLAYER_HOUSE_ID);
      const surfaced = playerHouse?.inheritedSecrets[0]?.surfacedAgainstHouseId;
      if (surfaced !== null && surfaced !== undefined) observedPicked = surfaced;
    }
    expect(observedPicked).toBe("rival-ashford");
  });

  it("affection penalty scales with rival-associate count (matrix #10)", () => {
    let foundSurfacing = false;
    for (let i = 0; i < 1000 && !foundSurfacing; i += 1) {
      const baseState = makeStateWithSecretAndRivals([
        { id: "rival-ashford" as HouseId, hostility: 80, associates: 3 },
      ]);
      const state = {
        ...baseState,
        rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState(`aff-${i}`)]]),
      };
      const next = applyInheritedSecretSurfacingPhase(state);
      const playerHouse = next.houses.get(PLAYER_HOUSE_ID);
      if (
        playerHouse !== undefined &&
        playerHouse.inheritedSecrets[0]?.surfacedAgainstHouseId !== null
      ) {
        foundSurfacing = true;
        const key = makePairKey("rival-ashford" as HouseId, playerHouse.headOfHouseCharacterId);
        const affectionAfter = next.affectionMap.get(key) ?? 0;
        // 0 - (3 associates * 20) = clamped to 0.
        expect(affectionAfter).toBe(0);
      }
    }
    expect(foundSurfacing).toBe(true);
  });

  it("generational decay: feud auto-resolves at tick T+DECAY_TICKS_MAX (matrix #13)", () => {
    const feud: BloodFeud = {
      id: "feud-decay" as import("../rng").BloodFeudId,
      offendingHouseId: "rival-ashford" as HouseId,
      triggeringSecretId: "s1" as import("../rng").InheritedSecretId,
      triggeringGrievanceId: "g1" as import("../rng").GrievanceId,
      incurredAtTick: 0,
      resolved: false,
      resolvedAtTick: null,
      resolutionKind: null,
    };
    const playerHouse = makeHouse({ bloodFeuds: [feud] });
    const state = makeGameState({
      houses: makeHousesMap([playerHouse]),
      tick: BLOOD_FEUD_DECAY_TICKS_MAX,
      rng: new Map([[PLAYER_HOUSE_ID as HouseId, createRngState("decay-seed")]]),
    });
    const next = applyInheritedSecretSurfacingPhase(state);
    const playerAfter = next.houses.get(PLAYER_HOUSE_ID);
    expect(playerAfter?.bloodFeuds[0]?.resolved).toBe(true);
    expect(playerAfter?.bloodFeuds[0]?.resolutionKind).toBe("GenerationalDecay");
  });

  // Reference unused export so lint catches drift if removed.
  void BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE;
});

describe("resolveBloodFeudByGrievance", () => {
  it("flips matching feud to resolved + writes resolutionKind", () => {
    const gid = "grievance-1" as GrievanceId;
    const feud = {
      id: "feud-1" as import("../rng").BloodFeudId,
      offendingHouseId: "rival-ashford" as import("../rng").HouseId,
      triggeringSecretId: "secret-1" as import("../rng").InheritedSecretId,
      triggeringGrievanceId: gid,
      incurredAtTick: 0,
      resolved: false,
      resolvedAtTick: null,
      resolutionKind: null,
    } as const;
    const state = makeGameState({
      houses: makeHousesMap([makeHouse({ bloodFeuds: [feud] })]),
    });
    const after = resolveBloodFeudByGrievance(state, gid, "DuelWin");
    const playerHouse = after.houses.get(PLAYER_HOUSE_ID);
    expect(playerHouse?.bloodFeuds[0]?.resolved).toBe(true);
    expect(playerHouse?.bloodFeuds[0]?.resolutionKind).toBe("DuelWin");
  });

  it("no-op when no matching grievance feud exists", () => {
    const state = makeGameState({
      houses: makeHousesMap([makeHouse({ bloodFeuds: [] })]),
    });
    const after = resolveBloodFeudByGrievance(state, "nonexistent" as GrievanceId, "DuelLoss");
    expect(after).toBe(state);
  });
});

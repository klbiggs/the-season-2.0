// P6: whispers rule layer tests. Covers per-branch weaponization outcomes
// (Blackmail / Scandal Sheet / Accidental Slip), verification cadence,
// courier drain, orphan-prune cascade extension (whispers about dead
// subjects flip to Dismissed), and the ingest-filter predicate-alignment
// (SubjectIsSelf, SubjectIsDead, WhisperNotVerified).

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import type {
  Character,
  CourierPayload,
  GameState,
  MarriageRecord,
  StaffMember,
  Whisper,
} from "../entities";
import type {
  CharacterId,
  CourierPayloadId,
  HouseId,
  MarriageId,
  RngState,
  StaffId,
  WhisperId,
} from "../rng";
import { PLAYER_HOUSE_ID } from "../rng";
import { pruneOrphanedConversationKeys } from "./aging";
import {
  applyCourierDrainStep,
  applyWhisperVerificationPhase,
  dismissWhisper,
  pickWallflowerBonusSubject,
  tryWeaponizeWhisper,
} from "./whispers";

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 0,
    rng: new Map<HouseId, RngState>([[PLAYER_HOUSE_ID, { seed: "test-seed", callCount: 0 }]]),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName: "test-campaign",
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
    whispers: new Map<WhisperId, Whisper>(),
    couriers: new Map<CourierPayloadId, CourierPayload>(),
    staff: new Map<StaffId, StaffMember>(),
    proposalsLog: new Map(),
    tutorAssignmentsLog: new Map(),
    pendingTutorTraitChoices: new Map(),
    // P8 defaults
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    elopement: null,
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
    globalEvents: new Map(),
    ...overrides,
  };
}

function makeWhisper(overrides: Partial<Whisper> = {}): Whisper {
  return {
    id: "w-1" as WhisperId,
    text: "test whisper",
    originatingTick: 0,
    sourceCharacterId: "src" as CharacterId,
    subjectCharacterId: "subj" as CharacterId,
    destinationHouseId: PLAYER_HOUSE_ID,
    arrivedAtTick: 1,
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

describe("applyWhisperVerificationPhase", () => {
  it("increments verification on arrived Unverified whispers", () => {
    const w = makeWhisper({
      status: "Unverified",
      verificationProgress: 0,
      arrivedAtTick: 0,
    });
    const state = makeState({ tick: 1, whispers: new Map([[w.id, w]]) });
    const next = applyWhisperVerificationPhase(state);
    expect(next.whispers.get(w.id)?.verificationProgress).toBe(10);
    expect(next.whispers.get(w.id)?.status).toBe("Unverified");
  });

  it("flips to Verified when progress crosses 100", () => {
    const w = makeWhisper({
      status: "Unverified",
      verificationProgress: 95,
      arrivedAtTick: 0,
    });
    const state = makeState({ tick: 1, whispers: new Map([[w.id, w]]) });
    const next = applyWhisperVerificationPhase(state);
    expect(next.whispers.get(w.id)?.verificationProgress).toBe(100);
    expect(next.whispers.get(w.id)?.status).toBe("Verified");
  });

  it("skips Unverified whispers that have NOT arrived (arrivedAtTick: null)", () => {
    const w = makeWhisper({
      status: "Unverified",
      verificationProgress: 0,
      arrivedAtTick: null,
    });
    const state = makeState({ tick: 1, whispers: new Map([[w.id, w]]) });
    const next = applyWhisperVerificationPhase(state);
    expect(next.whispers.get(w.id)?.verificationProgress).toBe(0);
  });
});

describe("applyCourierDrainStep", () => {
  it("flips arriving InFlight courier to Delivered AND sets whisper arrivedAtTick", () => {
    const w = makeWhisper({ status: "Unverified", arrivedAtTick: null });
    const c: CourierPayload = {
      id: "courier:player:0:0" as CourierPayloadId,
      payloadType: "Whisper",
      whisperId: w.id,
      originHouseId: PLAYER_HOUSE_ID,
      destinationHouseId: PLAYER_HOUSE_ID,
      originLocation: "Capital",
      destinationLocation: "Capital",
      originTick: 0,
      arrivalTick: 5,
      interceptable: true,
      direction: "Inbound",
      status: "InFlight",
      resolvedAtTick: null,
    };
    const state = makeState({
      tick: 5,
      whispers: new Map([[w.id, w]]),
      couriers: new Map([[c.id, c]]),
    });
    const next = applyCourierDrainStep(state);
    expect(next.couriers.get(c.id)?.status).toBe("Delivered");
    expect(next.couriers.get(c.id)?.resolvedAtTick).toBe(5);
    expect(next.whispers.get(w.id)?.arrivedAtTick).toBe(5);
  });

  it("does NOT touch couriers whose arrival is in the future", () => {
    const w = makeWhisper({ status: "Unverified", arrivedAtTick: null });
    const c: CourierPayload = {
      id: "courier:player:0:0" as CourierPayloadId,
      payloadType: "Whisper",
      whisperId: w.id,
      originHouseId: PLAYER_HOUSE_ID,
      destinationHouseId: PLAYER_HOUSE_ID,
      originLocation: "Capital",
      destinationLocation: "Capital",
      originTick: 0,
      arrivalTick: 10,
      interceptable: true,
      direction: "Inbound",
      status: "InFlight",
      resolvedAtTick: null,
    };
    const state = makeState({
      tick: 5,
      whispers: new Map([[w.id, w]]),
      couriers: new Map([[c.id, c]]),
    });
    const next = applyCourierDrainStep(state);
    expect(next.couriers.get(c.id)?.status).toBe("InFlight");
    expect(next.whispers.get(w.id)?.arrivedAtTick).toBe(null);
  });
});

describe("tryWeaponizeWhisper — Blackmail", () => {
  it("flips status to Weaponized, applies scandal + affection deltas", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, scandal: 5 });
    const subjectHouse = makeHouse({ id: "indep" as HouseId, reputation: 50 });
    const subj = makeCharacter({
      id: "subj" as CharacterId,
      houseId: "indep" as HouseId,
    });
    const w = makeWhisper({ subjectCharacterId: subj.id });
    const state = makeState({
      houses: makeHousesMap([player, subjectHouse]),
      characters: makeCharactersMap([subj]),
      whispers: new Map([[w.id, w]]),
    });
    const result = tryWeaponizeWhisper(state, PLAYER_HOUSE_ID, w.id, "Blackmail");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(15); // 5+10
    expect(result.state.whispers.get(w.id)?.status).toBe("Weaponized");
    expect(result.state.whispers.get(w.id)?.weaponizedAs).toBe("Blackmail");
  });

  it("rejects when scandal+BLACKMAIL_SCANDAL_COST > 100", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID, scandal: 95 });
    const subjectHouse = makeHouse({ id: "indep" as HouseId });
    const subj = makeCharacter({ id: "subj" as CharacterId, houseId: "indep" as HouseId });
    const w = makeWhisper({ subjectCharacterId: subj.id });
    const state = makeState({
      houses: makeHousesMap([player, subjectHouse]),
      characters: makeCharactersMap([subj]),
      whispers: new Map([[w.id, w]]),
    });
    const result = tryWeaponizeWhisper(state, PLAYER_HOUSE_ID, w.id, "Blackmail");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe("BlackmailInsufficientScandalCapacity");
  });
});

describe("tryWeaponizeWhisper — ScandalSheet", () => {
  it("drops subject-house reputation; attribution roll uses owner RNG", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID });
    const subjectHouse = makeHouse({ id: "indep" as HouseId, reputation: 60 });
    const subj = makeCharacter({ id: "subj" as CharacterId, houseId: "indep" as HouseId });
    const w = makeWhisper({ subjectCharacterId: subj.id });
    const state = makeState({
      houses: makeHousesMap([player, subjectHouse]),
      characters: makeCharactersMap([subj]),
      whispers: new Map([[w.id, w]]),
    });
    const result = tryWeaponizeWhisper(state, PLAYER_HOUSE_ID, w.id, "ScandalSheet");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.houses.get("indep" as HouseId)?.reputation).toBe(30); // 60-30
    expect(result.state.whispers.get(w.id)?.weaponizedAs).toBe("ScandalSheet");
    expect(typeof result.state.whispers.get(w.id)?.scandalSheetAttribution).toBe("boolean");
    // RNG callCount should have advanced exactly once
    expect(result.state.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(1);
  });
});

describe("tryWeaponizeWhisper — AccidentalSlip", () => {
  it("sets accidentalSlipDripsRemaining to ACCIDENTAL_SLIP_DURATION_TICKS", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID });
    const subjectHouse = makeHouse({ id: "indep" as HouseId });
    const subj = makeCharacter({ id: "subj" as CharacterId, houseId: "indep" as HouseId });
    const w = makeWhisper({ subjectCharacterId: subj.id });
    const state = makeState({
      houses: makeHousesMap([player, subjectHouse]),
      characters: makeCharactersMap([subj]),
      whispers: new Map([[w.id, w]]),
    });
    const result = tryWeaponizeWhisper(state, PLAYER_HOUSE_ID, w.id, "AccidentalSlip");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.whispers.get(w.id)?.accidentalSlipDripsRemaining).toBe(5);
    expect(result.state.whispers.get(w.id)?.weaponizedAs).toBe("AccidentalSlip");
  });
});

describe("tryWeaponizeWhisper — rejections", () => {
  it("rejects SubjectIsSelf (subject in player's house)", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID });
    const selfChar = makeCharacter({ id: "self" as CharacterId, houseId: PLAYER_HOUSE_ID });
    const w = makeWhisper({ subjectCharacterId: selfChar.id });
    const state = makeState({
      houses: makeHousesMap([player]),
      characters: makeCharactersMap([selfChar]),
      whispers: new Map([[w.id, w]]),
    });
    const result = tryWeaponizeWhisper(state, PLAYER_HOUSE_ID, w.id, "Blackmail");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe("SubjectIsSelf");
  });

  it("rejects SubjectIsDead", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID });
    const subjectHouse = makeHouse({ id: "indep" as HouseId });
    const subj = makeCharacter({
      id: "subj" as CharacterId,
      houseId: "indep" as HouseId,
      alive: false,
    });
    const w = makeWhisper({ subjectCharacterId: subj.id });
    const state = makeState({
      houses: makeHousesMap([player, subjectHouse]),
      characters: makeCharactersMap([subj]),
      whispers: new Map([[w.id, w]]),
    });
    const result = tryWeaponizeWhisper(state, PLAYER_HOUSE_ID, w.id, "Blackmail");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe("SubjectIsDead");
  });

  it("rejects WhisperNotVerified for Unverified whispers", () => {
    const player = makeHouse({ id: PLAYER_HOUSE_ID });
    const subjectHouse = makeHouse({ id: "indep" as HouseId });
    const subj = makeCharacter({ id: "subj" as CharacterId, houseId: "indep" as HouseId });
    const w = makeWhisper({ subjectCharacterId: subj.id, status: "Unverified" });
    const state = makeState({
      houses: makeHousesMap([player, subjectHouse]),
      characters: makeCharactersMap([subj]),
      whispers: new Map([[w.id, w]]),
    });
    const result = tryWeaponizeWhisper(state, PLAYER_HOUSE_ID, w.id, "Blackmail");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe("WhisperNotVerified");
  });
});

describe("dismissWhisper", () => {
  it("flips Verified to Dismissed", () => {
    const w = makeWhisper({ status: "Verified" });
    const state = makeState({ whispers: new Map([[w.id, w]]) });
    const result = dismissWhisper(state, w.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.whispers.get(w.id)?.status).toBe("Dismissed");
  });

  it("rejects already-Weaponized whispers", () => {
    const w = makeWhisper({ status: "Weaponized", weaponizedAs: "Blackmail" });
    const state = makeState({ whispers: new Map([[w.id, w]]) });
    const result = dismissWhisper(state, w.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe("WhisperAlreadyTerminal");
  });
});

describe("pruneOrphanedConversationKeys whisper extension", () => {
  it("dismisses Unverified whispers about newly-dead subjects", () => {
    const w = makeWhisper({
      subjectCharacterId: "dead" as CharacterId,
      status: "Unverified",
    });
    const state = makeState({ whispers: new Map([[w.id, w]]) });
    const next = pruneOrphanedConversationKeys(state, new Set(["dead" as CharacterId]));
    expect(next.whispers.get(w.id)?.status).toBe("Dismissed");
  });

  it("dismisses Verified whispers about newly-dead subjects", () => {
    const w = makeWhisper({ subjectCharacterId: "dead" as CharacterId, status: "Verified" });
    const state = makeState({ whispers: new Map([[w.id, w]]) });
    const next = pruneOrphanedConversationKeys(state, new Set(["dead" as CharacterId]));
    expect(next.whispers.get(w.id)?.status).toBe("Dismissed");
  });

  it("preserves already-Weaponized whispers past subject death", () => {
    const w = makeWhisper({
      subjectCharacterId: "dead" as CharacterId,
      status: "Weaponized",
      weaponizedAs: "ScandalSheet",
    });
    const state = makeState({ whispers: new Map([[w.id, w]]) });
    const next = pruneOrphanedConversationKeys(state, new Set(["dead" as CharacterId]));
    expect(next.whispers.get(w.id)?.status).toBe("Weaponized");
  });
});

describe("pickWallflowerBonusSubject", () => {
  it("returns lex-smallest living non-player non-target", () => {
    const target = makeCharacter({
      id: "char-zeta" as CharacterId,
      houseId: "indep" as HouseId,
    });
    const c1 = makeCharacter({ id: "char-alpha" as CharacterId, houseId: "indep" as HouseId });
    const c2 = makeCharacter({ id: "char-beta" as CharacterId, houseId: "indep" as HouseId });
    const state = makeState({ characters: makeCharactersMap([target, c1, c2]) });
    const subject = pickWallflowerBonusSubject(state, target.id);
    expect(subject?.id).toBe("char-alpha");
  });

  it("returns null when no eligible non-target NPCs exist", () => {
    const target = makeCharacter({ id: "only-npc" as CharacterId, houseId: "indep" as HouseId });
    const state = makeState({ characters: makeCharactersMap([target]) });
    expect(pickWallflowerBonusSubject(state, target.id)).toBe(null);
  });
});

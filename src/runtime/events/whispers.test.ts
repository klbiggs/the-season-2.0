// P6 followup: load-bearing advisory Vitests for the whisper event-bus
// diff-helper + cascade-vs-player Dismissed asymmetry + wallflower-bonus
// distinct-id assertion. Each test names the load-bearing invariant it
// locks so a future refactor that breaks one of these gets a named
// failure pointing at the rationale.

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeHouse,
  makeHousesMap,
} from "../../game/__test-utils__/factories";
import { ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION } from "../../game/constants";
import type {
  Character,
  CourierPayload,
  GameState,
  MarriageRecord,
  StaffMember,
  Whisper,
} from "../../game/entities";
import { makeWhisperId } from "../../game/fixtures/whisperIdFactory";
import type {
  CharacterId,
  CourierPayloadId,
  HouseId,
  MarriageId,
  RngState,
  StaffId,
  WhisperId,
} from "../../game/rng";
import { PLAYER_HOUSE_ID } from "../../game/rng";
import { pruneOrphanedConversationKeys } from "../../game/rules/aging";
import { applyAccidentalSlipDripOnConversation } from "../../game/rules/whispers";
import { clamp } from "../../game/util/clamp";
import { type WhisperEvent, publishWhisperTransitions, whisperBus } from "./whispers";

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

// ── publishWhisperTransitions skip-rule (resolves C-tail Vitest) ────────
describe("publishWhisperTransitions skip-rule", () => {
  it("Verified→Weaponized: emits exactly ONE WhisperWeaponized when wrapperPublishedKeys is EMPTY (diff-helper path)", () => {
    const before = makeState({ whispers: new Map([["w-1" as WhisperId, makeWhisper()]]) });
    const after = makeState({
      tick: 1,
      whispers: new Map([
        [
          "w-1" as WhisperId,
          makeWhisper({ status: "Weaponized", weaponizedAs: "Blackmail", weaponizedAtTick: 1 }),
        ],
      ]),
    });
    const events: WhisperEvent[] = [];
    const unsub = whisperBus.subscribe("WhisperWeaponized", (e) => events.push(e));
    publishWhisperTransitions(before, after);
    unsub();
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe("WhisperWeaponized");
  });

  it("Verified→Weaponized: emits ZERO WhisperWeaponized when wrapperPublishedKeys contains the weaponize key (wrapper-owned skip)", () => {
    const before = makeState({ whispers: new Map([["w-1" as WhisperId, makeWhisper()]]) });
    const after = makeState({
      tick: 1,
      whispers: new Map([
        [
          "w-1" as WhisperId,
          makeWhisper({ status: "Weaponized", weaponizedAs: "Blackmail", weaponizedAtTick: 1 }),
        ],
      ]),
    });
    const events: WhisperEvent[] = [];
    const unsub = whisperBus.subscribe("WhisperWeaponized", (e) => events.push(e));
    publishWhisperTransitions(before, after, new Set(["weaponize:w-1"]));
    unsub();
    expect(events.length).toBe(0);
  });

  it("Cascade-path Unverified→Dismissed is NEVER skipped (no wrapper publishes it)", () => {
    const before = makeState({
      whispers: new Map([["w-1" as WhisperId, makeWhisper({ status: "Unverified" })]]),
    });
    const after = makeState({
      tick: 1,
      whispers: new Map([["w-1" as WhisperId, makeWhisper({ status: "Dismissed" })]]),
    });
    const events: WhisperEvent[] = [];
    const unsub = whisperBus.subscribe("WhisperDismissed", (e) => events.push(e));
    // wrapperPublishedKeys contains "dismiss:..." for some OTHER whisper —
    // shouldn't skip THIS whisper's cascade-path Dismissed transition.
    publishWhisperTransitions(before, after, new Set(["dismiss:w-other"]));
    unsub();
    expect(events.length).toBe(1);
  });

  it("Player-elected Verified→Dismissed IS skipped when wrapperPublishedKeys contains the dismiss key", () => {
    const before = makeState({ whispers: new Map([["w-1" as WhisperId, makeWhisper()]]) });
    const after = makeState({
      tick: 1,
      whispers: new Map([["w-1" as WhisperId, makeWhisper({ status: "Dismissed" })]]),
    });
    const events: WhisperEvent[] = [];
    const unsub = whisperBus.subscribe("WhisperDismissed", (e) => events.push(e));
    publishWhisperTransitions(before, after, new Set(["dismiss:w-1"]));
    unsub();
    expect(events.length).toBe(0);
  });
});

// ── Cascade vs player Dismissed asymmetry (C-tail flagged) ──────────────
describe("cascade vs player Dismissed asymmetry", () => {
  it("pruneOrphanedConversationKeys flips Unverified→Dismissed for whispers about dead subjects (cascade-path)", () => {
    const w = makeWhisper({ status: "Unverified" });
    const state = makeState({ whispers: new Map([[w.id, w]]) });
    const next = pruneOrphanedConversationKeys(state, new Set(["subj" as CharacterId]));
    expect(next.whispers.get(w.id)?.status).toBe("Dismissed");
  });

  it("pruneOrphanedConversationKeys flips Verified→Dismissed for whispers about dead subjects (cascade-path)", () => {
    const w = makeWhisper({ status: "Verified" });
    const state = makeState({ whispers: new Map([[w.id, w]]) });
    const next = pruneOrphanedConversationKeys(state, new Set(["subj" as CharacterId]));
    expect(next.whispers.get(w.id)?.status).toBe("Dismissed");
  });

  it("pruneOrphanedConversationKeys PRESERVES Weaponized whispers past subject death", () => {
    const w = makeWhisper({ status: "Weaponized", weaponizedAs: "Blackmail", weaponizedAtTick: 0 });
    const state = makeState({ whispers: new Map([[w.id, w]]) });
    const next = pruneOrphanedConversationKeys(state, new Set(["subj" as CharacterId]));
    expect(next.whispers.get(w.id)?.status).toBe("Weaponized");
  });
});

// ── Wallflower-bonus distinct-id assertion (C-tail flagged) ─────────────
describe("makeWhisperId (source, subject) partition", () => {
  it("two same-tick whispers from the same source about DIFFERENT subjects get distinct ids", () => {
    const npcA = makeCharacter({ id: "npc-a" as CharacterId, houseId: "indep" as HouseId });
    const npcB = makeCharacter({ id: "npc-b" as CharacterId, houseId: "indep" as HouseId });
    const npcSource = makeCharacter({ id: "npc-src" as CharacterId, houseId: "indep" as HouseId });
    const state = makeState({
      characters: makeCharactersMap([npcA, npcB, npcSource]),
    });
    // Synergy whisper: source = src, subject = a (target of conversation)
    const synergyId = makeWhisperId(state, npcSource.id, npcA.id);
    // Wallflower-bonus whisper: same source, different subject (b)
    const bonusId = makeWhisperId(state, npcSource.id, npcB.id);
    expect(synergyId).not.toBe(bonusId);
    // Both should get index 0 of their respective (source, subject) partition
    expect(synergyId).toContain(":0");
    expect(bonusId).toContain(":0");
  });

  it("two same-tick whispers from the same source about the SAME subject get incrementing indices", () => {
    const npcSubject = makeCharacter({
      id: "npc-subj" as CharacterId,
      houseId: "indep" as HouseId,
    });
    const npcSource = makeCharacter({ id: "npc-src" as CharacterId, houseId: "indep" as HouseId });
    let state = makeState({
      characters: makeCharactersMap([npcSubject, npcSource]),
    });
    const id0 = makeWhisperId(state, npcSource.id, npcSubject.id);
    // Add the first whisper to state so the next call sees it
    const w0: Whisper = makeWhisper({
      id: id0,
      sourceCharacterId: npcSource.id,
      subjectCharacterId: npcSubject.id,
    });
    state = { ...state, whispers: new Map([[id0, w0]]) };
    const id1 = makeWhisperId(state, npcSource.id, npcSubject.id);
    expect(id1).not.toBe(id0);
    expect(id0).toContain(":0");
    expect(id1).toContain(":1");
  });
});

// ── Slip-drip pure-rule == in-set-body Immer semantic-identity ──────────
// The plan pins applyAccidentalSlipDripOnConversation as the Vitest-testable
// shape; the inlined Immer block in sendBallroomMessage MUST produce the
// same result. This test simulates the Immer block manually (same shape)
// and compares against the pure rule's output.
describe("AccidentalSlip drip semantic-identity (pure rule == Immer block)", () => {
  it("pure rule and manual-Immer-simulation produce identical state for one active slip", () => {
    const subjHouse = makeHouse({ id: "subj-house" as HouseId, reputation: 50 });
    const subj = makeCharacter({
      id: "subj" as CharacterId,
      houseId: "subj-house" as HouseId,
    });
    const w = makeWhisper({
      subjectCharacterId: subj.id,
      status: "Weaponized",
      weaponizedAs: "AccidentalSlip",
      weaponizedAtTick: 0,
      accidentalSlipDripsRemaining: 5,
    });
    const beforeState = makeState({
      houses: makeHousesMap([subjHouse]),
      characters: makeCharactersMap([subj]),
      whispers: new Map([[w.id, w]]),
    });

    // Pure-rule path
    const pureOut = applyAccidentalSlipDripOnConversation(beforeState, subj.id);

    // Manual-Immer-simulation path — same mutation shape as the inlined
    // block in src/game/store.ts:sendBallroomMessage (after the P5 grievance
    // push, before publishWhisperTransitions).
    const simWhispers = new Map(beforeState.whispers);
    const simHouses = new Map(beforeState.houses);
    for (const [, sw] of simWhispers) {
      if (
        sw.status === "Weaponized" &&
        sw.weaponizedAs === "AccidentalSlip" &&
        sw.accidentalSlipDripsRemaining > 0 &&
        sw.subjectCharacterId === subj.id
      ) {
        const sh = simHouses.get(subj.houseId);
        if (sh !== undefined) {
          simHouses.set(subj.houseId, {
            ...sh,
            reputation: clamp(sh.reputation + ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION, 0, 100),
          });
        }
        simWhispers.set(sw.id, {
          ...sw,
          accidentalSlipDripsRemaining: sw.accidentalSlipDripsRemaining - 1,
        });
      }
    }
    const simOut = { ...beforeState, whispers: simWhispers, houses: simHouses };

    // Compare the surfaces the two paths mutate
    expect(pureOut.whispers.get(w.id)?.accidentalSlipDripsRemaining).toBe(4);
    expect(simOut.whispers.get(w.id)?.accidentalSlipDripsRemaining).toBe(4);
    expect(pureOut.houses.get(subj.houseId)?.reputation).toBe(48); // 50 - 2
    expect(simOut.houses.get(subj.houseId)?.reputation).toBe(48);
    // Semantic identity on the mutated entities
    expect(pureOut.whispers.get(w.id)).toEqual(simOut.whispers.get(w.id));
    expect(pureOut.houses.get(subj.houseId)).toEqual(simOut.houses.get(subj.houseId));
  });

  it("pure rule no-ops when no active slip targets the conversation subject", () => {
    const subjHouse = makeHouse({ id: "subj-house" as HouseId, reputation: 50 });
    const subj = makeCharacter({ id: "subj" as CharacterId, houseId: "subj-house" as HouseId });
    // Whisper exists but targets a DIFFERENT subject
    const otherSubj = makeCharacter({
      id: "other" as CharacterId,
      houseId: "subj-house" as HouseId,
    });
    const w = makeWhisper({
      subjectCharacterId: otherSubj.id,
      status: "Weaponized",
      weaponizedAs: "AccidentalSlip",
      accidentalSlipDripsRemaining: 5,
    });
    const beforeState = makeState({
      houses: makeHousesMap([subjHouse]),
      characters: makeCharactersMap([subj, otherSubj]),
      whispers: new Map([[w.id, w]]),
    });
    const out = applyAccidentalSlipDripOnConversation(beforeState, subj.id);
    // Reputation unchanged; drips counter unchanged
    expect(out.houses.get(subj.houseId)?.reputation).toBe(50);
    expect(out.whispers.get(w.id)?.accidentalSlipDripsRemaining).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import { makeCharacter, makeCharactersMap, makeHouse } from "../__test-utils__/factories";
import { ELOPEMENT_LOSS_SCANDAL_DELTA } from "../constants";
import { type ConversationPairKey, type Exchange, makePairKey } from "../conversation/types";
import type { Character, GameState, MarriageRecord } from "../entities";
import type { CharacterId, HouseId, MarriageId, RngState } from "../rng";
import { PLAYER_HOUSE_ID } from "../rng.seeds";
import { applyAgingStep, pruneOrphanedConversationKeys } from "./aging";

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 0,
    rng: new Map<HouseId, RngState>(),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName: "test-campaign",
    era: "Earlier",
    conversationHistory: new Map(),
    affectionMap: new Map(),
    schemes: new Map(),
    whispers: new Map(),
    couriers: new Map(),
    staff: new Map(),
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
    flavorText: new Map(),
    betrothals: new Map(),
    ...overrides,
  };
}

describe("applyAgingStep", () => {
  it("increments age by 1 for living characters", () => {
    const c = makeCharacter({ id: "c1" as CharacterId, age: 25, deathAge: 90 });
    const state = makeState({ characters: makeCharactersMap([c]) });
    const next = applyAgingStep(state);
    expect(next.characters.get(c.id)?.age).toBe(26);
    expect(next.characters.get(c.id)?.alive).toBe(true);
  });
  it("marks death when age >= deathAge after increment (>= not ===)", () => {
    const c = makeCharacter({ id: "c1" as CharacterId, age: 94, deathAge: 95 });
    const state = makeState({ tick: 70, characters: makeCharactersMap([c]) });
    const next = applyAgingStep(state);
    const updated = next.characters.get(c.id);
    expect(updated?.age).toBe(95);
    expect(updated?.alive).toBe(false);
    expect(updated?.diedAtTick).toBe(70);
  });
  it("skips already-dead characters (no age increment)", () => {
    const c = makeCharacter({ id: "c1" as CharacterId, age: 80, alive: false, diedAtTick: 50 });
    const state = makeState({ characters: makeCharactersMap([c]) });
    const next = applyAgingStep(state);
    expect(next.characters.get(c.id)?.age).toBe(80);
    expect(next.characters.get(c.id)?.diedAtTick).toBe(50);
  });
  it("no PRNG draws consumed (callCount unchanged)", () => {
    const c = makeCharacter({ id: "c1" as CharacterId });
    const state = makeState({ characters: makeCharactersMap([c]) });
    const next = applyAgingStep(state);
    // rng map is unchanged
    expect(next.rng).toBe(state.rng);
  });
});

// P4: §7 "Conversation history orphan keys" — on character death, prune
// conversationHistory + affectionMap entries keyed on the dead NPC. Heir-
// promotion safety: filter by parsePairKey(key).characterId so PLAYER head
// death does NOT touch entries keyed on the player house.
describe("applyAgingStep orphan-prune (P4)", () => {
  function makeExchange(tick: number, text: string): Exchange {
    return { speaker: "house-head", text, classifiedTactic: null, tick };
  }

  it("prunes conversationHistory and affectionMap entries when an NPC dies", () => {
    const npc = makeCharacter({
      id: "npc-1" as CharacterId,
      age: 94,
      deathAge: 95,
      alive: true,
      houseId: "independent" as HouseId,
    });
    const survivor = makeCharacter({
      id: "npc-2" as CharacterId,
      age: 25,
      deathAge: 90,
      alive: true,
      houseId: "independent" as HouseId,
    });
    const deadKey = makePairKey(PLAYER_HOUSE_ID, npc.id);
    const liveKey = makePairKey(PLAYER_HOUSE_ID, survivor.id);
    const conversationHistory = new Map<ConversationPairKey, Exchange[]>([
      [deadKey, [makeExchange(0, "hello")]],
      [liveKey, [makeExchange(0, "hello")]],
    ]);
    const affectionMap = new Map<ConversationPairKey, number>([
      [deadKey, 42],
      [liveKey, 17],
    ]);
    const state = makeState({
      characters: makeCharactersMap([npc, survivor]),
      conversationHistory,
      affectionMap,
    });
    const next = applyAgingStep(state);
    expect(next.conversationHistory.has(deadKey)).toBe(false);
    expect(next.conversationHistory.has(liveKey)).toBe(true);
    expect(next.affectionMap.has(deadKey)).toBe(false);
    expect(next.affectionMap.has(liveKey)).toBe(true);
  });

  it("does NOT prune when the player head dies (heir inherits via stable houseId)", () => {
    // The pair key shape is `${PLAYER_HOUSE_ID}|${targetCharacterId}` — the
    // player head's ID is on the LEFT side (filtered as houseId, not
    // characterId). The prune filters by characterId, so player-head death
    // doesn't touch entries keyed on a target NPC.
    const playerHead = makeCharacter({
      id: "player-head" as CharacterId,
      age: 94,
      deathAge: 95,
      alive: true,
      houseId: PLAYER_HOUSE_ID,
    });
    const targetNpc = makeCharacter({
      id: "npc-1" as CharacterId,
      age: 25,
      deathAge: 90,
      alive: true,
      houseId: "independent" as HouseId,
    });
    const targetKey = makePairKey(PLAYER_HOUSE_ID, targetNpc.id);
    const conversationHistory = new Map<ConversationPairKey, Exchange[]>([
      [targetKey, [makeExchange(0, "hello")]],
    ]);
    const affectionMap = new Map<ConversationPairKey, number>([[targetKey, 50]]);
    const state = makeState({
      characters: makeCharactersMap([playerHead, targetNpc]),
      conversationHistory,
      affectionMap,
    });
    const next = applyAgingStep(state);
    expect(next.conversationHistory.has(targetKey)).toBe(true);
    expect(next.affectionMap.has(targetKey)).toBe(true);
  });

  it("no death this step → conversationHistory + affectionMap untouched (referential)", () => {
    const c = makeCharacter({ id: "c1" as CharacterId, age: 25, deathAge: 90 });
    const state = makeState({ characters: makeCharactersMap([c]) });
    const next = applyAgingStep(state);
    expect(next.conversationHistory).toBe(state.conversationHistory);
    expect(next.affectionMap).toBe(state.affectionMap);
  });
});

describe("pruneOrphanedConversationKeys branch 5 — elopement sprint cleanup", () => {
  // Branch 5 nulls state.elopement and bumps player house scandal by +50 when
  // the eloping character or target appears in newlyDeadCharIds. The branch
  // is unreachable end-to-end at v1 (Q4 gate blocks tick-advance while sprint
  // active), so these tests invoke pruneOrphanedConversationKeys DIRECTLY
  // with synthetic state.

  it("nulls state.elopement and applies +50 scandal on eloping-character death", () => {
    const elopingId = "elope-1" as CharacterId;
    const targetId = "target-1" as CharacterId;
    const eloping = makeCharacter({ id: elopingId, alive: false, diedAtTick: 5 });
    const target = makeCharacter({ id: targetId });
    const playerHouse = makeHouse({ id: PLAYER_HOUSE_ID, scandal: 10 });
    const state = makeState({
      tick: 5,
      characters: makeCharactersMap([eloping, target]),
      houses: new Map([[PLAYER_HOUSE_ID, playerHouse]]),
      elopement: {
        schemeId: "s1" as never,
        elopingCharacterId: elopingId,
        targetCharacterId: targetId,
        playerTilePosition: 3,
        fatherTilePosition: 1,
        freshHorsesUsedCount: 0,
        startedAtTick: 0,
      },
    });
    const result = pruneOrphanedConversationKeys(state, new Set([elopingId]));
    expect(result.elopement).toBeNull();
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(10 + ELOPEMENT_LOSS_SCANDAL_DELTA);
  });

  it("nulls state.elopement and applies +50 scandal on target death", () => {
    const elopingId = "elope-2" as CharacterId;
    const targetId = "target-2" as CharacterId;
    const eloping = makeCharacter({ id: elopingId });
    const target = makeCharacter({ id: targetId, alive: false, diedAtTick: 5 });
    const playerHouse = makeHouse({ id: PLAYER_HOUSE_ID, scandal: 0 });
    const state = makeState({
      tick: 5,
      characters: makeCharactersMap([eloping, target]),
      houses: new Map([[PLAYER_HOUSE_ID, playerHouse]]),
      elopement: {
        schemeId: "s1" as never,
        elopingCharacterId: elopingId,
        targetCharacterId: targetId,
        playerTilePosition: 3,
        fatherTilePosition: 1,
        freshHorsesUsedCount: 0,
        startedAtTick: 0,
      },
    });
    const result = pruneOrphanedConversationKeys(state, new Set([targetId]));
    expect(result.elopement).toBeNull();
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(ELOPEMENT_LOSS_SCANDAL_DELTA);
  });

  it("leaves state.elopement untouched when an unrelated character dies", () => {
    const elopingId = "elope-3" as CharacterId;
    const targetId = "target-3" as CharacterId;
    const otherId = "other" as CharacterId;
    const sprint = {
      schemeId: "s1" as never,
      elopingCharacterId: elopingId,
      targetCharacterId: targetId,
      playerTilePosition: 3,
      fatherTilePosition: 1,
      freshHorsesUsedCount: 0,
      startedAtTick: 0,
    };
    const playerHouse = makeHouse({ id: PLAYER_HOUSE_ID, scandal: 5 });
    const state = makeState({
      tick: 5,
      characters: makeCharactersMap([
        makeCharacter({ id: elopingId }),
        makeCharacter({ id: targetId }),
        makeCharacter({ id: otherId, alive: false }),
      ]),
      houses: new Map([[PLAYER_HOUSE_ID, playerHouse]]),
      elopement: sprint,
    });
    const result = pruneOrphanedConversationKeys(state, new Set([otherId]));
    expect(result.elopement).toEqual(sprint);
    expect(result.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeGameState,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import {
  ADULTHOOD_AGE_IN_YEARS,
  BETROTHAL_BREAK_RIVAL_HOSTILITY_BUMP,
  BETROTHAL_BREAK_SCANDAL,
} from "../constants";
import type { GameState } from "../entities";
import { type CharacterId, type HouseId, PLAYER_HOUSE_ID } from "../rng";
import {
  applyArrangeBetrothalPure,
  applyBetrothalHonorStep,
  applyBreakBetrothalPure,
} from "./betrothal";

const PLAYER_CHILD = "player-child" as CharacterId;
const NPC_CHILD = "npc-child" as CharacterId;
const NPC_HOUSE = "independent" as HouseId;
const RIVAL_HOUSE = "rival-ashford" as HouseId;

function makeState(
  opts: {
    playerChildAge?: number;
    npcChildAge?: number;
    npcHouse?: HouseId;
    reputation?: number;
  } = {},
): GameState {
  const playerChild = makeCharacter({
    id: PLAYER_CHILD,
    houseId: PLAYER_HOUSE_ID,
    age: opts.playerChildAge ?? 10,
    role: "Dependent",
    gender: "Male",
  });
  const npcChild = makeCharacter({
    id: NPC_CHILD,
    houseId: opts.npcHouse ?? NPC_HOUSE,
    age: opts.npcChildAge ?? 10,
    role: "Dependent",
    gender: "Female",
  });
  return makeGameState({
    tick: 5,
    characters: makeCharactersMap([playerChild, npcChild]),
    houses: makeHousesMap([
      makeHouse({ id: PLAYER_HOUSE_ID, reputation: opts.reputation ?? 50 }),
      makeHouse({ id: opts.npcHouse ?? NPC_HOUSE }),
    ]),
  });
}

describe("applyArrangeBetrothalPure", () => {
  it("creates a Pending betrothal between a player child and a cross-house child", () => {
    const result = applyArrangeBetrothalPure(makeState(), PLAYER_CHILD, NPC_CHILD);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const b = result.nextState.betrothals.get(result.betrothalId);
      expect(b?.status).toBe("Pending");
      // Lex-sorted parties.
      expect(b?.partyAId).toBe(NPC_CHILD < PLAYER_CHILD ? NPC_CHILD : PLAYER_CHILD);
    }
  });

  it("rejects NotCrossHouse when neither party is in the player house", () => {
    const state = makeState();
    // Both NPC-house children.
    const other = makeCharacter({ id: "npc-2" as CharacterId, houseId: NPC_HOUSE, age: 10 });
    const chars = new Map(state.characters);
    chars.set(other.id, other);
    const result = applyArrangeBetrothalPure({ ...state, characters: chars }, NPC_CHILD, other.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("NotCrossHouse");
  });

  it("rejects BothPartiesAdult when both are already of age", () => {
    const result = applyArrangeBetrothalPure(
      makeState({ playerChildAge: 25, npcChildAge: 25 }),
      PLAYER_CHILD,
      NPC_CHILD,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("BothPartiesAdult");
  });

  it("rejects InsufficientReputation below the threshold", () => {
    const result = applyArrangeBetrothalPure(
      makeState({ reputation: 10 }),
      PLAYER_CHILD,
      NPC_CHILD,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe("InsufficientReputation");
  });

  it("rejects PartyAlreadyBetrothed on a second arrange for the same party", () => {
    const first = applyArrangeBetrothalPure(makeState(), PLAYER_CHILD, NPC_CHILD);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyArrangeBetrothalPure(first.nextState, PLAYER_CHILD, NPC_CHILD);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason.kind).toBe("PartyAlreadyBetrothed");
  });
});

describe("applyBreakBetrothalPure", () => {
  it("flips Pending → Broken and applies player scandal", () => {
    const arranged = applyArrangeBetrothalPure(makeState(), PLAYER_CHILD, NPC_CHILD);
    if (!arranged.ok) throw new Error("setup");
    const broken = applyBreakBetrothalPure(arranged.nextState, arranged.betrothalId);
    expect(broken.ok).toBe(true);
    if (broken.ok) {
      expect(broken.nextState.betrothals.get(arranged.betrothalId)?.status).toBe("Broken");
      expect(broken.nextState.houses.get(PLAYER_HOUSE_ID)?.scandal).toBe(BETROTHAL_BREAK_SCANDAL);
    }
  });

  it("bumps a jilted rival's hostility on break", () => {
    const state = makeState({ npcHouse: RIVAL_HOUSE });
    const arranged = applyArrangeBetrothalPure(state, PLAYER_CHILD, NPC_CHILD);
    if (!arranged.ok) throw new Error("setup");
    const beforeHostility = arranged.nextState.houses.get(RIVAL_HOUSE)?.hostility ?? 0;
    const broken = applyBreakBetrothalPure(arranged.nextState, arranged.betrothalId);
    expect(broken.ok).toBe(true);
    if (broken.ok) {
      expect(broken.nextState.houses.get(RIVAL_HOUSE)?.hostility).toBe(
        beforeHostility + BETROTHAL_BREAK_RIVAL_HOSTILITY_BUMP,
      );
    }
  });

  it("rejects BetrothalNotPending on a re-break", () => {
    const arranged = applyArrangeBetrothalPure(makeState(), PLAYER_CHILD, NPC_CHILD);
    if (!arranged.ok) throw new Error("setup");
    const broken = applyBreakBetrothalPure(arranged.nextState, arranged.betrothalId);
    if (!broken.ok) throw new Error("setup");
    const again = applyBreakBetrothalPure(broken.nextState, arranged.betrothalId);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason.kind).toBe("BetrothalNotPending");
  });
});

describe("applyBetrothalHonorStep", () => {
  it("auto-mints a marriage when both parties are adults", () => {
    // Both at adulthood, betrothal already Pending.
    const state = makeState({
      playerChildAge: ADULTHOOD_AGE_IN_YEARS,
      npcChildAge: ADULTHOOD_AGE_IN_YEARS,
    });
    const arranged = applyArrangeBetrothalPure(
      // arrange requires at least one pre-adult, so arrange while young then age up.
      makeState(),
      PLAYER_CHILD,
      NPC_CHILD,
    );
    if (!arranged.ok) throw new Error("setup");
    // Age both parties to adulthood on the arranged state.
    const chars = new Map(arranged.nextState.characters);
    for (const id of [PLAYER_CHILD, NPC_CHILD]) {
      const c = chars.get(id);
      if (c) chars.set(id, { ...c, age: ADULTHOOD_AGE_IN_YEARS });
    }
    const ready = { ...arranged.nextState, characters: chars, tick: 30, houses: state.houses };
    const after = applyBetrothalHonorStep(ready);
    const b = after.betrothals.get(arranged.betrothalId);
    expect(b?.status).toBe("Honored");
    expect(b?.honoredMarriageId).not.toBeNull();
    if (b?.honoredMarriageId) {
      expect(after.marriages.get(b.honoredMarriageId)?.dissolved).toBe(false);
    }
    // The NPC party flips to Spouse.
    expect(after.characters.get(NPC_CHILD)?.role).toBe("Spouse");
  });

  it("does NOT honor while a party is still under age", () => {
    const arranged = applyArrangeBetrothalPure(makeState(), PLAYER_CHILD, NPC_CHILD);
    if (!arranged.ok) throw new Error("setup");
    // Only the player child ages up; npc child stays 10.
    const chars = new Map(arranged.nextState.characters);
    const pc = chars.get(PLAYER_CHILD);
    if (pc) chars.set(PLAYER_CHILD, { ...pc, age: ADULTHOOD_AGE_IN_YEARS });
    const after = applyBetrothalHonorStep({ ...arranged.nextState, characters: chars });
    expect(after.betrothals.get(arranged.betrothalId)?.status).toBe("Pending");
  });

  it("is a no-op (returns same ref) with no Pending betrothals", () => {
    const state = makeState();
    expect(applyBetrothalHonorStep(state)).toBe(state);
  });
});

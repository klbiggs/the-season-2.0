// P25 R3 — NPC-initiated duels (DemandSatisfaction rival action). Tests that an
// eligible rival (holding an actionable grievance) can deterministically
// initiate + resolve a duel against the player, and that an ineligible rival
// never does.

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import type { Character, GameState, Grievance, MarriageRecord } from "../entities";
import {
  type CharacterId,
  type FactionId,
  type GrievanceId,
  type HouseId,
  type MarriageId,
  type RngState,
  createRngState,
} from "../rng";
import { PLAYER_HOUSE_ID } from "../rng.seeds";
import { applyRivalActionPhase } from "./rivals";

const RIVAL = "rival-ashford" as HouseId;
const RIVAL_HEAD = "rival-ashford-head" as CharacterId;
const PLAYER_CHAR = "player-a" as CharacterId;

function makeState(overrides: Partial<GameState>): GameState {
  return {
    tick: 50,
    rng: new Map<HouseId, RngState>(),
    houses: new Map(),
    characters: new Map<CharacterId, Character>(),
    marriages: new Map<MarriageId, MarriageRecord>(),
    campaignName: "test",
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
    patronesses: new Map(),
    rivalActors: new Map(),
    factionTensions: new Map(),
    duels: new Map(),
    elopements: new Map(),
    artifactInstances: new Map(),
    forgeries: new Map(),
    thiefAttempts: new Map(),
    proceduralArtifactDefinitions: new Map(),
    globalEvents: new Map(),
    flavorText: new Map(),
    betrothals: new Map(),
    ...overrides,
  };
}

function grievance(overrides: Partial<Grievance> = {}): Grievance {
  return {
    id: "griev-1" as GrievanceId,
    perpetratorHouseId: PLAYER_HOUSE_ID,
    defendantCharacterId: PLAYER_CHAR,
    source: "Sabotage",
    schemeId: null,
    recordedAtTick: 40,
    resolved: false,
    ...overrides,
  };
}

// Rival with hostility above the activation threshold (post -1 decay), cooldown
// ready, zero wealth (so OpenSabotage/Seduction pre-filter to 0), and the given
// grievances. The player char is an alive defendant in the non-exiled player house.
function eligibleRivalState(grievances: Grievance[]): GameState {
  const rivalHead = makeCharacter({
    id: RIVAL_HEAD,
    houseId: RIVAL,
    role: "HeadOfHouse",
    alive: true,
  });
  const playerChar = makeCharacter({ id: PLAYER_CHAR, houseId: PLAYER_HOUSE_ID, alive: true });
  const rivalHouse = makeHouse({
    id: RIVAL,
    headOfHouseCharacterId: RIVAL_HEAD,
    wealth: 0,
    reputation: 50,
    hostility: 40,
    grievances,
  });
  const playerHouse = makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: PLAYER_CHAR });
  return makeState({
    houses: makeHousesMap([rivalHouse, playerHouse]),
    characters: makeCharactersMap([rivalHead, playerChar]),
    rivalActors: new Map([
      [
        RIVAL,
        {
          houseId: RIVAL,
          factionId: "faction-court" as FactionId,
          associatedCharacterIds: [RIVAL_HEAD],
          lastActionTick: null,
        },
      ],
    ]),
  });
}

describe("P25 R3 — rival DemandSatisfaction (NPC-initiated duel)", () => {
  it("an eligible rival deterministically initiates + resolves a duel against the player", () => {
    const base = eligibleRivalState([grievance()]);
    // Deterministic seed search: find a rival RNG seed whose weighted pick lands
    // on DemandSatisfaction (self-contained — the search itself is deterministic).
    let fired: GameState | null = null;
    for (let i = 0; i < 300; i++) {
      const seeded: GameState = {
        ...base,
        rng: new Map(base.rng).set(RIVAL, createRngState(`seed-${i}`)),
      };
      const after = applyRivalActionPhase(seeded);
      if (after.duels.size > 0) {
        fired = after;
        break;
      }
    }
    expect(fired).not.toBeNull();
    const duel = [...(fired as GameState).duels.values()][0];
    expect(duel?.challengerCharacterId).toBe(RIVAL_HEAD);
    expect(duel?.defenderCharacterId).toBe(PLAYER_CHAR);
    expect(duel?.grievanceId).toBe("griev-1");
    expect(duel?.status).toBe("Resolved"); // resolved synchronously in-phase
    expect(["ChallengerVictory", "DefenderVictory", "Stalemate"]).toContain(duel?.outcome);
  });

  it("is deterministic — same seed produces the identical duel outcome", () => {
    const base = eligibleRivalState([grievance()]);
    const seeded: GameState = {
      ...base,
      rng: new Map(base.rng).set(RIVAL, createRngState("fixed")),
    };
    const a = applyRivalActionPhase(seeded);
    const b = applyRivalActionPhase(seeded);
    expect([...a.duels.values()]).toEqual([...b.duels.values()]);
  });

  it("an ineligible rival (no actionable grievance) never initiates a duel", () => {
    // A resolved grievance is not actionable.
    const base = eligibleRivalState([grievance({ resolved: true })]);
    for (let i = 0; i < 300; i++) {
      const seeded: GameState = {
        ...base,
        rng: new Map(base.rng).set(RIVAL, createRngState(`seed-${i}`)),
      };
      expect(applyRivalActionPhase(seeded).duels.size).toBe(0);
    }
  });

  it("a grievance whose defendant is dead is not actionable", () => {
    const rivalHead = makeCharacter({ id: RIVAL_HEAD, houseId: RIVAL, role: "HeadOfHouse" });
    const deadDefendant = makeCharacter({
      id: PLAYER_CHAR,
      houseId: PLAYER_HOUSE_ID,
      alive: false,
    });
    const rivalHouse = makeHouse({
      id: RIVAL,
      headOfHouseCharacterId: RIVAL_HEAD,
      wealth: 0,
      hostility: 40,
      grievances: [grievance()],
    });
    const playerHouse = makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: PLAYER_CHAR });
    const base = makeState({
      houses: makeHousesMap([rivalHouse, playerHouse]),
      characters: makeCharactersMap([rivalHead, deadDefendant]),
      rivalActors: new Map([
        [
          RIVAL,
          {
            houseId: RIVAL,
            factionId: "faction-court" as FactionId,
            associatedCharacterIds: [RIVAL_HEAD],
            lastActionTick: null,
          },
        ],
      ]),
    });
    for (let i = 0; i < 300; i++) {
      const seeded: GameState = {
        ...base,
        rng: new Map(base.rng).set(RIVAL, createRngState(`seed-${i}`)),
      };
      expect(applyRivalActionPhase(seeded).duels.size).toBe(0);
    }
  });
});

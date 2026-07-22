// P25 R3: publishDuelTransitions is a before/after diff helper. It must emit the
// full DuelInitiated / DuelResolved / GrievanceResolved stream — including the
// load-bearing same-tick mint+resolve case (a rival DemandSatisfaction duel is
// minted AND resolved inside one tick phase, so the diff sees absent→Resolved and
// must emit BOTH DuelInitiated and DuelResolved). Without coverage a dropped
// DuelInitiated branch would leave the UI silent while every other test stays green.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGameState, makeHouse, makeHousesMap } from "../../game/__test-utils__/factories";
import type { Duel, Grievance } from "../../game/entities";
import type { CharacterId, DuelId, GrievanceId, HouseId } from "../../game/rng";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { type DuelEvent, duelBus, publishDuelTransitions } from "./duels";

const RIVAL = "rival-ashford" as HouseId;
const GID = "grievance-1" as GrievanceId;

function makeDuel(overrides: Partial<Duel> = {}): Duel {
  return {
    id: "duel-1" as DuelId,
    challengerCharacterId: "rival-head" as CharacterId,
    defenderCharacterId: "player-kin" as CharacterId,
    grievanceId: GID,
    initiatedAtTick: 5,
    status: "Active",
    resolvedAtTick: null,
    outcome: null,
    loserCasualty: "Unharmed",
    exchangesElapsed: 0,
    ...overrides,
  };
}

function grievance(overrides: Partial<Grievance> = {}): Grievance {
  return {
    id: GID,
    perpetratorHouseId: RIVAL,
    defendantCharacterId: null,
    source: "Sabotage",
    schemeId: null,
    recordedAtTick: 3,
    resolved: false,
    ...overrides,
  };
}

// A player house carrying the grievance the duel resolves (so the perpetrator
// lookup in GrievanceResolved succeeds).
function stateWithGrievance(duels: Duel[], tick = 10) {
  return makeGameState({
    tick,
    houses: makeHousesMap([makeHouse({ id: PLAYER_HOUSE_ID, grievances: [grievance()] })]),
    duels: new Map(duels.map((d) => [d.id, d])),
  });
}

let captured: DuelEvent[] = [];
let unsubs: Array<() => void> = [];

beforeEach(() => {
  captured = [];
  unsubs = [
    duelBus.subscribe("DuelInitiated", (e) => captured.push(e)),
    duelBus.subscribe("DuelResolved", (e) => captured.push(e)),
    duelBus.subscribe("GrievanceResolved", (e) => captured.push(e)),
  ];
});
afterEach(() => {
  for (const u of unsubs) u();
});

describe("publishDuelTransitions", () => {
  it("same-tick mint+resolve (absent→Resolved) emits DuelInitiated AND DuelResolved AND GrievanceResolved", () => {
    const before = stateWithGrievance([]);
    const after = stateWithGrievance([
      makeDuel({
        status: "Resolved",
        resolvedAtTick: 10,
        outcome: "ChallengerVictory",
        loserCasualty: "Killed",
        exchangesElapsed: 4,
      }),
    ]);
    publishDuelTransitions(before, after);

    const kinds = captured.map((e) => e.kind);
    expect(kinds).toContain("DuelInitiated");
    expect(kinds).toContain("DuelResolved");
    expect(kinds).toContain("GrievanceResolved");

    const init = captured.find((e) => e.kind === "DuelInitiated");
    expect(init).toMatchObject({
      tick: 10,
      challengerCharacterId: "rival-head",
      defenderCharacterId: "player-kin",
    });
    const resolved = captured.find((e) => e.kind === "DuelResolved");
    expect(resolved).toMatchObject({
      tick: 10,
      outcome: "ChallengerVictory",
      loserCasualty: "Killed",
    });
    const gr = captured.find((e) => e.kind === "GrievanceResolved");
    expect(gr).toMatchObject({ grievanceId: GID, perpetratorHouseId: RIVAL });
  });

  it("committed Active→Resolved emits DuelResolved but NOT a second DuelInitiated", () => {
    const before = stateWithGrievance([makeDuel({ status: "Active" })]);
    const after = stateWithGrievance([
      makeDuel({
        status: "Resolved",
        resolvedAtTick: 10,
        outcome: "DefenderVictory",
        loserCasualty: "Wounded",
        exchangesElapsed: 6,
      }),
    ]);
    publishDuelTransitions(before, after);

    const kinds = captured.map((e) => e.kind);
    expect(kinds).not.toContain("DuelInitiated");
    expect(kinds).toContain("DuelResolved");
    expect(kinds).toContain("GrievanceResolved");
  });

  it("a Stalemate resolution emits DuelResolved but NO GrievanceResolved", () => {
    const before = stateWithGrievance([]);
    const after = stateWithGrievance([
      makeDuel({
        status: "Resolved",
        resolvedAtTick: 10,
        outcome: "Stalemate",
        loserCasualty: "Unharmed",
        exchangesElapsed: 12,
      }),
    ]);
    publishDuelTransitions(before, after);

    const kinds = captured.map((e) => e.kind);
    expect(kinds).toContain("DuelInitiated");
    expect(kinds).toContain("DuelResolved");
    expect(kinds).not.toContain("GrievanceResolved");
  });

  it("emits nothing when no duel changed status", () => {
    const before = stateWithGrievance([makeDuel({ status: "Active" })]);
    const after = stateWithGrievance([makeDuel({ status: "Active" })]);
    publishDuelTransitions(before, after);
    expect(captured).toHaveLength(0);
  });
});

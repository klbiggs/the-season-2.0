// P9/P24a — bus event tests for the elopement partition (per-ElopementId Map diff).

import { describe, expect, it, vi } from "vitest";
import {
  makeCharacter,
  makeElopementSprint,
  makeGameState,
  makeHouse,
  makeMarriage,
} from "../../game/__test-utils__/factories";
import type { ElopementSprintState } from "../../game/entities";
import type { CharacterId, ElopementId, MarriageId, SchemeId } from "../../game/rng";
import { PLAYER_HOUSE_ID } from "../../game/rng";
import { type ElopementEvent, elopementBus, publishElopementTransitions } from "./elopement";

const SPRINT_ID = "elopement:s1:0" as ElopementId;

function makeSprint(overrides: Partial<ElopementSprintState> = {}): ElopementSprintState {
  return makeElopementSprint({
    id: SPRINT_ID,
    schemeId: "s1" as SchemeId,
    elopingCharacterId: "e1" as CharacterId,
    targetCharacterId: "t1" as CharacterId,
    playerTilePosition: 4,
    fatherTilePosition: 2,
    freshHorsesUsedCount: 1,
    ...overrides,
  });
}

function sprintMap(sprint: ElopementSprintState): Map<ElopementId, ElopementSprintState> {
  return new Map([[sprint.id, sprint]]);
}

describe("elopementBus", () => {
  it("publishes ElopementStarted when a new sprint id appears", () => {
    const before = makeGameState({ tick: 5, elopements: new Map() });
    const after = makeGameState({ tick: 5, elopements: sprintMap(makeSprint()) });
    const handler = vi.fn<(e: ElopementEvent) => void>();
    const unsubscribe = elopementBus.subscribe("ElopementStarted", handler);
    publishElopementTransitions(before, after);
    unsubscribe();
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toEqual({
      kind: "ElopementStarted",
      tick: 5,
      schemeId: "s1",
      elopingCharacterId: "e1",
      targetCharacterId: "t1",
    });
  });

  it("publishes ElopementResolved when a sprint flips unresolved → resolved", () => {
    const playerBefore = makeHouse({ id: PLAYER_HOUSE_ID, reputation: 60, scandal: 0 });
    const playerAfter = makeHouse({ id: PLAYER_HOUSE_ID, reputation: 30, scandal: 0 });
    const before = makeGameState({
      tick: 7,
      elopements: sprintMap(makeSprint()),
      houses: new Map([[PLAYER_HOUSE_ID, playerBefore]]),
    });
    const after = makeGameState({
      tick: 7,
      elopements: sprintMap(makeSprint({ resolved: true, outcome: "Won", resolvedAtTick: 7 })),
      houses: new Map([[PLAYER_HOUSE_ID, playerAfter]]),
    });
    const handler = vi.fn<(e: ElopementEvent) => void>();
    const unsubscribe = elopementBus.subscribe("ElopementResolved", handler);
    publishElopementTransitions(before, after);
    unsubscribe();
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]?.[0];
    if (event?.kind !== "ElopementResolved") throw new Error("expected ElopementResolved");
    expect(event.outcome).toBe("Won");
    expect(event.reputationDelta).toBe(-30);
    expect(event.scandalDelta).toBe(0);
  });

  it("ElopementResolved carries the sprint's own Lost outcome + scandal delta", () => {
    const playerBefore = makeHouse({ id: PLAYER_HOUSE_ID, scandal: 10 });
    const playerAfter = makeHouse({ id: PLAYER_HOUSE_ID, scandal: 60 });
    const before = makeGameState({
      tick: 9,
      elopements: sprintMap(makeSprint()),
      houses: new Map([[PLAYER_HOUSE_ID, playerBefore]]),
    });
    const after = makeGameState({
      tick: 9,
      elopements: sprintMap(makeSprint({ resolved: true, outcome: "Lost", resolvedAtTick: 9 })),
      houses: new Map([[PLAYER_HOUSE_ID, playerAfter]]),
    });
    const handler = vi.fn<(e: ElopementEvent) => void>();
    const unsubscribe = elopementBus.subscribe("ElopementResolved", handler);
    publishElopementTransitions(before, after);
    unsubscribe();
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]?.[0];
    if (event?.kind !== "ElopementResolved") throw new Error("expected ElopementResolved");
    expect(event.outcome).toBe("Lost");
    expect(event.scandalDelta).toBe(50);
  });

  it("marriageMinted: true when a viaElopement marriage between the parties landed this tick", () => {
    const playerBefore = makeHouse({ id: PLAYER_HOUSE_ID, reputation: 80 });
    const playerAfter = makeHouse({ id: PLAYER_HOUSE_ID, reputation: 40 });
    const minted = makeMarriage({
      id: "via-elope" as MarriageId,
      spouseAId: "e1" as CharacterId,
      spouseBId: "t1" as CharacterId,
      marriedAtTick: 12,
      viaElopement: true,
    });
    const before = makeGameState({
      tick: 12,
      elopements: sprintMap(makeSprint()),
      houses: new Map([[PLAYER_HOUSE_ID, playerBefore]]),
    });
    const after = makeGameState({
      tick: 12,
      elopements: sprintMap(makeSprint({ resolved: true, outcome: "Won", resolvedAtTick: 12 })),
      houses: new Map([[PLAYER_HOUSE_ID, playerAfter]]),
      marriages: new Map([[minted.id, minted]]),
    });
    const handler = vi.fn<(e: ElopementEvent) => void>();
    const unsubscribe = elopementBus.subscribe("ElopementResolved", handler);
    publishElopementTransitions(before, after);
    unsubscribe();
    const event = handler.mock.calls[0]?.[0];
    if (event?.kind !== "ElopementResolved") throw new Error("expected ElopementResolved");
    expect(event.marriageMinted).toBe(true);
  });

  it("publishes nothing when the elopements maps are unchanged", () => {
    const before = makeGameState({ elopements: new Map() });
    const after = makeGameState({ elopements: new Map() });
    const handler = vi.fn<(e: ElopementEvent) => void>();
    const u1 = elopementBus.subscribe("ElopementStarted", handler);
    const u2 = elopementBus.subscribe("ElopementResolved", handler);
    publishElopementTransitions(before, after);
    u1();
    u2();
    expect(handler).not.toHaveBeenCalled();
  });
});

// Suppress unused-import warning for makeCharacter (kept for future test cases).
void makeCharacter;

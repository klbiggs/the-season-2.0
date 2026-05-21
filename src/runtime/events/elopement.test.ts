// P9 — bus event tests for elopement partition.

import { describe, expect, it, vi } from "vitest";
import {
  makeCharacter,
  makeGameState,
  makeHouse,
  makeMarriage,
} from "../../game/__test-utils__/factories";
import type { ElopementSprintState } from "../../game/entities";
import type { CharacterId, MarriageId, SchemeId } from "../../game/rng";
import { PLAYER_HOUSE_ID } from "../../game/rng";
import { type ElopementEvent, elopementBus, publishElopementTransitions } from "./elopement";

function makeSprint(): ElopementSprintState {
  return {
    schemeId: "s1" as SchemeId,
    elopingCharacterId: "e1" as CharacterId,
    targetCharacterId: "t1" as CharacterId,
    playerTilePosition: 4,
    fatherTilePosition: 2,
    freshHorsesUsedCount: 1,
    startedAtTick: 0,
  };
}

describe("elopementBus", () => {
  it("publishes ElopementStarted on null → non-null transition", () => {
    const before = makeGameState({ tick: 5, elopement: null });
    const after = makeGameState({ tick: 5, elopement: makeSprint() });
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

  it("publishes ElopementResolved on non-null → null transition", () => {
    const playerBefore = makeHouse({ id: PLAYER_HOUSE_ID, reputation: 60, scandal: 0 });
    const playerAfter = makeHouse({ id: PLAYER_HOUSE_ID, reputation: 30, scandal: 0 });
    const before = makeGameState({
      tick: 7,
      elopement: makeSprint(),
      houses: new Map([[PLAYER_HOUSE_ID, playerBefore]]),
    });
    const after = makeGameState({
      tick: 7,
      elopement: null,
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

  it("ElopementResolved discriminates Lost via positive scandalDelta", () => {
    const playerBefore = makeHouse({ id: PLAYER_HOUSE_ID, scandal: 10 });
    const playerAfter = makeHouse({ id: PLAYER_HOUSE_ID, scandal: 60 });
    const before = makeGameState({
      tick: 9,
      elopement: makeSprint(),
      houses: new Map([[PLAYER_HOUSE_ID, playerBefore]]),
    });
    const after = makeGameState({
      tick: 9,
      elopement: null,
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

  it("marriageMinted: true when a viaElopement marriage landed this tick", () => {
    const playerBefore = makeHouse({ id: PLAYER_HOUSE_ID, reputation: 80 });
    const playerAfter = makeHouse({ id: PLAYER_HOUSE_ID, reputation: 40 });
    const minted = makeMarriage({
      id: "via-elope" as MarriageId,
      marriedAtTick: 12,
      viaElopement: true,
    });
    const before = makeGameState({
      tick: 12,
      elopement: makeSprint(),
      houses: new Map([[PLAYER_HOUSE_ID, playerBefore]]),
    });
    const after = makeGameState({
      tick: 12,
      elopement: null,
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

  it("publishes nothing when before and after both have null elopement", () => {
    const before = makeGameState({ elopement: null });
    const after = makeGameState({ elopement: null });
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

// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeCharacter, makeGameState, makeHouse } from "../../game/__test-utils__/factories";
import type { Duel } from "../../game/entities";
import type { CharacterId, DuelId, HouseId } from "../../game/rng";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { createStore } from "../../game/store";
import { duelBus } from "../../runtime/events/duels";
import { globalEventBus } from "../../runtime/events/globalEvent";
import { MapView } from "./MapView";

afterEach(cleanup);

const RIVAL_HOUSE = "rival-ashford" as HouseId;
const RIVAL_CHAR = "rival-ashford-head" as CharacterId;
const PLAYER_KIN = "player-kin" as CharacterId;

describe("MapView — P25 R12 era surfacing", () => {
  it("renders the era chip labelled per the current era", () => {
    const store = createStore({ seed: "mv-era" });
    store.getState().replaceState(
      makeGameState({
        era: "Earlier",
        houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ currentLocation: "Capital" })]]),
      }),
    );
    render(<MapView store={store} />);
    expect(screen.getByTestId("era-chip").textContent).toBe("Wartime Era");
  });

  it("shows the Industrial Era label after the era has flipped", () => {
    const store = createStore({ seed: "mv-era2" });
    store.getState().replaceState(
      makeGameState({
        era: "Later",
        houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ currentLocation: "Capital" })]]),
      }),
    );
    render(<MapView store={store} />);
    expect(screen.getByTestId("era-chip").textContent).toBe("Industrial Era");
  });

  it("surfaces the flip banner when EraTransitioned publishes", () => {
    const store = createStore({ seed: "mv-era3" });
    store.getState().replaceState(
      makeGameState({
        era: "Later",
        houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ currentLocation: "Capital" })]]),
      }),
    );
    render(<MapView store={store} />);
    expect(screen.queryByTestId("era-transition-banner")).toBeNull();
    act(() => {
      globalEventBus.publish({ kind: "EraTransitioned", tick: 200, from: "Earlier", to: "Later" });
    });
    expect(screen.getByTestId("era-transition-banner")).not.toBeNull();
  });
});

describe("MapView — P25 R3 rival-duel notice", () => {
  function duelReadyStore(seed: string) {
    const store = createStore({ seed });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ currentLocation: "Capital" })]]),
        characters: new Map([
          [
            RIVAL_CHAR,
            makeCharacter({ id: RIVAL_CHAR, houseId: RIVAL_HOUSE, name: "Lord Ashford" }),
          ],
          [PLAYER_KIN, makeCharacter({ id: PLAYER_KIN, name: "Miss Player" })],
        ]),
      }),
    );
    return store;
  }

  it("surfaces the notice when a rival challenger initiates a duel", () => {
    const store = duelReadyStore("mv-duel1");
    render(<MapView store={store} />);
    expect(screen.queryByTestId("duel-notice")).toBeNull();
    act(() => {
      duelBus.publish({
        kind: "DuelInitiated",
        tick: 10,
        duelId: "duel-1" as DuelId,
        challengerCharacterId: RIVAL_CHAR,
        defenderCharacterId: PLAYER_KIN,
      });
    });
    const notice = screen.getByTestId("duel-notice");
    expect(notice.textContent).toContain("Lord Ashford");
    expect(notice.textContent).toContain("Miss Player");
  });

  it("ignores a duel initiated by a NON-rival challenger (filter guard)", () => {
    // Same challenger id but re-homed into the player house → not a rival.
    const store = createStore({ seed: "mv-duel2" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ currentLocation: "Capital" })]]),
        characters: new Map([
          [RIVAL_CHAR, makeCharacter({ id: RIVAL_CHAR, houseId: PLAYER_HOUSE_ID, name: "Cousin" })],
          [PLAYER_KIN, makeCharacter({ id: PLAYER_KIN, name: "Miss Player" })],
        ]),
      }),
    );
    render(<MapView store={store} />);
    act(() => {
      duelBus.publish({
        kind: "DuelInitiated",
        tick: 10,
        duelId: "duel-2" as DuelId,
        challengerCharacterId: RIVAL_CHAR,
        defenderCharacterId: PLAYER_KIN,
      });
    });
    expect(screen.queryByTestId("duel-notice")).toBeNull();
  });

  it("correlates DuelResolved via state.duels and reports the casualty", () => {
    const store = duelReadyStore("mv-duel3");
    const duel: Duel = {
      id: "duel-3" as DuelId,
      challengerCharacterId: RIVAL_CHAR,
      defenderCharacterId: PLAYER_KIN,
      grievanceId: "g" as never,
      initiatedAtTick: 9,
      status: "Resolved",
      resolvedAtTick: 10,
      outcome: "ChallengerVictory",
      loserCasualty: "Killed",
      exchangesElapsed: 4,
    };
    store.getState().replaceState(
      makeGameState({
        houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ currentLocation: "Capital" })]]),
        characters: store.getState().characters,
        duels: new Map([[duel.id, duel]]),
      }),
    );
    render(<MapView store={store} />);
    act(() => {
      duelBus.publish({
        kind: "DuelResolved",
        tick: 10,
        duelId: duel.id,
        outcome: "ChallengerVictory",
        loserCasualty: "Killed",
        exchangesElapsed: 4,
      });
    });
    const notice = screen.getByTestId("duel-notice");
    expect(notice.textContent).toContain("was killed");
    expect(notice.textContent).toContain("Miss Player");
  });
});

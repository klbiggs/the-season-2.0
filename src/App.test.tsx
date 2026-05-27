// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// LedgerView (via FamilyTreeTab → SocialWebView) and the ballroom pull the
// canvas lib at module load; stub it for the shell-level render.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

import { App } from "./App";
import {
  makeCharacter,
  makeElopementSprint,
  makeGameState,
  makeHouse,
} from "./game/__test-utils__/factories";
import {
  type CharacterId,
  type HouseId,
  INDEPENDENT_HOUSE_ID,
  PLAYER_HOUSE_ID,
  type SchemeId,
} from "./game/rng.seeds";
import { createStore } from "./game/store";
import { elopementBus } from "./runtime/events/elopement";
import { schemeBus } from "./runtime/events/scheme";

afterEach(cleanup);

const HEAD = "head" as CharacterId;
const TARGET = "target-npc" as CharacterId;

describe("App shell (P14)", () => {
  it("renders the persistent exile banner from the shell when exiled (matrix #36)", () => {
    const store = createStore({ seed: "app" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [
            PLAYER_HOUSE_ID,
            makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD, exiled: true }),
          ],
        ]),
        characters: new Map([[HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })]]),
      }),
    );
    render(<App store={store} seed="app" />);
    expect(screen.getByTestId("exile-banner")).toBeTruthy();
  });

  it("Elopement overlay takes routing precedence over every other view (matrix #3)", () => {
    const store = createStore({ seed: "app" });
    const sprint = makeElopementSprint({
      schemeId: "scheme-elope" as SchemeId,
      elopingCharacterId: HEAD,
      targetCharacterId: TARGET,
      playerTilePosition: 1,
      fatherTilePosition: 0,
    });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
        ]),
        characters: new Map([
          [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
          [TARGET, makeCharacter({ id: TARGET, name: "Target" })],
        ]),
        elopements: new Map([[sprint.id, sprint]]),
      }),
    );
    render(<App store={store} seed="app" />);
    expect(screen.getByTestId("elopement-overlay")).toBeTruthy();
    expect(screen.queryByTestId("ledger-view")).toBeNull();
    expect(screen.queryByTestId("map-view")).toBeNull();
  });

  it("surfaces the elopement Won/Lost banner on ElopementResolved (P20)", () => {
    const store = createStore({ seed: "app" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
        ]),
        characters: new Map([[HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })]]),
      }),
    );
    render(<App store={store} seed="app" />);
    expect(screen.queryByTestId("elopement-outcome-banner")).toBeNull();

    // The banner lives on App's persistent chrome (not the overlay) so it
    // survives the overlay unmount at elopement → null.
    act(() => {
      elopementBus.publish({
        kind: "ElopementResolved",
        tick: 5,
        schemeId: "scheme-elope" as SchemeId,
        outcome: "Won",
        marriageMinted: true,
        reputationDelta: -25,
        scandalDelta: 0,
      });
    });

    const banner = screen.getByTestId("elopement-outcome-banner");
    expect(banner.getAttribute("data-outcome")).toBe("Won");
    expect(banner.textContent).toContain("successful");
  });
});

describe("App scheme-outcome notification (P21)", () => {
  const RIVAL_HOUSE = "house-rival" as HouseId;
  const OTHER = "other-npc" as CharacterId;

  function mountApp() {
    const store = createStore({ seed: "app" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
        ]),
        characters: new Map([
          [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse", name: "Lord Player" })],
          [
            TARGET,
            makeCharacter({ id: TARGET, houseId: INDEPENDENT_HOUSE_ID, name: "Miss Ashford" }),
          ],
          [OTHER, makeCharacter({ id: OTHER, houseId: RIVAL_HOUSE, name: "Rival Heir" })],
        ]),
      }),
    );
    render(<App store={store} seed="app" />);
    return store;
  }

  it("shows a banner for a player-launched scheme completing", () => {
    mountApp();
    expect(screen.queryByTestId("scheme-outcome-banner")).toBeNull();
    act(() => {
      schemeBus.publish({
        kind: "SchemeCompleted",
        tick: 3,
        schemeId: "s-1" as SchemeId,
        schemeKind: "Sabotage",
        ownerHouseId: PLAYER_HOUSE_ID,
        targetCharacterId: TARGET,
      });
    });
    const banner = screen.getByTestId("scheme-outcome-banner");
    expect(banner.textContent).toContain("Your Sabotage against Miss Ashford succeeded");
  });

  it("shows a banner for a rival scheme completing against a player-house target", () => {
    mountApp();
    act(() => {
      schemeBus.publish({
        kind: "SchemeCompleted",
        tick: 4,
        schemeId: "s-2" as SchemeId,
        schemeKind: "Sabotage",
        ownerHouseId: RIVAL_HOUSE,
        targetCharacterId: HEAD,
      });
    });
    expect(screen.getByTestId("scheme-outcome-banner").textContent).toContain(
      "A rival's Sabotage against Lord Player succeeded",
    );
  });

  it("does NOT show a banner for a rival scheme irrelevant to the player", () => {
    mountApp();
    act(() => {
      schemeBus.publish({
        kind: "SchemeCompleted",
        tick: 5,
        schemeId: "s-3" as SchemeId,
        schemeKind: "Sabotage",
        ownerHouseId: RIVAL_HOUSE,
        targetCharacterId: OTHER,
      });
    });
    expect(screen.queryByTestId("scheme-outcome-banner")).toBeNull();
  });

  it("dismisses the banner", () => {
    mountApp();
    act(() => {
      schemeBus.publish({
        kind: "SeductionDiscovered",
        tick: 6,
        schemeId: "s-4" as SchemeId,
        ownerHouseId: PLAYER_HOUSE_ID,
        targetCharacterId: TARGET,
      });
    });
    expect(screen.getByTestId("scheme-outcome-banner")).toBeTruthy();
    act(() => {
      screen.getByTestId("scheme-outcome-dismiss").click();
    });
    expect(screen.queryByTestId("scheme-outcome-banner")).toBeNull();
  });
});

// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// LedgerView (via FamilyTreeTab → SocialWebView) and the ballroom pull the
// canvas lib at module load; stub it for the shell-level render.
vi.mock("react-force-graph-2d", () => ({ default: () => null }));

import { App } from "./App";
import { makeCharacter, makeGameState, makeHouse } from "./game/__test-utils__/factories";
import type { ElopementSprintState } from "./game/entities";
import { type CharacterId, PLAYER_HOUSE_ID, type SchemeId } from "./game/rng.seeds";
import { createStore } from "./game/store";
import { elopementBus } from "./runtime/events/elopement";

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
    const elopement: ElopementSprintState = {
      schemeId: "scheme-elope" as SchemeId,
      elopingCharacterId: HEAD,
      targetCharacterId: TARGET,
      playerTilePosition: 1,
      fatherTilePosition: 0,
      freshHorsesUsedCount: 0,
      startedAtTick: 0,
    };
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
        ]),
        characters: new Map([
          [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
          [TARGET, makeCharacter({ id: TARGET, name: "Target" })],
        ]),
        elopement,
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

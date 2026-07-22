// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeGameState, makeHouse } from "../../game/__test-utils__/factories";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { createStore } from "../../game/store";
import { globalEventBus } from "../../runtime/events/globalEvent";
import { MapView } from "./MapView";

afterEach(cleanup);

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

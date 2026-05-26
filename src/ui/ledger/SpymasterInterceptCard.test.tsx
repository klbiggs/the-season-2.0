// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeCharacter, makeGameState, makeHouse } from "../../game/__test-utils__/factories";
import { type CharacterId, PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { createStore } from "../../game/store";
import { SpymasterInterceptCard } from "./SpymasterInterceptCard";

afterEach(cleanup);

const HEAD = "head" as CharacterId;
const SPY = "spy" as CharacterId;

describe("SpymasterInterceptCard (P21)", () => {
  it("enables the button for a living Spymaster and drops the stale P7 tooltip clause", () => {
    const store = createStore({ seed: "spy" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
        ]),
        characters: new Map([
          [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
          [SPY, makeCharacter({ id: SPY, archetype: "Spymaster", age: 30 })],
        ]),
      }),
    );
    render(<SpymasterInterceptCard store={store} />);
    const btn = screen.getByRole("button", { name: /Intercept Inbound Mail/ });
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.getAttribute("title") ?? "").not.toContain("after P7");
  });

  it("surfaces a rejection toast when no interceptable courier exists", () => {
    const store = createStore({ seed: "spy" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [
            PLAYER_HOUSE_ID,
            makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD, wealth: 100 }),
          ],
        ]),
        characters: new Map([
          [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
          [SPY, makeCharacter({ id: SPY, archetype: "Spymaster", age: 30 })],
        ]),
        // no couriers → intercept rejects
      }),
    );
    render(<SpymasterInterceptCard store={store} />);
    fireEvent.click(screen.getByRole("button", { name: /Intercept Inbound Mail/ }));
    expect(screen.getByTestId("action-rejection-toast").textContent).toContain("Cannot intercept");
  });
});

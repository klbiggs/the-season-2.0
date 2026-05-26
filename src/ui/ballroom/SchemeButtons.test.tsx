// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeCharacter, makeGameState, makeHouse } from "../../game/__test-utils__/factories";
import { type CharacterId, INDEPENDENT_HOUSE_ID, PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { createStore } from "../../game/store";
import { SchemeButtons } from "./SchemeButtons";

afterEach(cleanup);

const HEAD = "head" as CharacterId;
const TARGET = "target-npc" as CharacterId;

describe("SchemeButtons rejection toast (P21 LOW)", () => {
  it("surfaces a toast when startScheme rejects (enabled-but-rejecting race)", () => {
    const store = createStore({ seed: "sb" });
    // Exiled player house: the Sabotage button is NOT disabled by the exile
    // flag (the disabled-state checks target/wealth/prereqs/era only), so it is
    // clickable and startScheme rejects with PlayerExiled — exactly the race
    // the disabled-state can't gate.
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [
            PLAYER_HOUSE_ID,
            makeHouse({
              id: PLAYER_HOUSE_ID,
              headOfHouseCharacterId: HEAD,
              wealth: 100,
              exiled: true,
            }),
          ],
        ]),
        characters: new Map([
          [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
          [TARGET, makeCharacter({ id: TARGET, houseId: INDEPENDENT_HOUSE_ID })],
        ]),
      }),
    );
    render(<SchemeButtons store={store} selectedTargetId={TARGET} />);

    expect(screen.queryByTestId("action-rejection-toast")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sabotage" }));
    const toast = screen.getByTestId("action-rejection-toast");
    expect(toast.textContent).toContain("Cannot start Sabotage");
    expect(toast.textContent).toContain("PlayerExiled");
  });
});

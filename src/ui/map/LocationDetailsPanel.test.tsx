// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeCharacter, makeGameState, makeHouse } from "../../game/__test-utils__/factories";
import { type CharacterId, PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { createStore } from "../../game/store";
import { LocationDetailsPanel } from "./LocationDetailsPanel";

afterEach(cleanup);

const HEAD = "head" as CharacterId;

describe("LocationDetailsPanel enter-ballroom rejection (P21 LOW)", () => {
  it("surfaces a toast when enterBallroom rejects (exiled at Capital)", () => {
    const store = createStore({ seed: "ldp" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [
            PLAYER_HOUSE_ID,
            makeHouse({
              id: PLAYER_HOUSE_ID,
              headOfHouseCharacterId: HEAD,
              currentLocation: "Capital",
              exiled: true,
            }),
          ],
        ]),
        characters: new Map([[HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })]]),
      }),
    );
    render(<LocationDetailsPanel store={store} location="Capital" onEnterBallroom={() => {}} />);

    expect(screen.queryByTestId("action-rejection-toast")).toBeNull();
    fireEvent.click(screen.getByTestId("location-details-enter-ballroom"));
    expect(screen.getByTestId("action-rejection-toast").textContent).toContain(
      "Cannot enter the ballroom",
    );
  });
});

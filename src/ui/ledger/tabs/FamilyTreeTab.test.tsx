// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

import { makeCharacter, makeGameState, makeHouse } from "../../../game/__test-utils__/factories";
import type { SiblingRivalState } from "../../../game/entities";
import {
  type CharacterId,
  PLAYER_HOUSE_ID,
  type SiblingRivalActorId,
  type TraitId,
} from "../../../game/rng.seeds";
import { createStore } from "../../../game/store";
import { FamilyTreeTab } from "./FamilyTreeTab";

afterEach(cleanup);

const HEAD = "head" as CharacterId;
const SIBLING = "sibling" as CharacterId;
const CHILD = "child" as CharacterId;
const TUTOR = "tutor" as CharacterId;

describe("FamilyTreeTab", () => {
  it("renders one row per player-house character (matrix #7)", () => {
    const store = createStore({ seed: "f" });
    const state = makeGameState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
        [SIBLING, makeCharacter({ id: SIBLING, role: "Dependent" })],
      ]),
    });
    store.getState().replaceState(state);
    render(<FamilyTreeTab store={store} />);
    expect(screen.getAllByTestId(/^family-row-/)).toHaveLength(2);
  });

  it("renders unreconciled sibling-rivals with a Reconcile button (matrix #8)", () => {
    const store = createStore({ seed: "f" });
    const rival: SiblingRivalState = {
      id: "sr-1" as SiblingRivalActorId,
      characterId: SIBLING,
      hostility: 60,
      lastActionTick: 0,
      reconciled: false,
      promotedAtTick: 0,
    };
    const state = makeGameState({
      houses: new Map([
        [
          PLAYER_HOUSE_ID,
          makeHouse({
            id: PLAYER_HOUSE_ID,
            headOfHouseCharacterId: HEAD,
            wealth: 100,
            reputation: 50,
            siblingRivals: [rival],
          }),
        ],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
        [SIBLING, makeCharacter({ id: SIBLING, role: "Dependent", name: "Slighted Sibling" })],
      ]),
    });
    store.getState().replaceState(state);
    render(<FamilyTreeTab store={store} />);
    expect(screen.getByTestId(`sibling-rival-row-${SIBLING}`)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconcile" })).toBeTruthy();
  });

  it("surfaces tutor assign + bonus-trait affordances (matrix #9)", () => {
    const store = createStore({ seed: "f" });
    const state = makeGameState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
        [
          CHILD,
          makeCharacter({ id: CHILD, role: "Dependent", age: 10, assignedTutorCharacterId: null }),
        ],
        [TUTOR, makeCharacter({ id: TUTOR, role: "Spinster", age: 40, archetype: "Tutor" })],
      ]),
      pendingTutorTraitChoices: new Map([
        [
          CHILD,
          {
            childId: CHILD,
            tutorId: TUTOR,
            archetype: "Tutor" as const,
            acceptableTraitIds: ["Cunning" as TraitId, "Observant" as TraitId] as [
              TraitId,
              TraitId,
            ],
            createdAtTick: 0,
          },
        ],
      ]),
    });
    store.getState().replaceState(state);
    render(<FamilyTreeTab store={store} />);
    expect(screen.getByTestId(`assign-tutor-select-${CHILD}`)).toBeTruthy();
    expect(screen.getByTestId(`tutor-trait-choice-${CHILD}`)).toBeTruthy();
  });

  it("toggles into the Social Web sub-view (matrix #10)", () => {
    const store = createStore({ seed: "f" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
        ]),
        characters: new Map([[HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })]]),
      }),
    );
    render(<FamilyTreeTab store={store} />);
    expect(screen.queryByTestId("social-web-view")).toBeNull();
    fireEvent.click(screen.getByTestId("social-web-toggle"));
    expect(screen.getByTestId("social-web-view")).toBeTruthy();
  });
});

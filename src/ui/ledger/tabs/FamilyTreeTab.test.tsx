// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

import {
  makeCharacter,
  makeGameState,
  makeHouse,
  makeMarriage,
} from "../../../game/__test-utils__/factories";
import type { SiblingRivalState } from "../../../game/entities";
import {
  type CharacterId,
  type FlavorContentId,
  INDEPENDENT_HOUSE_ID,
  type MarriageId,
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

  it("renders player-involved marriages with elopement/dissolved badges (P21)", () => {
    const store = createStore({ seed: "f" });
    const SPOUSE = "spouse-npc" as CharacterId;
    const marriage = makeMarriage({
      id: "m-0001" as MarriageId,
      spouseAId: HEAD,
      spouseBId: SPOUSE,
      marriedAtTick: 3,
      viaElopement: true,
    });
    const state = makeGameState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse", name: "Lord Player" })],
        [SPOUSE, makeCharacter({ id: SPOUSE, houseId: INDEPENDENT_HOUSE_ID, name: "Lady NPC" })],
      ]),
      marriages: new Map([[marriage.id, marriage]]),
    });
    store.getState().replaceState(state);
    render(<FamilyTreeTab store={store} />);
    const row = screen.getByTestId(`marriage-row-${marriage.id}`);
    expect(row.textContent).toContain("Lord Player");
    expect(row.textContent).toContain("Lady NPC");
    expect(row.textContent).toContain("eloped");
  });

  it("surfaces happiness/composure + a tempted pill on the character row (P21)", () => {
    const store = createStore({ seed: "f" });
    const state = makeGameState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
      ]),
      characters: new Map([
        [
          HEAD,
          makeCharacter({
            id: HEAD,
            role: "HeadOfHouse",
            happiness: 42,
            composure: 70,
            maxComposure: 100,
            temptationHookUnlocked: true,
            dullSpouseExposureStartTick: 12,
          }),
        ],
      ]),
    });
    store.getState().replaceState(state);
    render(<FamilyTreeTab store={store} />);
    const row = screen.getByTestId(`family-row-${HEAD}`);
    expect(row.textContent).toContain("hap 42");
    expect(row.textContent).toContain("comp 70/100");
    expect(screen.getByTestId(`tempted-${HEAD}`)).toBeTruthy();
    expect(row.textContent).toContain("dull-spouse since t12");
  });

  it("renders proposal + tutor-assignment logs (P21 LOW)", () => {
    const store = createStore({ seed: "f" });
    const TARGET = "target-npc" as CharacterId;
    const state = makeGameState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
        [TARGET, makeCharacter({ id: TARGET, houseId: INDEPENDENT_HOUSE_ID, name: "Miss Target" })],
        [CHILD, makeCharacter({ id: CHILD, role: "Dependent", age: 10, name: "Young One" })],
        [TUTOR, makeCharacter({ id: TUTOR, archetype: "Tutor", age: 40, name: "Mr Tutor" })],
      ]),
      // keyed by target; proposer (byCharacterId) is the player head
      proposalsLog: new Map([
        [TARGET, { outcome: "Accepted" as const, tick: 7, byCharacterId: HEAD }],
      ]),
      // keyed by child
      tutorAssignmentsLog: new Map([
        [CHILD, { tutorCharacterId: TUTOR, assignedAtTick: 4, reassignmentCount: 0 }],
      ]),
    });
    store.getState().replaceState(state);
    render(<FamilyTreeTab store={store} />);
    expect(screen.getByTestId(`proposal-log-row-${TARGET}`).textContent).toContain("Miss Target");
    expect(screen.getByTestId(`proposal-log-row-${TARGET}`).textContent).toContain("Accepted");
    expect(screen.getByTestId(`tutor-log-row-${CHILD}`).textContent).toContain("Young One");
    expect(screen.getByTestId(`tutor-log-row-${CHILD}`).textContent).toContain("Mr Tutor");
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
    fireEvent.click(screen.getByTestId("family-mode-web"));
    expect(screen.getByTestId("social-web-view")).toBeTruthy();
  });

  it("toggles into the Ton (society) sub-view showing non-player houses (P22)", () => {
    const NPC = "indy-npc" as CharacterId;
    const store = createStore({ seed: "f" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
          [INDEPENDENT_HOUSE_ID, makeHouse({ id: INDEPENDENT_HOUSE_ID })],
        ]),
        characters: new Map([
          [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
          [NPC, makeCharacter({ id: NPC, houseId: INDEPENDENT_HOUSE_ID })],
        ]),
      }),
    );
    render(<FamilyTreeTab store={store} />);
    expect(screen.queryByTestId("society-view")).toBeNull();
    fireEvent.click(screen.getByTestId("family-mode-society"));
    expect(screen.getByTestId("society-view")).toBeTruthy();
    // The Independent NPC surfaces in the Ton roster (not the player family list).
    expect(screen.getByTestId(`society-row-${NPC}`)).toBeTruthy();
  });

  it("opening a family member's bio expander calls revealNpcBio (P22 gate lift)", () => {
    const store = createStore({ seed: "f" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
        ]),
        characters: new Map([[HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })]]),
      }),
    );
    const spy = vi.spyOn(store.getState(), "revealNpcBio");
    render(<FamilyTreeTab store={store} />);
    const details = screen.getByTestId(`family-bio-${HEAD}`) as HTMLDetailsElement;
    // jsdom doesn't auto-fire onToggle on summary click; set open + dispatch it.
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(spy).toHaveBeenCalledWith(HEAD);
  });

  it("editing a bio persists via authorFlavorText, and Regenerate calls regenerateNpcBio (P26 G8)", () => {
    const store = createStore({ seed: "f" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
        ]),
        characters: new Map([[HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })]]),
      }),
    );
    const regenSpy = vi.spyOn(store.getState(), "regenerateNpcBio");
    render(<FamilyTreeTab store={store} />);

    fireEvent.click(screen.getByTestId(`family-bio-${HEAD}-edit`));
    const textarea = screen.getByTestId(`family-bio-${HEAD}-textarea`);
    fireEvent.change(textarea, { target: { value: "A most singular person." } });
    fireEvent.click(screen.getByTestId(`family-bio-${HEAD}-save`));
    expect(store.getState().flavorText.get(`bio:${HEAD}` as FlavorContentId)?.text).toBe(
      "A most singular person.",
    );
    // The editor returns to read mode showing the authored text.
    expect(screen.getByText("A most singular person.")).toBeTruthy();

    fireEvent.click(screen.getByTestId(`family-bio-${HEAD}-regenerate`));
    expect(regenSpy).toHaveBeenCalledWith(HEAD);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse } from "../../../game/__test-utils__/factories";
import type { ArtifactInstance, GameState, ThiefAttempt } from "../../../game/entities";
import {
  type ArtifactDefinitionId,
  type ArtifactInstanceId,
  type CharacterId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type ThiefAttemptId,
} from "../../../game/rng.seeds";
import { createStore } from "../../../game/store";
import { ArtifactsTab } from "./ArtifactsTab";

afterEach(cleanup);

const HEAD = "head" as CharacterId;
const SAPPHIRES = "artifact-sapphires-0" as ArtifactInstanceId;

function stateWithUnequippedSapphires(overrides: Partial<GameState> = {}): GameState {
  const head = makeCharacter({
    id: HEAD,
    houseId: PLAYER_HOUSE_ID,
    name: "Head",
    role: "HeadOfHouse",
    equippedArtifactIds: [],
  });
  const instance: ArtifactInstance = {
    id: SAPPHIRES,
    definitionId: "sapphires" as ArtifactDefinitionId,
    ownerHouseId: PLAYER_HOUSE_ID,
    ownerCharacterId: HEAD,
    lastRefreshTick: 0,
    forgedFlag: false,
  };
  return makeGameState({
    houses: new Map([
      [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
    ]),
    characters: new Map([[HEAD, head]]),
    artifactInstances: new Map([[SAPPHIRES, instance]]),
    ...overrides,
  });
}

describe("ArtifactsTab (matrix #22-29)", () => {
  it("renders the inventory + wardrobe-refresh affordance", () => {
    const store = createStore({ seed: "art" });
    store.getState().replaceState(stateWithUnequippedSapphires());
    render(<ArtifactsTab store={store} />);
    expect(screen.getByTestId("artifact-inventory")).toBeTruthy();
    expect(screen.getByTestId(`artifact-row-${SAPPHIRES}`)).toBeTruthy();
    expect(screen.getByTestId("refresh-wardrobe-btn")).toBeTruthy();
  });

  it("equips an artifact through the live store action (matrix #23)", () => {
    const store = createStore({ seed: "art" });
    store.getState().replaceState(stateWithUnequippedSapphires());
    render(<ArtifactsTab store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Equip" }));
    expect(store.getState().characters.get(HEAD)?.equippedArtifactIds).toContain(SAPPHIRES);
  });

  it("surfaces an in-flight thief attempt as a banner (matrix #28)", () => {
    const store = createStore({ seed: "art" });
    const attempt: ThiefAttempt = {
      id: "thief-1" as ThiefAttemptId,
      targetedArtifactInstanceId: SAPPHIRES,
      ownerCharacterId: HEAD,
      noticedAtTick: 3,
      thwarted: null,
      resolvedAtTick: null,
    };
    store.getState().replaceState(
      stateWithUnequippedSapphires({
        thiefAttempts: new Map([[attempt.id, attempt]]),
      }),
    );
    render(<ArtifactsTab store={store} />);
    expect(screen.getByTestId("thief-attempt-banners")).toBeTruthy();
    expect(screen.getByTestId("thief-attempt-thief-1")).toBeTruthy();
  });

  it("does NOT surface a thwart banner for a non-player theft (P24b E4)", () => {
    const store = createStore({ seed: "art" });
    const rivalInst: ArtifactInstance = {
      id: "artifact-rival-0" as ArtifactInstanceId,
      definitionId: "tiara" as ArtifactDefinitionId,
      ownerHouseId: "rival-ashford" as HouseId,
      ownerCharacterId: "rival-ashford-head" as CharacterId,
      lastRefreshTick: 0,
      forgedFlag: false,
    };
    const attempt: ThiefAttempt = {
      id: "thief-rival-1" as ThiefAttemptId,
      targetedArtifactInstanceId: rivalInst.id,
      ownerCharacterId: rivalInst.ownerCharacterId,
      noticedAtTick: 3,
      thwarted: null,
      resolvedAtTick: null,
    };
    const base = stateWithUnequippedSapphires();
    store.getState().replaceState({
      ...base,
      artifactInstances: new Map([...base.artifactInstances, [rivalInst.id, rivalInst]]),
      thiefAttempts: new Map([[attempt.id, attempt]]),
    });
    render(<ArtifactsTab store={store} />);
    expect(screen.queryByTestId("thief-attempt-banners")).toBeNull();
  });

  it("gates the forgery ledger on a living Bohemian Rake (matrix #26)", () => {
    const store = createStore({ seed: "art" });
    store.getState().replaceState(stateWithUnequippedSapphires());
    render(<ArtifactsTab store={store} />);
    // No Rake in the fixture → commission affordance is hidden.
    expect(screen.queryByTestId("commission-forgery-btn")).toBeNull();
    expect(
      screen.getByText("Forgery requires a living Bohemian Rake in the household."),
    ).toBeTruthy();
  });

  it("renders the wardrobe-decay badge only on equipped instances (matrix #24)", () => {
    const store = createStore({ seed: "art" });
    const head = makeCharacter({
      id: HEAD,
      role: "HeadOfHouse",
      equippedArtifactIds: [SAPPHIRES],
    });
    const snuffbox = "artifact-snuffbox-0" as ArtifactInstanceId;
    const equipped: ArtifactInstance = {
      id: SAPPHIRES,
      definitionId: "sapphires" as ArtifactDefinitionId,
      ownerHouseId: PLAYER_HOUSE_ID,
      ownerCharacterId: HEAD,
      lastRefreshTick: 0,
      forgedFlag: false,
    };
    const unequippedOverdue: ArtifactInstance = {
      id: snuffbox,
      definitionId: "snuffbox" as ArtifactDefinitionId,
      ownerHouseId: PLAYER_HOUSE_ID,
      ownerCharacterId: HEAD,
      lastRefreshTick: 0,
      forgedFlag: false,
    };
    store.getState().replaceState(
      makeGameState({
        tick: 100, // well past WARDROBE_REFRESH_INTERVAL_TICKS (40)
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
        ]),
        characters: new Map([[HEAD, head]]),
        artifactInstances: new Map([
          [SAPPHIRES, equipped],
          [snuffbox, unequippedOverdue],
        ]),
      }),
    );
    render(<ArtifactsTab store={store} />);
    expect(screen.getByTestId(`wardrobe-badge-${SAPPHIRES}`).textContent).toContain(
      "Out of season",
    );
    // Unequipped overdue instance shows NO decay badge.
    expect(screen.queryByTestId(`wardrobe-badge-${snuffbox}`)).toBeNull();
  });

  it("refreshes the wardrobe at the Capital and clears the out-of-season badge (matrix #25)", () => {
    const store = createStore({ seed: "art" });
    const head = makeCharacter({
      id: HEAD,
      role: "HeadOfHouse",
      equippedArtifactIds: [SAPPHIRES],
    });
    const equipped: ArtifactInstance = {
      id: SAPPHIRES,
      definitionId: "sapphires" as ArtifactDefinitionId,
      ownerHouseId: PLAYER_HOUSE_ID,
      ownerCharacterId: HEAD,
      lastRefreshTick: 0,
      forgedFlag: false,
    };
    store.getState().replaceState(
      makeGameState({
        tick: 100,
        // refreshWardrobe advances the tick → applyGlobalEventPhase needs the
        // player RNG registered; preserve the seeded rng from createStore.
        rng: store.getState().rng,
        houses: new Map([
          [
            PLAYER_HOUSE_ID,
            makeHouse({
              id: PLAYER_HOUSE_ID,
              headOfHouseCharacterId: HEAD,
              currentLocation: "Capital",
            }),
          ],
        ]),
        characters: new Map([[HEAD, head]]),
        artifactInstances: new Map([[SAPPHIRES, equipped]]),
      }),
    );
    render(<ArtifactsTab store={store} />);
    expect(screen.getByTestId(`wardrobe-badge-${SAPPHIRES}`).textContent).toContain(
      "Out of season",
    );
    fireEvent.click(screen.getByTestId("refresh-wardrobe-btn"));
    expect(screen.getByTestId(`wardrobe-badge-${SAPPHIRES}`).textContent).toContain("In season");
  });

  it("commissions a forgery through the live store action (matrix #27)", () => {
    const store = createStore({ seed: "art" });
    const rake = makeCharacter({
      id: HEAD,
      role: "HeadOfHouse",
      archetype: "BohemianRake",
    });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [
            PLAYER_HOUSE_ID,
            makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD, wealth: 100 }),
          ],
        ]),
        characters: new Map([[HEAD, rake]]),
      }),
    );
    render(<ArtifactsTab store={store} />);
    fireEvent.change(screen.getByTestId("forge-choice"), { target: { value: "snuffbox" } });
    fireEvent.click(screen.getByTestId("commission-forgery-btn"));
    expect(store.getState().forgeries.size).toBe(1);
  });

  it("enables Thwart only when a living Spymaster is present (matrix #29)", () => {
    const store = createStore({ seed: "art" });
    const spymaster = makeCharacter({
      id: HEAD,
      role: "HeadOfHouse",
      archetype: "Spymaster",
    });
    const attempt: ThiefAttempt = {
      id: "thief-1" as ThiefAttemptId,
      targetedArtifactInstanceId: SAPPHIRES,
      ownerCharacterId: HEAD,
      noticedAtTick: 3,
      thwarted: null,
      resolvedAtTick: null,
    };
    store.getState().replaceState(
      stateWithUnequippedSapphires({
        characters: new Map([[HEAD, spymaster]]),
        thiefAttempts: new Map([[attempt.id, attempt]]),
      }),
    );
    render(<ArtifactsTab store={store} />);
    const thwartBtn = screen.getByRole("button", { name: /Thwart Attempt/ });
    expect((thwartBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

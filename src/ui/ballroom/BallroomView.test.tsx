// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse } from "../../game/__test-utils__/factories";
import { type CharacterId, INDEPENDENT_HOUSE_ID, PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { createStore } from "../../game/store";
import { conversationBus } from "../../runtime/events/conversation";
import { BallroomView } from "./BallroomView";

afterEach(cleanup);

const HEAD = "player-head" as CharacterId;
const NPC = "npc-1" as CharacterId;

// Minimal ballroom-ready state: a player head (for composure) + one alive
// Independent-house NPC (the default-selected conversation target).
function ballroomState(npcOverrides = {}) {
  return makeGameState({
    houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ headOfHouseCharacterId: HEAD })]]),
    characters: new Map([
      [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
      [
        NPC,
        makeCharacter({
          id: NPC,
          houseId: INDEPENDENT_HOUSE_ID,
          name: "Miss Independent",
          role: "Spinster",
          ...npcOverrides,
        }),
      ],
    ]),
  });
}

describe("BallroomView (P20 faux-pas surfacing)", () => {
  it("renders a faux-pas banner when FauxPasFired is published", () => {
    const store = createStore({ seed: "b" });
    store.getState().replaceState(ballroomState());
    render(<BallroomView store={store} onExit={() => {}} />);

    expect(screen.queryByTestId("faux-pas-banner")).toBeNull();

    act(() => {
      conversationBus.publish({
        kind: "FauxPasFired",
        tick: 0,
        targetCharacterId: NPC,
        lockUntilTick: 5,
        wasAlreadyLocked: false,
      });
    });

    const banner = screen.getByTestId("faux-pas-banner");
    expect(banner.textContent).toContain("Miss Independent");
    expect(banner.textContent).toContain("5");
  });

  it("shows a per-portrait mood-lock badge while tick < moodLockUntilTick", () => {
    const store = createStore({ seed: "b" });
    // tick 0 < moodLockUntilTick 5 → the NPC's portrait is mood-locked.
    store.getState().replaceState(ballroomState({ moodLockUntilTick: 5, mood: "Defensive" }));
    render(<BallroomView store={store} onExit={() => {}} />);
    expect(screen.getByTestId(`portrait-moodlock-${NPC}`)).toBeTruthy();
  });

  it("omits the mood-lock badge once the lock has expired", () => {
    const store = createStore({ seed: "b" });
    store.getState().replaceState(ballroomState({ moodLockUntilTick: 0 }));
    render(<BallroomView store={store} onExit={() => {}} />);
    expect(screen.queryByTestId(`portrait-moodlock-${NPC}`)).toBeNull();
  });

  it("rosters rival-house NPCs alongside society NPCs (P25 R6)", () => {
    const store = createStore({ seed: "b" });
    const RIVAL = "rival-ashford-head" as CharacterId;
    store.getState().replaceState(
      makeGameState({
        houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ headOfHouseCharacterId: HEAD })]]),
        characters: new Map([
          [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
          [
            NPC,
            makeCharacter({ id: NPC, houseId: INDEPENDENT_HOUSE_ID, name: "Miss Independent" }),
          ],
          [
            RIVAL,
            makeCharacter({
              id: RIVAL,
              houseId: "rival-ashford" as never,
              name: "Lord Ashford",
              role: "HeadOfHouse",
            }),
          ],
        ]),
      }),
    );
    render(<BallroomView store={store} onExit={() => {}} />);
    expect(screen.getByTestId(`portrait-card-${RIVAL}`)).toBeTruthy();
    expect(screen.getByTestId(`portrait-card-${NPC}`)).toBeTruthy();
  });

  it("surfaces the per-turn result on ConversationResolved", () => {
    const store = createStore({ seed: "b" });
    store.getState().replaceState(ballroomState());
    render(<BallroomView store={store} onExit={() => {}} />);

    act(() => {
      conversationBus.publish({
        kind: "ConversationResolved",
        tick: 0,
        pairKey: `${PLAYER_HOUSE_ID}|${NPC}` as never,
        classifiedTactic: "Flattery",
        affectionDelta: 6,
        composureDelta: 0,
        synergy: true,
        moodHint: "Receptive",
      });
    });

    const readout = screen.getByTestId("turn-result-readout");
    expect(readout.textContent).toContain("+6 affection");
    expect(readout.textContent).toContain("synergy");
  });
});

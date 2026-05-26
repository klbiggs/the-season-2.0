// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeCharacter, makeGameState, makeHouse } from "../../../game/__test-utils__/factories";
import type { Duel } from "../../../game/entities";
import {
  type CharacterId,
  type DuelId,
  type GrievanceId,
  type HouseId,
  INDEPENDENT_HOUSE_ID,
  PLAYER_HOUSE_ID,
} from "../../../game/rng.seeds";
import { createStore } from "../../../game/store";
import { GrievancesTab } from "./GrievancesTab";

afterEach(cleanup);

const HEAD = "head" as CharacterId;
const RIVAL_CHAR = "rival-char" as CharacterId;

describe("GrievancesTab duels sub-section (P21)", () => {
  it("renders player-involved duels with outcome + casualty (matrix: duels readout)", () => {
    const store = createStore({ seed: "g" });
    const duel: Duel = {
      id: "duel-0001" as DuelId,
      challengerCharacterId: HEAD,
      defenderCharacterId: RIVAL_CHAR,
      grievanceId: "grv-0001" as GrievanceId,
      initiatedAtTick: 5,
      status: "Resolved",
      resolvedAtTick: 6,
      outcome: "ChallengerVictory",
      loserCasualty: "Wounded",
      exchangesElapsed: 8,
    };
    const state = makeGameState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse", name: "Lord Player" })],
        [
          RIVAL_CHAR,
          makeCharacter({ id: RIVAL_CHAR, houseId: INDEPENDENT_HOUSE_ID, name: "Mr Defender" }),
        ],
      ]),
      duels: new Map([[duel.id, duel]]),
    });
    store.getState().replaceState(state);
    render(<GrievancesTab store={store} />);

    expect(screen.getByTestId("grievances-duels-list")).toBeTruthy();
    const row = screen.getByTestId(`duel-row-${duel.id}`);
    expect(row.textContent).toContain("Lord Player");
    expect(row.textContent).toContain("Mr Defender");
    expect(row.textContent).toContain("ChallengerVictory");
    expect(row.textContent).toContain("Wounded");
  });

  it("excludes duels with no player-house participant", () => {
    const store = createStore({ seed: "g" });
    const otherA = "other-a" as CharacterId;
    const otherB = "other-b" as CharacterId;
    const duel: Duel = {
      id: "duel-0002" as DuelId,
      challengerCharacterId: otherA,
      defenderCharacterId: otherB,
      grievanceId: "grv-0002" as GrievanceId,
      initiatedAtTick: 1,
      status: "Active",
      resolvedAtTick: null,
      outcome: null,
      loserCasualty: "Unharmed",
      exchangesElapsed: 0,
    };
    const state = makeGameState({
      houses: new Map([
        [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
      ]),
      characters: new Map([
        [HEAD, makeCharacter({ id: HEAD, role: "HeadOfHouse" })],
        [otherA, makeCharacter({ id: otherA, houseId: "house-rival-a" as HouseId })],
        [otherB, makeCharacter({ id: otherB, houseId: "house-rival-b" as HouseId })],
      ]),
      duels: new Map([[duel.id, duel]]),
    });
    store.getState().replaceState(state);
    render(<GrievancesTab store={store} />);

    expect(screen.queryByTestId("grievances-duels-list")).toBeNull();
    expect(screen.getByText("No duels fought.")).toBeTruthy();
  });
});

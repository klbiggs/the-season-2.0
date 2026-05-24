// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeCharacter, makeGameState, makeHouse } from "../../../game/__test-utils__/factories";
import type {
  BloodFeud,
  GameState,
  Grievance,
  InheritedSecret,
  Scheme,
} from "../../../game/entities";
import { PATRONESSES_FIXTURE } from "../../../game/fixtures/patronesses";
import { RIVAL_HOUSE_IDS_SET } from "../../../game/fixtures/rivals";
import {
  type BloodFeudId,
  type CharacterId,
  type GrievanceId,
  type HouseId,
  type InheritedSecretId,
  PLAYER_HOUSE_ID,
  type SchemeId,
  type WhisperId,
} from "../../../game/rng.seeds";
import { createStore } from "../../../game/store";
import { DynastyTab } from "./DynastyTab";
import { GrievancesTab } from "./GrievancesTab";
import { PatronessesTab } from "./PatronessesTab";
import { RivalsTab } from "./RivalsTab";
import { SchemesTab } from "./SchemesTab";

afterEach(cleanup);

describe("PatronessesTab (matrix #15)", () => {
  it("renders one row per fixture patroness + the faction-tension matrix", () => {
    const store = createStore({ seed: "p" });
    render(<PatronessesTab store={store} />);
    const rows = screen.getAllByTestId(/^patroness-row-/);
    expect(rows).toHaveLength(PATRONESSES_FIXTURE.length);
    expect(screen.getByTestId("faction-tension-matrix")).toBeTruthy();
  });
});

describe("RivalsTab (matrix #18-20)", () => {
  it("renders one row per rival in the canonical set", () => {
    const store = createStore({ seed: "r" });
    render(<RivalsTab store={store} />);
    const rows = screen.getAllByTestId(/^rival-row-/);
    expect(rows).toHaveLength(RIVAL_HOUSE_IDS_SET.size);
  });

  it("renders inherited secrets and collapses overflow past MAX (matrix #19)", () => {
    const store = createStore({ seed: "r" });
    // 13 secrets > MAX_INHERITED_SECRETS (12) → 12 rows + a "+1 collapsed" footer.
    const secrets: InheritedSecret[] = Array.from({ length: 13 }, (_, i) => ({
      id: `secret-${i}` as InheritedSecretId,
      sourceWhisperId: `whisper-${i}` as WhisperId,
      description: `Secret ${i}`,
      originatingGenerationCount: 1,
      originatingTick: 0,
      surfacedAgainstHouseId: null,
      surfacedAtTick: null,
    }));
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, inheritedSecrets: secrets })],
        ]),
      }),
    );
    render(<RivalsTab store={store} />);
    expect(screen.getByTestId("inherited-secrets-list").children).toHaveLength(12);
    expect(screen.getByTestId("inherited-secrets-collapsed").textContent).toContain("+1");
  });

  it("renders an active blood feud row (matrix #20)", () => {
    const store = createStore({ seed: "r" });
    const feud: BloodFeud = {
      id: "feud-1" as BloodFeudId,
      offendingHouseId: "rival-ashford" as HouseId,
      triggeringSecretId: "secret-0" as InheritedSecretId,
      triggeringGrievanceId: "griev-0" as GrievanceId,
      incurredAtTick: 5,
      resolved: false,
      resolvedAtTick: null,
      resolutionKind: null,
    };
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, bloodFeuds: [feud] })],
        ]),
      }),
    );
    render(<RivalsTab store={store} />);
    expect(screen.getByTestId("blood-feud-row-feud-1")).toBeTruthy();
  });
});

describe("GrievancesTab (matrix #16)", () => {
  function stateWithGrievances(): GameState {
    const head = makeCharacter({
      id: "head" as CharacterId,
      role: "HeadOfHouse",
      houseId: PLAYER_HOUSE_ID,
    });
    const defender = makeCharacter({
      id: "rival-char" as CharacterId,
      houseId: "rival-ashford" as HouseId,
      alive: true,
    });
    const actionable: Grievance = {
      id: "griev-actionable" as GrievanceId,
      perpetratorHouseId: "rival-ashford" as HouseId,
      defendantCharacterId: "rival-char" as CharacterId,
      source: "Sabotage",
      schemeId: null,
      recordedAtTick: 10,
      resolved: false,
    };
    const legacy: Grievance = {
      id: "griev-legacy" as GrievanceId,
      perpetratorHouseId: "rival-ashford" as HouseId,
      defendantCharacterId: null, // unactionable
      source: "FauxPas",
      schemeId: null,
      recordedAtTick: 5,
      resolved: false,
    };
    return makeGameState({
      houses: new Map([
        [
          PLAYER_HOUSE_ID,
          makeHouse({
            id: PLAYER_HOUSE_ID,
            headOfHouseCharacterId: "head" as CharacterId,
            grievances: [actionable, legacy],
          }),
        ],
        ["rival-ashford" as HouseId, makeHouse({ id: "rival-ashford" as HouseId })],
      ]),
      characters: new Map([
        [head.id, head],
        [defender.id, defender],
      ]),
    });
  }

  it("enables Demand Satisfaction only for grievances with a recorded defendant", () => {
    const store = createStore({ seed: "g" });
    store.getState().replaceState(stateWithGrievances());
    render(<GrievancesTab store={store} />);
    const buttons = screen.getAllByRole("button", { name: "Demand Satisfaction" });
    expect(buttons).toHaveLength(2);
    // Lex order of grievance ids: griev-actionable before griev-legacy.
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
  });

  it("dispatches demandSatisfaction and surfaces the duel outcome (matrix #17)", () => {
    const store = createStore({ seed: "g" });
    store.getState().replaceState(stateWithGrievances());
    render(<GrievancesTab store={store} />);
    const actionable = screen.getAllByRole("button", { name: "Demand Satisfaction" })[0];
    fireEvent.click(actionable as HTMLButtonElement);
    // The store's demandSatisfaction runs a real duel; the result strip renders
    // either an outcome line or a rejection — both populate the result region.
    expect(screen.getByTestId("grievance-result").textContent).not.toBe("");
  });
});

describe("SchemesTab (matrix #6)", () => {
  function scheme(id: string, status: Scheme["status"]): Scheme {
    return {
      id: id as SchemeId,
      kind: "Sabotage",
      ownerHouseId: PLAYER_HOUSE_ID,
      aggressorCharacterId: "head" as CharacterId,
      targetCharacterId: "rival-char" as CharacterId,
      startedAtTick: 1,
      endsAtTick: 5,
      status,
      resolvedAtTick: status === "Active" ? null : 5,
      failureReason: status === "Failed" ? "Discovered" : null,
      accumulatedAffection: 0,
    };
  }

  it("groups non-active schemes into completed / cancelled / failed history", () => {
    const store = createStore({ seed: "s" });
    store.getState().replaceState(
      makeGameState({
        schemes: new Map([
          ["s-c", scheme("s-c", "Completed")],
          ["s-x", scheme("s-x", "Cancelled")],
          ["s-f", scheme("s-f", "Failed")],
        ] as [SchemeId, Scheme][]),
      }),
    );
    render(<SchemesTab store={store} />);
    expect(screen.getByTestId("schemes-history-completed-list")).toBeTruthy();
    expect(screen.getByTestId("schemes-history-cancelled-list")).toBeTruthy();
    expect(screen.getByTestId("schemes-history-failed-list")).toBeTruthy();
  });
});

describe("DynastyTab (P15)", () => {
  it("renders progress counters toward each unearned perk on a fresh house", () => {
    const store = createStore({ seed: "d" });
    render(<DynastyTab store={store} />);
    expect(screen.getByTestId("ledger-tab-dynasty")).toBeTruthy();
    // Fresh house: nothing awarded, all three perks shown as progress.
    expect(screen.getByTestId("dynasty-awarded-empty")).toBeTruthy();
    expect(screen.getByTestId("dynasty-progress-row-Patronage")).toBeTruthy();
    expect(screen.getByTestId("dynasty-progress-row-Seduction")).toBeTruthy();
    expect(screen.getByTestId("dynasty-progress-row-Whispers")).toBeTruthy();
  });

  it("renders an awarded perk with its tick + generation and drops it from progress", () => {
    const store = createStore({ seed: "d" });
    store.getState().replaceState(
      makeGameState({
        houses: new Map([
          [
            PLAYER_HOUSE_ID,
            makeHouse({
              id: PLAYER_HOUSE_ID,
              awardedDynastyPerks: [
                { perk: "Seduction", awardedAtTick: 42, awardedDuringGeneration: 3 },
              ],
              cumulativeSuccessfulSeductions: 4,
            }),
          ],
        ]),
      }),
    );
    render(<DynastyTab store={store} />);
    const row = screen.getByTestId("dynasty-awarded-row-Seduction");
    expect(row.textContent).toContain("tick 42");
    expect(row.textContent).toContain("generation 3");
    // Awarded perk no longer appears as a progress row.
    expect(screen.queryByTestId("dynasty-progress-row-Seduction")).toBeNull();
  });
});

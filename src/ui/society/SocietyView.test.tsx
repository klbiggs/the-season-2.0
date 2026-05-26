// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-force-graph-2d", () => ({ default: () => null }));

import { makeCharacter, makeGameState, makeHouse } from "../../game/__test-utils__/factories";
import { makePairKey } from "../../game/conversation/types";
import type { Character, House } from "../../game/entities";
import {
  type CharacterId,
  type HouseId,
  INDEPENDENT_HOUSE_ID,
  PLAYER_HOUSE_ID,
} from "../../game/rng.seeds";
import { createStore } from "../../game/store";
import { SocietyView, buildSocietyGraphData } from "./SocietyView";

afterEach(cleanup);

const HEAD = "head" as CharacterId;
const INDY = "indy-1" as CharacterId;
const RIVAL_HOUSE = "rival-ashford" as HouseId;
const RIVAL = "rival-1" as CharacterId;

function fixture(): {
  characters: Map<CharacterId, Character>;
  houses: Map<HouseId, House>;
} {
  const characters = new Map<CharacterId, Character>([
    [HEAD, makeCharacter({ id: HEAD, houseId: PLAYER_HOUSE_ID, name: "Head" })],
    [INDY, makeCharacter({ id: INDY, houseId: INDEPENDENT_HOUSE_ID, name: "Indy NPC" })],
    [RIVAL, makeCharacter({ id: RIVAL, houseId: RIVAL_HOUSE, name: "Rival NPC" })],
  ]);
  const houses = new Map<HouseId, House>([
    [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: HEAD })],
    [INDEPENDENT_HOUSE_ID, makeHouse({ id: INDEPENDENT_HOUSE_ID })],
    [RIVAL_HOUSE, makeHouse({ id: RIVAL_HOUSE, headOfHouseCharacterId: RIVAL })],
  ]);
  return { characters, houses };
}

describe("buildSocietyGraphData (P22)", () => {
  it("includes every alive non-player character plus the player head", () => {
    const { characters, houses } = fixture();
    const { nodes } = buildSocietyGraphData(characters, houses, new Map());
    expect(nodes.map((n) => n.id).sort()).toEqual(["head", "indy-1", "rival-1"]);
  });

  it("renders both outbound and inbound affection edges", () => {
    const { characters, houses } = fixture();
    const affectionMap = new Map([
      [makePairKey(PLAYER_HOUSE_ID, INDY), 70], // outbound: player → indy
      [makePairKey(RIVAL_HOUSE, HEAD), 40], // inbound: rival head → player head
    ]);
    const { links } = buildSocietyGraphData(characters, houses, affectionMap);
    expect(links).toHaveLength(2);
    expect(links.find((l) => l.direction === "outbound")).toMatchObject({
      source: "head",
      target: "indy-1",
    });
    expect(links.find((l) => l.direction === "inbound")).toMatchObject({
      source: "rival-1",
      target: "head",
    });
  });

  it("excludes dead non-player characters from nodes", () => {
    const { characters, houses } = fixture();
    characters.set(INDY, makeCharacter({ id: INDY, houseId: INDEPENDENT_HOUSE_ID, alive: false }));
    const { nodes } = buildSocietyGraphData(characters, houses, new Map());
    expect(nodes.map((n) => n.id)).not.toContain("indy-1");
  });
});

describe("SocietyView", () => {
  it("rosters non-player houses, not the player family", () => {
    const store = createStore({ seed: "s" });
    const { characters, houses } = fixture();
    store.getState().replaceState(makeGameState({ characters, houses }));
    render(<SocietyView store={store} />);
    expect(screen.getByTestId(`society-row-${INDY}`)).toBeTruthy();
    expect(screen.getByTestId(`society-row-${RIVAL}`)).toBeTruthy();
    expect(screen.queryByTestId(`society-row-${HEAD}`)).toBeNull(); // player head excluded
  });

  it("opening an NPC bio expander calls revealNpcBio", () => {
    const store = createStore({ seed: "s" });
    const { characters, houses } = fixture();
    store.getState().replaceState(makeGameState({ characters, houses }));
    const spy = vi.spyOn(store.getState(), "revealNpcBio");
    render(<SocietyView store={store} />);
    const details = screen.getByTestId(`society-bio-${INDY}`) as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(spy).toHaveBeenCalledWith(INDY);
  });

  it("toggles into the spatial web sub-view", () => {
    const store = createStore({ seed: "s" });
    const { characters, houses } = fixture();
    store.getState().replaceState(makeGameState({ characters, houses }));
    render(<SocietyView store={store} />);
    expect(screen.queryByTestId("society-web")).toBeNull();
    fireEvent.click(screen.getByTestId("society-spatial-toggle"));
    expect(screen.getByTestId("society-web")).toBeTruthy();
  });
});

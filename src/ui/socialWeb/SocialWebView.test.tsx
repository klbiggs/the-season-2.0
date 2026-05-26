// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// react-force-graph-2d renders to canvas (unsupported in jsdom); stub it so we
// can exercise the pure graph derivation + the component shell without the lib.
vi.mock("react-force-graph-2d", () => ({
  default: () => null,
}));

import { makeCharacter, makeHouse } from "../../game/__test-utils__/factories";
import { makePairKey } from "../../game/conversation/types";
import type { Character, House } from "../../game/entities";
import { type CharacterId, type HouseId, PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { buildSocialGraphData } from "./SocialWebView";

const RIVAL_HOUSE = "rival-ashford" as HouseId;

function fixture(): {
  characters: Map<CharacterId, Character>;
  houses: Map<HouseId, House>;
} {
  const head = makeCharacter({ id: "head" as CharacterId, houseId: PLAYER_HOUSE_ID, name: "Head" });
  const sib = makeCharacter({
    id: "sib" as CharacterId,
    houseId: PLAYER_HOUSE_ID,
    name: "Sibling",
  });
  const npc = makeCharacter({
    id: "npc-1" as CharacterId,
    houseId: RIVAL_HOUSE,
    name: "Rival NPC",
  });
  const characters = new Map<CharacterId, Character>([
    [head.id, head],
    [sib.id, sib],
    [npc.id, npc],
  ]);
  const houses = new Map<HouseId, House>([
    [PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID, headOfHouseCharacterId: head.id })],
    // P22: rival head = npc-1 so an inbound (NPC → player) edge has a real source.
    [RIVAL_HOUSE, makeHouse({ id: RIVAL_HOUSE, headOfHouseCharacterId: npc.id })],
  ]);
  return { characters, houses };
}

describe("buildSocialGraphData (matrix #11)", () => {
  it("includes player-house characters and affection targets as nodes", () => {
    const { characters, houses } = fixture();
    const affectionMap = new Map([[makePairKey(PLAYER_HOUSE_ID, "npc-1" as CharacterId), 80]]);
    const { nodes } = buildSocialGraphData(characters, houses, affectionMap);
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["head", "npc-1", "sib"]);
  });

  it("draws one player-outbound link per affectionMap entry, head → target", () => {
    const { characters, houses } = fixture();
    const affectionMap = new Map([[makePairKey(PLAYER_HOUSE_ID, "npc-1" as CharacterId), 80]]);
    const { links } = buildSocialGraphData(characters, houses, affectionMap);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ source: "head", target: "npc-1", direction: "outbound" });
    expect(links[0]?.weight).toBeCloseTo(0.8);
  });

  it("renders NPC→player affection as an inbound link, holder head → player head (P22)", () => {
    const { characters, houses } = fixture();
    const affectionMap = new Map([
      [makePairKey(PLAYER_HOUSE_ID, "npc-1" as CharacterId), 80], // outbound
      [makePairKey(RIVAL_HOUSE, "head" as CharacterId), 50], // inbound: rival head npc-1 → player head
    ]);
    const { links } = buildSocialGraphData(characters, houses, affectionMap);
    expect(links).toHaveLength(2);
    const inbound = links.find((l) => l.direction === "inbound");
    expect(inbound).toMatchObject({ source: "npc-1", target: "head", direction: "inbound" });
    expect(inbound?.weight).toBeCloseTo(0.5);
  });

  it("colors player-house nodes gold and others by faction", () => {
    const { characters, houses } = fixture();
    const { nodes } = buildSocialGraphData(characters, houses, new Map());
    const head = nodes.find((n) => n.id === "head");
    expect(head?.isPlayer).toBe(true);
    expect(head?.color).toBe("#d4a017");
  });
});

import { describe, expect, it } from "vitest";
import type { CharacterId, HouseId } from "../../game/rng";
import type { SaveV3 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v3_to_v4 } from "./v3-to-v4";

const FIXTURE_V3: SaveV3 = {
  version: 3,
  tick: 42,
  rng: [["player" as HouseId, { seed: "test", callCount: 17 }]],
  houses: [
    [
      "player" as HouseId,
      {
        id: "player" as HouseId,
        wealth: 100,
        reputation: 50,
        scandal: 0,
        headOfHouseCharacterId: "h-001" as CharacterId,
        generation: 0,
        ancestorSummary: [],
        heirless: false,
      },
    ],
  ],
  characters: [],
  marriages: [],
  campaignName: "Test Campaign",
};

describe("migrate_v3_to_v4", () => {
  it("produces a SaveV4 with version: 4", () => {
    const v4 = migrate_v3_to_v4(FIXTURE_V3);
    expect(v4.version).toBe(4);
  });

  it("preserves tick, rng, characters, marriages, campaignName", () => {
    const v4 = migrate_v3_to_v4(FIXTURE_V3);
    expect(v4.tick).toBe(42);
    expect(v4.rng).toEqual(FIXTURE_V3.rng);
    expect(v4.characters).toEqual(FIXTURE_V3.characters);
    expect(v4.marriages).toEqual(FIXTURE_V3.marriages);
    expect(v4.campaignName).toBe("Test Campaign");
  });

  it("defaults era to Earlier", () => {
    const v4 = migrate_v3_to_v4(FIXTURE_V3);
    expect(v4.era).toBe("Earlier");
  });

  it("defaults the 5 new House fields", () => {
    const v4 = migrate_v3_to_v4(FIXTURE_V3);
    const [, house] = v4.houses[0]!;
    expect(house.currentLocation).toBe("Capital");
    expect(house.consecutiveTicksAtCurrentLocation).toBe(0);
    expect(house.lastAudienceTick).toBeNull();
    expect(house.wardrobeLastRefreshTick).toBeNull();
    expect(house.blockadeBypassEarned).toBe(false);
  });

  it("preserves legacy House fields", () => {
    const v4 = migrate_v3_to_v4(FIXTURE_V3);
    const [, house] = v4.houses[0]!;
    expect(house.wealth).toBe(100);
    expect(house.reputation).toBe(50);
    expect(house.scandal).toBe(0);
    expect(house.headOfHouseCharacterId).toBe("h-001");
    expect(house.generation).toBe(0);
    expect(house.heirless).toBe(false);
  });

  it("is idempotent", () => {
    assertMigrationIdempotent(migrate_v3_to_v4, FIXTURE_V3);
  });
});

// @vitest-environment jsdom
// P25 R8 — faction-tension force-graph builder.

import { describe, expect, it } from "vitest";
import { FACTION_IDS, makeFactionPairKey } from "../../../game/fixtures/factions";
import type { FactionPairKey } from "../../../game/rng.seeds";
import { buildFactionGraphData } from "./PatronessesTab";

describe("buildFactionGraphData (P25 R8)", () => {
  it("emits 4 faction nodes and 6 unordered-pair links", () => {
    const data = buildFactionGraphData(new Map<FactionPairKey, number>());
    expect(data.nodes.length).toBe(FACTION_IDS.length); // 4
    expect(data.links.length).toBe(6); // 4 choose 2
    expect(data.links.every((l) => l.tension === 0)).toBe(true);
  });

  it("reads each link's tension from the numeric matrix (source of truth)", () => {
    const a = FACTION_IDS[0];
    const b = FACTION_IDS[1];
    if (a === undefined || b === undefined) throw new Error("setup");
    const tensions = new Map<FactionPairKey, number>([[makeFactionPairKey(a, b), 42]]);
    const data = buildFactionGraphData(tensions);
    const link = data.links.find(
      (l) => (l.source === a && l.target === b) || (l.source === b && l.target === a),
    );
    expect(link?.tension).toBe(42);
  });
});

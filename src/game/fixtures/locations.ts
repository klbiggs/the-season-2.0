// 7 named locations per spec §3. Location semantics (era gating, per-tick
// deltas, location-bound actions) shipped at P3 alongside the strategy map.
// Transit times are placeholders at P1; the courier rule consumes them as a
// pure lookup.

import { z } from "zod";

export const LOCATIONS = [
  "Capital", // high-society / London-analog
  "Country", // rural estate
  "FinishingCapitalCultured", // continental cultured capital
  "FinishingCapitalPolitical", // continental political capital
  "CanalCity", // seduction capital A
  "RenaissanceCity", // seduction capital B
  "ForeignCapital", // wartime blockade target
] as const;

export type LocationId = (typeof LOCATIONS)[number];

// Zod-enum form. Used by HouseSchema.currentLocation. Mirrors RoleSchema
// (fixtures/roles.ts) and MoodSchema (fixtures/moods.ts).
export const LocationIdSchema = z.enum(LOCATIONS);

// Upper-triangular 7×7 transit-time matrix (ticks). Values are placeholders;
// tuning lands at P3/P6. Symmetric lookup is computed in rules/courier.ts via
// lex-key canonicalization.
export const TRANSIT_PAIRS: ReadonlyArray<[LocationId, LocationId, number]> = [
  ["Capital", "Country", 2],
  ["Capital", "FinishingCapitalCultured", 8],
  ["Capital", "FinishingCapitalPolitical", 10],
  ["Capital", "CanalCity", 9],
  ["Capital", "RenaissanceCity", 11],
  ["Capital", "ForeignCapital", 14],
  ["Country", "FinishingCapitalCultured", 9],
  ["Country", "FinishingCapitalPolitical", 11],
  ["Country", "CanalCity", 10],
  ["Country", "RenaissanceCity", 12],
  ["Country", "ForeignCapital", 14],
  ["FinishingCapitalCultured", "FinishingCapitalPolitical", 4],
  ["FinishingCapitalCultured", "CanalCity", 5],
  ["FinishingCapitalCultured", "RenaissanceCity", 6],
  ["FinishingCapitalCultured", "ForeignCapital", 12],
  ["FinishingCapitalPolitical", "CanalCity", 6],
  ["FinishingCapitalPolitical", "RenaissanceCity", 7],
  ["FinishingCapitalPolitical", "ForeignCapital", 11],
  ["CanalCity", "RenaissanceCity", 3],
  ["CanalCity", "ForeignCapital", 13],
  ["RenaissanceCity", "ForeignCapital", 14],
];

// CSS percentage coordinates for the absolute-positioned DOM pins over the
// map backdrop. Values are relative to <MapView />'s positioned parent
// container (NOT SVG viewBox coordinates). Tuning iterates at P16 polish.
export const LOCATION_PIN_COORDS: Record<LocationId, { x: number; y: number }> = {
  Capital: { x: 68, y: 32 },
  Country: { x: 72, y: 62 },
  FinishingCapitalCultured: { x: 32, y: 42 },
  FinishingCapitalPolitical: { x: 38, y: 58 },
  CanalCity: { x: 24, y: 65 },
  RenaissanceCity: { x: 28, y: 78 },
  ForeignCapital: { x: 14, y: 24 },
};

export const LOCATION_LABELS: Record<LocationId, string> = {
  Capital: "The Capital",
  Country: "The Country Estate",
  FinishingCapitalCultured: "Cultured Capital",
  FinishingCapitalPolitical: "Political Capital",
  CanalCity: "Canal City",
  RenaissanceCity: "Renaissance City",
  ForeignCapital: "Foreign Capital",
};

export const LOCATION_DESCRIPTIONS: Record<LocationId, string> = {
  Capital: "London-analog. The seat of high society — balls, audiences, gossip.",
  Country: "Your rural estate. Rents accumulate; heirlooms can be liquidated in dire need.",
  FinishingCapitalCultured:
    "A continental capital of refined arts. Stay long enough to acquire cultured sophistication.",
  FinishingCapitalPolitical:
    "A continental seat of diplomacy. Stay long enough to acquire polyglot fluency.",
  CanalCity: "A continental city of canals and intrigue. Seductions cost less reputation here.",
  RenaissanceCity:
    "A continental city of art and dissipation. Seductions cost less reputation here.",
  ForeignCapital: "Across the Channel. Blockaded during wartime; profitable in peace.",
};

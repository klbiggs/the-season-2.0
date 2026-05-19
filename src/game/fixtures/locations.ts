// 7 named locations per spec §3. Location semantics (era gating, per-tick
// deltas, location-bound actions) defer to P3. Transit times are placeholders
// at P1; the courier rule consumes them as a pure lookup.

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

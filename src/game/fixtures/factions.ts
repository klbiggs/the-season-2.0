// P8: faction registry. 4 factions per the P8 plan; 3 hold rival affiliations,
// 1 ("faction-crown") is reserved for the player house and Independent (no
// patroness, no rival on this faction at v1). Six unordered pairs are derived
// from `FACTION_IDS choose 2` and pre-seeded into state.factionTensions at
// value 0.
//
// `Faction` entities are NOT serialized into saves — fixture-only data. Only
// `FactionId` values appear in save format (inside House.factionId,
// PatronessRecord.factionId, RivalActorState.factionId, FactionPairKey strings).

import { z } from "zod";
import { type FactionId, FactionIdSchema, type FactionPairKey } from "../rng";

export const FactionSchema = z.object({
  id: FactionIdSchema,
  displayName: z.string(),
});
export type Faction = z.infer<typeof FactionSchema>;

export const FACTION_IDS = [
  "faction-court" as FactionId, // Court / Whitehall — Lady Castlereagh, Mrs. Drummond Burrell
  "faction-ton" as FactionId, // High Society / Almack's — Lady Jersey, Lady Cowper
  "faction-country" as FactionId, // Country gentry — Lady Sefton
  "faction-crown" as FactionId, // Crown / monarch-aligned — no patroness; player + Independent affiliation
] as const;

export const PLAYER_FACTION_ID = "faction-crown" as FactionId;

export const FACTION_DISPLAY_NAMES: readonly string[] = [
  "Court",
  "Ton",
  "Country",
  "Crown",
] as const;

export const FACTIONS_FIXTURE: readonly Faction[] = FACTION_IDS.map((id, idx) => ({
  id,
  displayName: FACTION_DISPLAY_NAMES[idx] ?? "",
}));

if (FACTION_IDS.length !== 4) {
  throw new Error("P8 plan requires exactly 4 factions for the 6-pair tension grid");
}
if (FACTIONS_FIXTURE.length !== FACTION_IDS.length) {
  throw new Error("FACTIONS_FIXTURE length must match FACTION_IDS");
}

// Canonical lex-pair key for two distinct factions. The lex-sort discipline
// guarantees `makeFactionPairKey(a, b) === makeFactionPairKey(b, a)` for any
// a≠b, so `state.factionTensions` is keyed by unordered pairs.
export function makeFactionPairKey(a: FactionId, b: FactionId): FactionPairKey {
  if (a === b) {
    throw new Error("makeFactionPairKey requires distinct factions — self-tension is not stored");
  }
  const [first, second] = a < b ? [a, b] : [b, a];
  return `${first}|${second}` as FactionPairKey;
}

// All 6 unordered pairs derived from FACTION_IDS choose 2. Pre-seeded into
// state.factionTensions at bootstrap and via the V8→V9 migration.
export const FACTION_PAIRS: readonly FactionPairKey[] = (() => {
  const pairs: FactionPairKey[] = [];
  for (let i = 0; i < FACTION_IDS.length; i++) {
    for (let j = i + 1; j < FACTION_IDS.length; j++) {
      const a = FACTION_IDS[i];
      const b = FACTION_IDS[j];
      if (a === undefined || b === undefined) continue;
      pairs.push(makeFactionPairKey(a, b));
    }
  }
  return Object.freeze(pairs);
})();

if (FACTION_PAIRS.length !== 6) {
  throw new Error("4 factions choose 2 = 6 unordered pairs");
}

// Lex-smallest opposing faction for a rival (excludes Crown — player neutral —
// and the rival's own faction). Returns null if no opposing faction qualifies
// (structurally impossible with 4 factions + 1 excluded crown).
export function lexPickOpposingFaction(rivalFactionId: FactionId): FactionId | null {
  const candidates: FactionId[] = [];
  for (const fid of FACTION_IDS) {
    if (fid === PLAYER_FACTION_ID) continue;
    if (fid === rivalFactionId) continue;
    candidates.push(fid);
  }
  if (candidates.length === 0) return null;
  candidates.sort();
  return candidates[0] ?? null;
}

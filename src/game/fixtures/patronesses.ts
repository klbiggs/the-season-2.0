// P8: canonical 5 patronesses per spec §3 line 113 "Five named arbiters of
// social access". Names are Regency-flavored; each carries a factionId from
// the 3-faction enum (faction-ton, faction-court, faction-country — the 3
// non-crown factions, since "Crown" is the player house's neutral affiliation
// with no patroness). 5 patronesses + 3 factions split 2-2-1: ton gets Jersey
// and Cowper; court gets Castlereagh and Mrs. Drummond Burrell; country gets
// Sefton.
//
// Used by createInitialState (fresh-state path) — seeds into
// state.patronesses Map.

import type { PatronessRecord } from "../entities";
import type { FactionId, PatronessId } from "../rng";

export const PATRONESSES_FIXTURE: readonly PatronessRecord[] = [
  {
    id: "patroness-lady-jersey" as PatronessId,
    displayName: "Lady Jersey",
    favor: 50,
    factionId: "faction-ton" as FactionId,
  },
  {
    id: "patroness-lady-castlereagh" as PatronessId,
    displayName: "Lady Castlereagh",
    favor: 50,
    factionId: "faction-court" as FactionId,
  },
  {
    id: "patroness-lady-cowper" as PatronessId,
    displayName: "Lady Cowper",
    favor: 50,
    factionId: "faction-ton" as FactionId,
  },
  {
    id: "patroness-lady-sefton" as PatronessId,
    displayName: "Lady Sefton",
    favor: 50,
    factionId: "faction-country" as FactionId,
  },
  {
    id: "patroness-mrs-drummond" as PatronessId,
    displayName: "Mrs. Drummond Burrell",
    favor: 50,
    factionId: "faction-court" as FactionId,
  },
];

if (PATRONESSES_FIXTURE.length !== 5) {
  throw new Error("Spec §3 requires 5 patronesses");
}

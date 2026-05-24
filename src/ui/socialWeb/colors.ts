// P14: Social Web node palette. Pure rendering values — NOT runtime fixtures,
// NOT hash-relevant. Keyed by FactionId so a non-player character's node takes
// its house's faction color; the player house's own characters render in gold.

import type { FactionId } from "../../game/rng.seeds";

export const PLAYER_NODE_COLOR = "#d4a017"; // gold — player-house characters

export const FACTION_COLOR_BY_ID: Readonly<Record<string, string>> = {
  "faction-court": "#7c3aed", // violet
  "faction-ton": "#db2777", // pink
  "faction-country": "#16a34a", // green
  "faction-crown": "#a16207", // amber (Crown-aligned NPCs)
};

export const FALLBACK_NODE_COLOR = "#64748b"; // slate — unknown faction

export function factionColor(factionId: FactionId | undefined): string {
  if (factionId === undefined) return FALLBACK_NODE_COLOR;
  return FACTION_COLOR_BY_ID[factionId] ?? FALLBACK_NODE_COLOR;
}

// Node color while an animation cue is active (faux-pas / sabotage / proposal
// rejection slide-away). Distinct red so the reacting node reads at a glance.
export const REACTING_NODE_COLOR = "#dc2626";

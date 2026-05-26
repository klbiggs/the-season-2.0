// P22: deterministic colored-monogram portrait. Replaces the flat initial-letter
// glyph with a per-CharacterId background color + a faction-tinted ring, so every
// character reads as visually distinct at a glance. Pure rendering — the hash is
// UI-LOCAL and cosmetic (NOT the game's fnv1a32, NOT hash-relevant), so it stays
// in src/ui per the "UI-local values live with their rendering module" precedent.

import type { FactionId } from "../../game/rng.seeds";
import { factionColor } from "../socialWeb/colors";

export type MonogramStyle = {
  backgroundColor: string;
  ringColor: string;
};

// Small UI-local string hash. Cosmetic only — independence from the game hash is
// deliberate (a future change here must never touch gameplay determinism).
function hashHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  // Unsigned, then map to a hue in [0, 360).
  return (h >>> 0) % 360;
}

// Pastel background (fixed S/L so dark text stays legible across all hues) + a
// faction-colored ring. `factionId` undefined → the neutral fallback ring color.
export function monogramStyle(id: string, factionId?: FactionId): MonogramStyle {
  return {
    backgroundColor: `hsl(${hashHue(id)}, 52%, 82%)`,
    ringColor: factionColor(factionId),
  };
}

// First character of the name for the monogram letter (matches the prior glyph).
export function monogramLetter(name: string): string {
  return name.charAt(0).toUpperCase();
}

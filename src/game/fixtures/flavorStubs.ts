// P18: designer-authored fallback stubs for generated flavor content. A stub
// is rendered whenever there is no SUCCESSFULLY-generated entry in
// state.flavorText for a content id (spec §3 line 269 — "a failed generation
// falls back to a designer-authored stub so play is uninterrupted"). Stubs are
// NEVER persisted; only LLM successes land in the save. The display surfaces
// (ArtifactsTab / PortraitCard / ScandalSheetTab) call flavorStubFor() when the
// lookup misses.

import type { Character } from "../entities";
import type { FlavorContentId } from "../rng";

// One stub per artifact definition (7 at v1). Keyed by definitionId.
export const ARTIFACT_BACKSTORY_STUBS: ReadonlyMap<string, string> = new Map([
  [
    "sapphires",
    "A set of sapphires said to have come north with a Carrington bride, worn at every consequential ball since.",
  ],
  [
    "tiara",
    "The Marlborough tiara, glittering proof of a lineage that prefers its history worn rather than recounted.",
  ],
  [
    "snuffbox",
    "An enamelled snuffbox of imperial provenance, passed between gentlemen of taste and the occasional debt.",
  ],
  [
    "phaeton",
    "A crimson phaeton built for being seen in, and seen it has been, on every fashionable drive in the season.",
  ],
  [
    "mount",
    "A spirited mount of impeccable bloodline, the envy of the park and the despair of lesser riders.",
  ],
  [
    "family-deed",
    "A deed to lands held since before anyone troubled to write the date, and worth more for the holding than the acreage.",
  ],
  [
    "ancestral-portrait",
    "An ancestral portrait whose painted eyes have watched the family rise, falter, and rise again.",
  ],
]);

// Generic archetype-flavored stub for an NPC bio. Per-character stubs are
// infeasible for the ~25 procedural society NPCs, so this templates from the
// character's traits + role.
export function npcBioStub(character: Character): string {
  const trait = character.traits[0];
  const traitClause = trait === undefined ? "of no particular renown" : `reputed to be ${trait}`;
  return `${character.name}, a figure of the ton, ${traitClause} and much remarked upon in the season's drawing rooms.`;
}

// Generic stub for a scandal column.
export function scandalColumnStub(generationCount: number): string {
  return `Of the ${ordinal(generationCount)} generation little may be printed without consequence — the season passed, as all seasons do, with its share of whispers behind fans.`;
}

// Resolves the stub for any flavor id by parsing its prefix. Display surfaces
// call this when state.flavorText has no entry for the id. `character` is
// required only for bio ids (the caller has it in hand at that surface).
export function flavorStubFor(
  id: FlavorContentId,
  opts?: { character?: Character; generationCount?: number },
): string {
  const raw = id as string;
  if (raw.startsWith("artifact:")) {
    const definitionId = raw.slice("artifact:".length);
    return ARTIFACT_BACKSTORY_STUBS.get(definitionId) ?? "An heirloom of quiet distinction.";
  }
  if (raw.startsWith("bio:")) {
    return opts?.character !== undefined
      ? npcBioStub(opts.character)
      : "A figure of the ton, much remarked upon.";
  }
  if (raw.startsWith("scandal:")) {
    const gen = opts?.generationCount ?? (Number.parseInt(raw.slice("scandal:".length), 10) || 0);
    return scandalColumnStub(gen);
  }
  return "";
}

function ordinal(n: number): string {
  const labels = ["earliest", "first", "second", "third", "fourth", "fifth"];
  return labels[n] ?? `${n}th`;
}

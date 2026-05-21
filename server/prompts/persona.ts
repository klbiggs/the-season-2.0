// Builds the system-instruction string for a target NPC. Consumed by the
// caches.create() call in server/personaCache.ts — NOT passed directly to
// generateContent on each request (Gemini's caching is explicit: cache the
// persona once per (target, model) pair, then reference the cache name in
// subsequent generateContent calls).
//
// CANONICAL FORMAT (pinned for determinism — the cache key + cached
// systemInstruction text are stable across runs; format changes require
// bumping PERSONA_CACHE_VERSION in src/game/constants.ts).
//   You are <name>, <role-label> of London Society.
//   Traits: <comma-joined trait labels, in array-order — NOT lex-sorted>.
//   Current mood: <mood>.
//   Archetype: <archetype | "None">.
//   Marriage status: <unmarried | married to NAME | widowed>.
//   Happiness: <content | subdued | discontent | discontent — has felt the temptation>.
//   Reply in character. Keep your replies brief and period-appropriate.
//   [P6: when otherCharactersInScene non-empty]
//   Other characters in this scene:
//   - <id>: <name> (<role>)
//   - ...
//
// P7.5: moved from src/llm/prompts/persona.ts. Signature refactored from
// `buildPersonaPrompt(target, others, state)` → `buildPersonaPrompt(snapshot)` —
// the client extracts the snapshot at request-build time (resolving spouse
// inline), the server reads the snapshot directly.

import type { CharacterStateSnapshot, Role } from "../../src/llm/types";
import { TRAITS } from "../../src/llm/types";

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  HeadOfHouse: "a head",
  Heir: "an heir",
  Dependent: "a member",
  Spouse: "a spouse",
  Spinster: "a spinster",
  Exile: "an exile",
  Bohemian: "a bohemian",
};

const TRAIT_LABEL_BY_ID = new Map(TRAITS.map((t) => [t.id, t.label]));

function formatMarriageStatusLine(snapshot: CharacterStateSnapshot): string {
  const m = snapshot.targetMarriage;
  if (m === null) return "Marriage status: unmarried.";
  if (m.dissolved) return "Marriage status: widowed.";
  const spouseName = snapshot.spouse?.name ?? "(unknown)";
  return `Marriage status: married to ${spouseName}.`;
}

function formatHappinessLine(snapshot: CharacterStateSnapshot): string {
  const target = snapshot.target;
  if (target.temptationHookUnlocked) return "Happiness: discontent — has felt the temptation.";
  if (target.happiness >= 70) return "Happiness: content.";
  if (target.happiness >= 30) return "Happiness: subdued.";
  return "Happiness: discontent.";
}

export function buildPersonaPrompt(snapshot: CharacterStateSnapshot): string {
  const target = snapshot.target;
  const traitLabels = target.traits.map((id) => TRAIT_LABEL_BY_ID.get(id) ?? id).join(", ");
  const roleLabel = ROLE_LABELS[target.role];
  const baseLines = [
    `You are ${target.name}, ${roleLabel} of London Society.`,
    `Traits: ${traitLabels}.`,
    `Current mood: ${target.mood}.`,
    `Archetype: ${target.archetype}.`,
    formatMarriageStatusLine(snapshot),
    formatHappinessLine(snapshot),
    "Reply in character. Keep your replies brief and period-appropriate.",
  ];
  const others = snapshot.otherCharactersInScene;
  if (others.length === 0) return baseLines.join("\n");
  const sceneLines = [
    "Other characters in this scene:",
    ...others.map((c) => `- ${c.id}: ${c.name} (${ROLE_LABELS[c.role]})`),
  ];
  return [...baseLines, ...sceneLines].join("\n");
}

// Builds the system-instruction string for a target NPC. Consumed by the
// caches.create() call in src/llm/cache.ts — NOT passed directly to
// generateContent on each request (Gemini's caching is explicit: cache the
// persona once per (target, model) pair, then reference the cache name in
// subsequent generateContent calls).
//
// CANONICAL FORMAT (pinned for determinism — the mock SDK's request-hash
// includes this text; format changes break replay-harness determinism).
// P6 extends with an "Other characters in this scene" section AND bumps
// PERSONA_CACHE_VERSION (constants.ts) to invalidate stale P4-P5 caches.
// P7 extends baseLines with Marriage status + Happiness paragraphs AND
// bumps PERSONA_CACHE_VERSION v2 → v3.
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
// Plan: plans/phases/07-family-succession.md "Persona prompt body literal".

import type { Character, GameState } from "../../game/entities";
import type { Role } from "../../game/fixtures/roles";
import { TRAITS } from "../../game/fixtures/traits";

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  HeadOfHouse: "a head",
  Heir: "an heir",
  Dependent: "a member",
  Spouse: "a spouse",
  // P7 ADDITIONS — label text is part of the persona-prompt cache key, so
  // the PERSONA_CACHE_VERSION bump covers cache invalidation for any prose
  // change. Existing 4 labels' prose is PRESERVED verbatim from P4.
  Spinster: "a spinster",
  Exile: "an exile",
  Bohemian: "a bohemian",
};

const TRAIT_LABEL_BY_ID = new Map(TRAITS.map((t) => [t.id, t.label]));

function formatMarriageStatusLine(target: Character, state: GameState): string {
  if (target.marriageId === null) return "Marriage status: unmarried.";
  const m = state.marriages.get(target.marriageId);
  if (m === undefined || m.dissolved) return "Marriage status: widowed.";
  const spouseId = m.spouseAId === target.id ? m.spouseBId : m.spouseAId;
  const spouse = state.characters.get(spouseId);
  const spouseName = spouse?.name ?? "(unknown)";
  return `Marriage status: married to ${spouseName}.`;
}

function formatHappinessLine(target: Character): string {
  if (target.temptationHookUnlocked) return "Happiness: discontent — has felt the temptation.";
  if (target.happiness >= 70) return "Happiness: content.";
  if (target.happiness >= 30) return "Happiness: subdued.";
  return "Happiness: discontent.";
}

export function buildPersonaPrompt(
  target: Character,
  otherCharactersInScene: ReadonlyArray<Character>,
  state: GameState,
): string {
  const traitLabels = target.traits.map((id) => TRAIT_LABEL_BY_ID.get(id) ?? id).join(", ");
  const roleLabel = ROLE_LABELS[target.role];
  const baseLines = [
    `You are ${target.name}, ${roleLabel} of London Society.`,
    `Traits: ${traitLabels}.`,
    `Current mood: ${target.mood}.`,
    `Archetype: ${target.archetype}.`,
    // P7 ADDITIONS: marriage + happiness facts sit alongside mood + archetype
    // as descriptive scene-setters, not at scene-composition level.
    formatMarriageStatusLine(target, state),
    formatHappinessLine(target),
    "Reply in character. Keep your replies brief and period-appropriate.",
  ];
  if (otherCharactersInScene.length === 0) return baseLines.join("\n");
  // P6 ADDITION: scene-composition section. The model uses these ids in
  // generateWhisper toolCall payloads. Lex-sort discipline applied by
  // caller (sendBallroomMessage); preserved here in array order.
  const sceneLines = [
    "Other characters in this scene:",
    ...otherCharactersInScene.map((c) => `- ${c.id}: ${c.name} (${ROLE_LABELS[c.role]})`),
  ];
  return [...baseLines, ...sceneLines].join("\n");
}

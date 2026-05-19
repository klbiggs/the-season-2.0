// Builds the system-instruction string for a target NPC. Consumed by the
// caches.create() call in src/llm/cache.ts — NOT passed directly to
// generateContent on each request (Gemini's caching is explicit: cache the
// persona once per (target, model) pair, then reference the cache name in
// subsequent generateContent calls).
//
// CANONICAL FORMAT (pinned for determinism — the mock SDK's request-hash
// includes this text; format changes break replay-harness determinism):
//   You are <name>, <role-label> of London Society.
//   Traits: <comma-joined trait labels, in array-order — NOT lex-sorted>.
//   Current mood: <mood>.
//   Archetype: <archetype | "None">.
//   Reply in character. Keep your replies brief and period-appropriate.
//
// Plan: plans/phases/04-ballroom-llm.md "src/llm/prompts/persona.ts".

import type { Character } from "../../game/entities";
import type { Role } from "../../game/fixtures/roles";
import { TRAITS } from "../../game/fixtures/traits";

const ROLE_LABELS: Readonly<Record<Role, string>> = {
  HeadOfHouse: "a head",
  Heir: "an heir",
  Dependent: "a member",
  Spouse: "a spouse",
};

const TRAIT_LABEL_BY_ID = new Map(TRAITS.map((t) => [t.id, t.label]));

export function buildPersonaPrompt(target: Character): string {
  const traitLabels = target.traits.map((id) => TRAIT_LABEL_BY_ID.get(id) ?? id).join(", ");
  const roleLabel = ROLE_LABELS[target.role];
  return [
    `You are ${target.name}, ${roleLabel} of London Society.`,
    `Traits: ${traitLabels}.`,
    `Current mood: ${target.mood}.`,
    `Archetype: ${target.archetype}.`,
    "Reply in character. Keep your replies brief and period-appropriate.",
  ].join("\n");
}

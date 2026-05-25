// Builds the system instruction + per-kind user prompt for a flavor-generation
// request. Consumed by server/flavor.ts (passed to a single-shot
// generateContent — no caching, no function-calling, plain prose out).
//
// Server-owned prompts (same pattern as server/prompts/persona.ts): the typed
// FlavorContext arrives over the wire (the single sanctioned
// `server → src/llm/types` boundary edge) and the server composes the prompt.
// The scandal aggregation happens client-side and arrives pre-built as
// eventSummaries — the server never sees GameState.

import type { FlavorContext } from "../../src/llm/types";

// A shared period-voice frame keeps all three content kinds tonally consistent.
// "Always finish your final sentence" is the length-discipline anchor: paired
// with the per-kind sentence/word caps below + a generous maxOutputTokens
// ceiling, the model self-limits and completes naturally rather than running
// into the token wall mid-sentence.
const SYSTEM_INSTRUCTION =
  "You are a writer of Regency-era English society prose. Write vivid, " +
  "period-appropriate flavor text. Be concise and evocative; no modern idiom, " +
  "no preamble, no meta-commentary — return only the requested passage. Keep " +
  "within the requested length and always finish your final sentence.";

export function buildFlavorPrompt(context: FlavorContext): {
  systemInstruction: string;
  userPrompt: string;
} {
  return { systemInstruction: SYSTEM_INSTRUCTION, userPrompt: buildUserPrompt(context) };
}

function buildUserPrompt(context: FlavorContext): string {
  switch (context.kind) {
    case "ArtifactBackstory":
      return `In at most 3 complete sentences (under 70 words total), write a backstory for a family heirloom: "${context.displayName}" (a ${context.family}). Convey its provenance and the prestige it lends the house that displays it.`;
    case "NpcBio": {
      const c = context.character;
      const traits = c.traits.length > 0 ? c.traits.join(", ") : "no notable traits";
      return `In at most 3 complete sentences (under 70 words total), write a biographical note for ${c.name}, a member of London society (role: ${c.role}; reputed traits: ${traits}). Capture their standing and temperament as the ton would gossip of them.`;
    }
    case "ScandalColumn": {
      const events =
        context.eventSummaries.length > 0
          ? context.eventSummaries.map((e) => `- ${e}`).join("\n")
          : "- (a remarkably quiet season — nothing fit to print)";
      return `In one stylized paragraph of at most 5 complete sentences (under 110 words total), write an arch scandal-sheet gossip column summarizing the season's notable affairs (generation ${context.generationCount}), in the voice of an anonymous society columnist. Base it on these events:\n${events}`;
    }
  }
}

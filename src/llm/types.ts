// LLM-layer canonical types. The wire-contract module shared between the
// client (fetch wrapper) and the localhost server (Gemini SDK call). Owns:
//   - ProxyConversationRequest{Schema} — the wire format (client → server)
//   - CharacterStateSnapshot{Schema} — the persona-state slice inside ProxyConversationRequest
//   - ConversationResponseSchema / ConversationResponseRaw — widened-enum
//     SDK response shape (validated server-side AND client-side)
//   - ConversationResponse — narrowed form (client-side only, after
//     narrowResponse applies pin-always-overrides + clamps qualityMultiplier)
//   - narrowResponse / resolveTactic / resolveMoodHint — pure resolvers
//     run CLIENT-SIDE only (server never narrows; pin-always-overrides is
//     a combat-rules concern that lives next to the rest of combat logic)
//   - Re-exports of types/values consumed by server/prompts/persona.ts
//     and server/prompts/persona.test.ts — the SINGLE sanctioned cross-tree
//     edge from server back into the src/ tree (alongside src/game/constants).

import { z } from "zod";
import {
  QUALITY_MULTIPLIER_CEIL,
  QUALITY_MULTIPLIER_FLOOR,
  type Stance,
  type Tactic,
} from "../game/constants";
import type { MODEL_DEFAULT, MODEL_FIRST_MEETING } from "../game/constants";
import { CharacterIdSchema, HouseIdSchema } from "../game/conversation/types";
import { CharacterSchema, MarriageRecordSchema } from "../game/entities";
import type { Character, GameState, MarriageRecord } from "../game/entities";
import type { Mood } from "../game/fixtures/moods";
import { MOODS } from "../game/fixtures/moods";
import type { Role } from "../game/fixtures/roles";
import { TRAITS } from "../game/fixtures/traits";

// Re-export the shared conversation types so llm/** consumers have a single
// import surface. Brand types (CharacterId, HouseId) also re-export so
// llm/** reaches them WITHOUT importing game/rng directly (forbidden by
// the eslint rule).
export {
  ConversationPairKeySchema,
  type ConversationPairKey,
  ExchangeSchema,
  type Exchange,
  makePairKey,
  parsePairKey,
  type CharacterId,
  type HouseId,
  type ConversationFailure,
} from "../game/conversation/types";

// P7.5: type + value re-exports consumed by server/prompts/persona.ts
// (production) and server/prompts/persona.test.ts (test factories) via
// the single sanctioned `server → src/llm/types` boundary edge. Value
// vs type distinction matters — `TRAITS` is read at runtime so it MUST
// be a `export {` not `export type {`.
export { TRAITS };
export {
  makeCharacter,
  makeGameState,
  makeMarriage,
  makeMarriagesMap,
} from "../game/__test-utils__/factories";
export type { Character, GameState, MarriageRecord };
export type { Role };
export type { Mood };

export type Model = typeof MODEL_DEFAULT | typeof MODEL_FIRST_MEETING;

// ── P7.5 wire-format schemas ─────────────────────────────────────────────

// CharacterStateSnapshot — the persona-relevant state the client extracts
// at request-build time so the server can rebuild `buildPersonaPrompt`
// without consulting GameState. Three marriage states (pinned at
// formatMarriageStatusLine in server/prompts/persona.ts):
//   - target.marriageId === null  → targetMarriage: null, spouse: null
//     → "unmarried"
//   - marriage exists & dissolved → targetMarriage: {dissolved:true,…}, spouse: null
//     → "widowed"
//   - active marriage             → targetMarriage: {dissolved:false,…}, spouse: Character
//     → "married to NAME"
export const CharacterStateSnapshotSchema = z.object({
  target: CharacterSchema,
  // P26 (G7): the duplicated scene composition is DROPPED from the persona
  // snapshot — scene now rides per-turn `contents` (buildContents' [Also
  // present:] line), not the cached persona systemInstruction. The top-level
  // ProxyConversationRequest.otherCharactersInScene is the single source.
  targetMarriage: MarriageRecordSchema.nullable(),
  spouse: CharacterSchema.nullable(),
});
export type CharacterStateSnapshot = z.infer<typeof CharacterStateSnapshotSchema>;

// ProxyConversationRequest — the wire format sent from the SPA to the
// localhost Node proxy. Replaces the pre-P7.5 `ConversationRequest` type
// (deleted). The rules-layer `pinnedIntent` is NOT on the wire; it stays
// client-side and threads to `narrowResponse(raw, pinnedIntent)` after
// `client.send()` resolves.
export const ProxyConversationRequestSchema = z.object({
  targetCharacterId: CharacterIdSchema,
  playerHouseId: HouseIdSchema,
  freeformMessage: z.string(),
  history: z.array(
    z.object({
      speaker: z.enum(["house-head", "other"]),
      text: z.string(),
      // P12: widened in lockstep with ExchangeSchema. Both sides MUST be edited
      // together — client request build and server request parse both consume
      // this shape.
      classifiedTactic: z
        .enum(["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy", "ComplimentMount"])
        .nullable(),
      tick: z.number().int().nonnegative(),
    }),
  ),
  otherCharactersInScene: z.array(CharacterSchema),
  characterStateSnapshot: CharacterStateSnapshotSchema,
  // P12: mode field. `.default("Ballroom")` is the P8/P9 backward-compat
  // shortcut — pre-P12 clients omit the field, server parse applies the
  // default; post-P12 clients always send the exact case ("Promenade" or
  // "Ballroom"). Mode-framing prefix lives in server/conversation.ts's
  // buildContents (NOT systemInstruction — cachedContent + systemInstruction
  // are mutually exclusive per the Gemini SDK contract).
  mode: z.enum(["Ballroom", "Promenade", "Visit"]).default("Ballroom"),
  // P17: semantic-memory hits retrieved client-side at conversation start and
  // rendered as a separate `[Relevant past events:]` section in buildContents
  // (on per-turn `contents`, NOT systemInstruction — P12 cache mutual-exclusion).
  // `.default([])` is the backward-compat shortcut — pre-P17 clients omit it.
  semanticContext: z.array(z.string()).default([]),
  // P26 (G3): key-moment routing. A non-null keyMoment routes to the Pro model
  // (spec §5 — pre-wired at v1, activated here). Computed client-side via
  // computeKeyMoment; "audience" is wired but never emitted at v1.5.
  keyMoment: z.enum(["proposal", "scheme", "duel", "audience"]).nullable().default(null),
});
export type ProxyConversationRequest = z.infer<typeof ProxyConversationRequestSchema>;

// ── P17 embed wire-format (shared client/server) ─────────────────────────
// The client posts texts to the localhost proxy's /api/llm/embed; the server
// relays to ai.models.embedContent with the pinned EMBEDDING_MODEL and returns
// raw float arrays. The client L2-normalizes before storing/querying. taskType
// improves retrieval quality (RETRIEVAL_DOCUMENT at index, RETRIEVAL_QUERY at
// retrieval) and is NOT a model alias — pinning stays on EMBEDDING_MODEL.
export const EmbedRequestSchema = z.object({
  texts: z.array(z.string()).min(1),
  taskType: z.enum(["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"]),
});
export type EmbedRequest = z.infer<typeof EmbedRequestSchema>;

export const EmbedResponseSchema = z.object({
  // One vector per input text, in input order. Raw (un-normalized) values.
  embeddings: z.array(z.array(z.number())),
});

// P18: flavor-generation wire contract (client → server). The context is a
// discriminated union on `kind`; the server (server/prompts/flavor.ts) builds
// the per-kind prompt from it. The scandal aggregation happens client-side
// (it needs GameState) and arrives pre-built as `eventSummaries` — the server
// never sees GameState. CharacterSchema is reused for the NpcBio context, the
// same way CharacterStateSnapshot embeds it.
export const FlavorContextSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ArtifactBackstory"),
    definitionId: z.string(),
    displayName: z.string(),
    family: z.string(),
  }),
  z.object({
    kind: z.literal("NpcBio"),
    character: CharacterSchema,
  }),
  z.object({
    kind: z.literal("ScandalColumn"),
    generationCount: z.number().int().nonnegative(),
    eventSummaries: z.array(z.string()),
  }),
]);
export type FlavorContext = z.infer<typeof FlavorContextSchema>;

export const FlavorRequestSchema = z.object({
  context: FlavorContextSchema,
});
export type FlavorRequest = z.infer<typeof FlavorRequestSchema>;

export const FlavorResponseSchema = z.object({
  text: z.string().min(1),
});

// P26: NPC-initiated opener (Q14). The NPC authors a short opening line; the
// server grounds it in the character persona (systemInstruction) + a
// contents-borne "you approach first" framing. Plain prose, no function calls
// (mirrors the flavor endpoint). approachContext distinguishes the ballroom
// approach from the drawing-room Visit for the framing.
export const OpenerRequestSchema = z.object({
  characterStateSnapshot: CharacterStateSnapshotSchema,
  history: z.array(
    z.object({
      speaker: z.enum(["house-head", "other"]),
      text: z.string(),
    }),
  ),
  approachContext: z.enum(["Ballroom", "Visit"]),
});
export type OpenerRequest = z.infer<typeof OpenerRequestSchema>;

export const OpenerResponseSchema = z.object({
  text: z.string().min(1),
});

// Widen-and-validate: enum fields parsed as z.string() so unknown values
// don't trigger SchemaError. Post-parse resolvers (resolveTactic /
// resolveMoodHint) apply the enum check + fallback per spec §7 line 664
// "clamp out-of-range fields defensively rather than erroring."
const GenerateWhisperToolCallSchema = z.object({
  name: z.literal("generateWhisper"),
  args: z.object({
    subjectCharacterId: z.string(),
    text: z.string(),
  }),
});

// P26 (G6): generateGrievance toolCall. Records that the player gave offence —
// the store mints a Conversation-source grievance against the player. `severity`
// is an optional free-text reason (unused mechanically at v1.5).
const GenerateGrievanceToolCallSchema = z.object({
  name: z.literal("generateGrievance"),
  args: z.object({
    severity: z.string().optional(),
  }),
});

// The toolCall union — the two tools the server declares (server/tools.ts).
const ToolCallSchema = z.union([GenerateWhisperToolCallSchema, GenerateGrievanceToolCallSchema]);
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ConversationResponseSchema = z.object({
  dialogue: z.string().min(1),
  classifiedTactic: z.string(),
  qualityMultiplier: z.number(),
  moodHint: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).default([]),
});

// ── P26 (G1) two-phase streaming: the classify leg ────────────────────────
// Call #1 streams the dialogue prose (no tools). Call #2 — this one — is a
// non-streaming forced-function-call that classifies the exchange. Always
// routed to MODEL_DEFAULT (Flash): classification is cheap and the Pro budget
// belongs to the streamed prose. `targetPersonaLine` is a compact client-built
// persona summary so the toolCalls surface (whisper/grievance), which two-phase
// moves OFF the persona-cached call, keeps minimal character context.
export const ClassifyRequestSchema = z.object({
  freeformMessage: z.string(),
  dialogue: z.string(),
  targetCharacterId: CharacterIdSchema,
  targetPersonaLine: z.string(),
  sceneCharacters: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  mode: z.enum(["Ballroom", "Promenade", "Visit"]).default("Ballroom"),
});
export type ClassifyRequest = z.infer<typeof ClassifyRequestSchema>;

// ConversationResponseSchema minus `dialogue` (the streamed leg supplies it).
export const ClassifyResponseSchema = z.object({
  classifiedTactic: z.string(),
  qualityMultiplier: z.number(),
  moodHint: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).default([]),
});
export type ClassifyResponseRaw = z.infer<typeof ClassifyResponseSchema>;

// SSE event frames emitted by the streaming endpoints (conversation + flavor).
export const StreamEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delta"), text: z.string() }),
  z.object({ kind: z.literal("done"), text: z.string() }),
  z.object({ kind: z.literal("error"), reason: z.enum(["timeout", "network", "internal"]) }),
]);

export type ConversationResponseRaw = z.infer<typeof ConversationResponseSchema>;

// Narrowed form — what the orchestrator returns after resolver application.
export type ConversationResponse = {
  dialogue: string;
  classifiedTactic: Tactic;
  qualityMultiplier: number; // clamped to [0.5, 1.5]
  moodHint: Mood | null;
  toolCalls: ReadonlyArray<ToolCall>;
};

// P12: widened to 5 in lockstep with TACTICS at src/game/constants.ts:140.
// Pin-always-overrides still applies — a promenade tactic pin overrides any
// model classification, regardless of whether the received string is in this
// set.
const TACTIC_SET = new Set<string>([
  "Flattery",
  "WittyBanter",
  "SlyGossip",
  "DeepEmpathy",
  "ComplimentMount",
]);

// resolveTactic: PIN ALWAYS OVERRIDES. If pinned is non-null, return pinned
// (regardless of whether received is a valid enum). If pinned is null, use
// received when it's a valid enum, else fall back to "Flattery".
//
// Spec §3 line 70: "A pinned explicit intent overrides any classification
// the language model produces." This resolver runs CLIENT-SIDE only after
// the proxy returns the raw Gemini response.
export function resolveTactic(received: string, pinned: Tactic | null): Tactic {
  if (pinned !== null) return pinned;
  if (TACTIC_SET.has(received)) return received as Tactic;
  return "Flattery";
}

const MOOD_SET = new Set<string>(MOODS);

export function resolveMoodHint(received: string | undefined): Mood | null {
  if (received === undefined) return null;
  if (MOOD_SET.has(received)) return received as Mood;
  return null;
}

// Composes resolveTactic + resolveMoodHint + qualityMultiplier clamp.
// Produces the narrowed ConversationResponse shape consumed by the
// store-action's combat resolution. Client-side ONLY.
export function narrowResponse(
  raw: ConversationResponseRaw,
  pinnedIntent: Tactic | null,
): ConversationResponse {
  const qualityMultiplier = Math.max(
    QUALITY_MULTIPLIER_FLOOR,
    Math.min(QUALITY_MULTIPLIER_CEIL, raw.qualityMultiplier),
  );
  return {
    dialogue: raw.dialogue,
    classifiedTactic: resolveTactic(raw.classifiedTactic, pinnedIntent),
    qualityMultiplier,
    moodHint: resolveMoodHint(raw.moodHint),
    toolCalls: raw.toolCalls,
  };
}

// Re-export so consumers can build BallroomMessageInput shapes without
// importing constants directly.
export type { Stance, Tactic };

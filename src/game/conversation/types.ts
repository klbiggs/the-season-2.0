// Shared conversation types — canonical home for ConversationPairKey,
// Exchange, and ConversationFailure. Both the rules layer (aging.ts
// orphan-prune) and the LLM layer (client, orchestrator) import from here
// without crossing the game-rules → llm boundary. The llm/types.ts module
// re-exports these names so llm/** consumers have a single import surface.
//
// Plan: plans/phases/04-ballroom-llm.md "ConversationPairKey shape and
// discipline" + "Canonical types table".

import { z } from "zod";
import type { CharacterId, HouseId } from "../rng";

// Branded stringified composite. Template-literal type lets the TS compiler
// narrow; the runtime form is a plain string. Lex-sort over the full
// composite string (NOT outer-by-house-then-character) is the canonical
// iteration order.
export type ConversationPairKey = `${HouseId}|${CharacterId}` & {
  readonly __brand: "ConversationPairKey";
};

export const ConversationPairKeySchema = z
  .string()
  .regex(/^[^|]+\|[^|]+$/, "ConversationPairKey must be 'houseId|characterId'")
  .transform((s) => s as ConversationPairKey);

export function makePairKey(houseId: HouseId, characterId: CharacterId): ConversationPairKey {
  // Defense-in-depth: assert neither half contains the separator. HouseId
  // and CharacterId are branded strings (`.transform`, not constrained),
  // so a future fixture rename or migration could in principle introduce
  // a `|`. The brand cast below would still succeed for malformed inputs;
  // the regex check ensures the key round-trips correctly through
  // ConversationPairKeySchema parse-then-deserialize.
  if (houseId.includes("|") || characterId.includes("|")) {
    throw new Error(
      `makePairKey: id contains "|" separator (houseId=${houseId}, characterId=${characterId})`,
    );
  }
  return `${houseId}|${characterId}` as ConversationPairKey;
}

export function parsePairKey(key: ConversationPairKey): {
  houseId: HouseId;
  characterId: CharacterId;
} {
  // The schema regex guarantees exactly one '|' separator with non-empty halves;
  // the runtime split is therefore safe without further validation.
  const [h, c] = key.split("|") as [HouseId, CharacterId];
  return { houseId: h, characterId: c };
}

// §4 line 552 wording — "house-head" / "other" keeps the term stable
// across heir-promotion (the actor character ID changes, but the speaker
// label does not).
export const ExchangeSchema = z.object({
  speaker: z.enum(["house-head", "other"]),
  text: z.string(),
  // P12: widened with "ComplimentMount" — promenade-mode-only tactic.
  // Pre-P12 saves cannot contain "ComplimentMount" entries (the value did
  // not exist), so legacy parse continues to succeed without a save-version
  // bump. Forward-compat: a hypothetical pre-P12 build trying to load a
  // post-P12 save would fail here — accepted v1 behavior (greenfield).
  classifiedTactic: z
    .enum(["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy", "ComplimentMount"])
    .nullable(),
  tick: z.number().int().nonnegative(),
});
export type Exchange = z.infer<typeof ExchangeSchema>;

// Four-reason discriminated union shared by orchestrator return type,
// event-bus payload, store-action result, and UI banner prose mapping.
// Lives here (NOT in runtime/events/conversation.ts) so game/store.ts can
// import without crossing into the runtime/events layer.
//
// P7.5: the prior `"missing-key"` variant was removed when BYOK was
// relocated to a localhost-only Node proxy. Proxy-down failures map to
// `"network"`; the browser never validates the key.
export type ConversationFailure =
  | { reason: "timeout" }
  | { reason: "network" }
  | { reason: "schema"; issues: ReadonlyArray<{ path: string; message: string }> }
  | { reason: "cancelled" };

// Re-export brand types + schemas so llm/** consumers reach them via this
// module (the llm layer is forbidden from importing game/rng directly per
// eslint rule b). CharacterId and HouseId are needed by ProxyConversationRequest
// (P7.5 wire format) + the orchestrator's public types.
export type { CharacterId, HouseId } from "../rng";
export { CharacterIdSchema, HouseIdSchema } from "../rng";

import seedrandom from "seedrandom";
import { z } from "zod";

// seedrandom@3.0.5 — exact pin. `alea` algorithm is typed as a property of the
// default export by @types/seedrandom@3.0.8; no cast needed.
const alea = seedrandom.alea;

export type HouseId = string & { readonly __brand: "HouseId" };
export type CharacterId = string & { readonly __brand: "CharacterId" };
export type MarriageId = string & { readonly __brand: "MarriageId" };
export type TraitId = string & { readonly __brand: "TraitId" };
// P4: branded session ID for ballroom sessions. Tick-derived (zero RNG
// consumption); see plans/phases/04-ballroom-llm.md "BallSessionId".
export type BallSessionId = string & { readonly __brand: "BallSessionId" };
// P5: scheme + grievance branded identifiers. SchemeId is deterministic
// (factory at fixtures/schemeIdFactory.ts: ${ownerHouseId}:${kind}:${tick}:${index}).
// GrievanceId is also deterministic, derived from the source scheme id or
// from the (perpetrator, source, tick, index) tuple for FauxPas grievances.
export type SchemeId = string & { readonly __brand: "SchemeId" };
export type GrievanceId = string & { readonly __brand: "GrievanceId" };
// P6: whisper / courier-payload / staff branded identifiers. WhisperId is
// deterministic (factory at fixtures/whisperIdFactory.ts:
// `${sourceCharacterId}:${subjectCharacterId}:${tick}:${index}`).
// CourierPayloadId is deterministic
// (`courier:${originHouseId}:${tick}:${index}`).
// StaffId is constant per BASELINE_STAFF in fixtures/staff.ts; no runtime
// factory at v1 (no "hire new staff" affordance; reserved for P15+).
export type WhisperId = string & { readonly __brand: "WhisperId" };
export type CourierPayloadId = string & { readonly __brand: "CourierPayloadId" };
export type StaffId = string & { readonly __brand: "StaffId" };
// P8: rival/patroness/duel/faction branded identifiers. PatronessId, FactionId
// are fixture-constant ids (no runtime factory). DuelId is deterministic via
// makeDuelId at fixtures/duelIdFactory.ts. FactionPairKey is a derived
// canonical lex-pair key produced by makeFactionPairKey at fixtures/factions.ts.
export type PatronessId = string & { readonly __brand: "PatronessId" };
export type FactionId = string & { readonly __brand: "FactionId" };
export type DuelId = string & { readonly __brand: "DuelId" };
export type FactionPairKey = string & { readonly __brand: "FactionPairKey" };
// P10: brands for the three new artifact-loop entities. Each lives as a
// top-level Map<Id, Entity> in GameState; ids derive deterministically via
// state-walk counters per the P6 deterministic-id pattern.
export type ArtifactInstanceId = string & { readonly __brand: "ArtifactInstanceId" };
export type ForgeryId = string & { readonly __brand: "ForgeryId" };
export type ThiefAttemptId = string & { readonly __brand: "ThiefAttemptId" };
// P11: brands for the three new sibling-rival / inherited-secret / blood-feud
// entities. SiblingRivalActorId is unique-by-construction (one actor per
// promoted sibling Character). InheritedSecretId is index-counted per
// (houseId, generation). BloodFeudId is unique per (secret, rival, surfacingTick)
// to disambiguate re-surfacing of the same secret-rival pair across generations.
export type SiblingRivalActorId = string & { readonly __brand: "SiblingRivalActorId" };
export type InheritedSecretId = string & { readonly __brand: "InheritedSecretId" };
export type BloodFeudId = string & { readonly __brand: "BloodFeudId" };
// P12: branded session ID for promenade sessions. Tick-derived (zero RNG
// consumption); see plans/phases/12-promenade.md. Mirrors BallSessionId.
export type PromenadeSessionId = string & { readonly __brand: "PromenadeSessionId" };
// P13: brand for GlobalEvent entities (state.globalEvents Map key).
// Index-counted per-kind via state-walk; see makeGlobalEventId in
// src/game/rules/globalEvents.ts.
export type GlobalEventId = string & { readonly __brand: "GlobalEventId" };

// P3 (B1 fix): PLAYER_HOUSE_ID lives here, not in rng.seeds.ts, so that
// src/game/rules/** can import it. rules → game-other is disallowed per
// eslint.config.js rule (a); rules → game-rng is allowed. rng.seeds.ts
// re-exports PLAYER_HOUSE_ID for test-side imports (boundary-exempt).
export const PLAYER_HOUSE_ID = "player" as HouseId;
// P4: society NPCs (5 baseline + Lord Blackwood as head) live under this
// placeholder house until P8 introduces rival-house affiliations.
export const INDEPENDENT_HOUSE_ID = "independent" as HouseId;

// Tick-derived deterministic session ID. Within-tick ball sessions can only
// be open at one tick, so `ball-${tick}` is unique across a save's lifetime.
// Zero RNG consumption keeps the bootstrap budget at 1 (player head only).
export function makeBallSessionId(tick: number): BallSessionId {
  return `ball-${tick}` as BallSessionId;
}

// P12: tick-derived promenade session ID. Cross-mode mutual exclusion at
// the orchestrator (single currentSession field) means BallSessionId and
// PromenadeSessionId cannot collide at the same tick — but the `promenade-`
// prefix keeps them distinct in logs / event payloads regardless.
export function makePromenadeSessionId(tick: number): PromenadeSessionId {
  return `promenade-${tick}` as PromenadeSessionId;
}

// Branded-string Zod schemas use `.transform` (not `.brand`) to match the
// existing GameStateSchema `rng` map-key form at store.ts.
export const HouseIdSchema = z.string().transform((s) => s as HouseId);
export const CharacterIdSchema = z.string().transform((s) => s as CharacterId);
export const MarriageIdSchema = z.string().transform((s) => s as MarriageId);
export const TraitIdSchema = z.string().transform((s) => s as TraitId);
// P5: brand schemas for SchemeId / GrievanceId. Mirror the existing
// `.transform` pattern so they compose into z.map(K, V) the same way the
// other branded-string maps do (state.schemes uses z.map(SchemeIdSchema, ...)
// and house.grievances arrays carry GrievanceId via id field).
export const SchemeIdSchema = z.string().transform((s) => s as SchemeId);
export const GrievanceIdSchema = z.string().transform((s) => s as GrievanceId);
// P6: brand schemas for WhisperId / CourierPayloadId / StaffId. Same
// `.transform` pattern; state.whispers / state.couriers / state.staff use
// z.map(K, V) keyed on these brands.
export const WhisperIdSchema = z.string().transform((s) => s as WhisperId);
export const CourierPayloadIdSchema = z.string().transform((s) => s as CourierPayloadId);
export const StaffIdSchema = z.string().transform((s) => s as StaffId);
// P8: brand schemas for PatronessId / FactionId / DuelId / FactionPairKey.
// Same `.transform` pattern; state.patronesses / state.factionTensions /
// state.duels use z.map(K, V) keyed on these brands.
export const PatronessIdSchema = z.string().transform((s) => s as PatronessId);
export const FactionIdSchema = z.string().transform((s) => s as FactionId);
export const DuelIdSchema = z.string().transform((s) => s as DuelId);
export const FactionPairKeySchema = z.string().transform((s) => s as FactionPairKey);
// P10: brand schemas for ArtifactInstanceId / ForgeryId / ThiefAttemptId.
// Same `.transform` pattern; state.artifactInstances / state.forgeries /
// state.thiefAttempts use z.map(K, V) keyed on these brands.
export const ArtifactInstanceIdSchema = z.string().transform((s) => s as ArtifactInstanceId);
export const ForgeryIdSchema = z.string().transform((s) => s as ForgeryId);
export const ThiefAttemptIdSchema = z.string().transform((s) => s as ThiefAttemptId);
// P11: brand schemas for SiblingRivalActorId / InheritedSecretId / BloodFeudId.
// These IDs are stored on House arrays (siblingRivals/inheritedSecrets/bloodFeuds),
// NOT top-level Maps. Same `.transform` pattern; round-trip stability is byte-exact.
export const SiblingRivalActorIdSchema = z.string().transform((s) => s as SiblingRivalActorId);
export const InheritedSecretIdSchema = z.string().transform((s) => s as InheritedSecretId);
export const BloodFeudIdSchema = z.string().transform((s) => s as BloodFeudId);
// P13: brand schema for GlobalEventId. state.globalEvents is z.map(K, V)
// keyed on this brand.
export const GlobalEventIdSchema = z.string().transform((s) => s as GlobalEventId);

export const RngStateSchema = z.object({
  seed: z.string(),
  callCount: z.number().int().nonnegative(),
});
export type RngState = z.infer<typeof RngStateSchema>;

export class RngNotRegisteredError extends Error {
  constructor(houseId: HouseId) {
    super(`RNG not registered for houseId: ${houseId}`);
    this.name = "RngNotRegisteredError";
  }
}

export class EmptyArrayError extends Error {
  constructor() {
    super("Cannot pick from an empty array");
    this.name = "EmptyArrayError";
  }
}

export function createRngState(seed: string): RngState {
  return { seed, callCount: 0 };
}

function advanceTo(rngState: RngState): () => number {
  const prng = alea(rngState.seed);
  for (let i = 0; i < rngState.callCount; i += 1) {
    prng();
  }
  return prng;
}

export function drawNext(rngState: RngState): { next: number; rngState: RngState } {
  const prng = advanceTo(rngState);
  const next = prng();
  return {
    next,
    rngState: { seed: rngState.seed, callCount: rngState.callCount + 1 },
  };
}

export function drawInt(
  rngState: RngState,
  maxExclusive: number,
): { next: number; rngState: RngState } {
  const { next, rngState: nextState } = drawNext(rngState);
  return { next: Math.floor(next * maxExclusive), rngState: nextState };
}

export function pickItem<T>(
  rngState: RngState,
  arr: readonly T[],
): { item: T; rngState: RngState } {
  if (arr.length === 0) throw new EmptyArrayError();
  const { next, rngState: nextState } = drawInt(rngState, arr.length);
  // Safe: drawInt returns [0, arr.length) and arr.length > 0
  const item = arr[next] as T;
  return { item, rngState: nextState };
}

export function getOrThrow(map: Map<HouseId, RngState>, houseId: HouseId): RngState {
  const state = map.get(houseId);
  if (state === undefined) throw new RngNotRegisteredError(houseId);
  return state;
}

// Output is lex-sorted by key. Non-negotiable: keeps hash invariant across
// Map insertion-order differences that arise from save→load round-trips.
// Generic over branded-string keys (P1: widened from HouseId-only to any
// `K extends string` so HouseId/CharacterId/MarriageId Maps all serialize via
// the same helper).
export function serializeRegistry<K extends string, V>(map: Map<K, V>): Array<[K, V]> {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function deserializeRegistry<K extends string, V>(
  array: ReadonlyArray<readonly [K, V]>,
): Map<K, V> {
  return new Map(array);
}

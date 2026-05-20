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

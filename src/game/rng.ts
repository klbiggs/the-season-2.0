import seedrandom from "seedrandom";
import { z } from "zod";

// seedrandom@3.0.5 — exact pin. `alea` algorithm is typed as a property of the
// default export by @types/seedrandom@3.0.8; no cast needed.
const alea = seedrandom.alea;

export type HouseId = string & { readonly __brand: "HouseId" };

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

// Output is lex-sorted by HouseId. Non-negotiable: keeps hash invariant across
// Map insertion-order differences that arise from save→load round-trips at P7.
export function serializeRegistry(map: Map<HouseId, RngState>): Array<[HouseId, RngState]> {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function deserializeRegistry(
  array: ReadonlyArray<readonly [HouseId, RngState]>,
): Map<HouseId, RngState> {
  return new Map(array);
}

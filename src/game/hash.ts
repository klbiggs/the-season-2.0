import { createHash } from "node:crypto";
import type { ConversationPairKey, Exchange } from "./conversation/types";
import type { Character, GameState, House, MarriageRecord, Scheme } from "./entities";
import type { CharacterId, HouseId, MarriageId, RngState, SchemeId } from "./rng";
import { serializeRegistry } from "./rng";

// Project the store state to a JSON-safe value. Each later phase that adds
// replay-relevant state extends this projection; non-replay state (UI
// selection, derived caches) is excluded. The hashable-state-extension test
// (see GameStateSchema) enforces that this keyset stays in sync with the
// schema's keys.
// House-field additions (e.g., P3's currentLocation/lastAudienceTick/etc.,
// P5's grievances) project automatically via serializeRegistry — no per-
// House-field edits needed here. Only top-level GameState additions
// (e.g., P3's `era`, P5's `schemes`) need extending this projection. The
// hashable-state-extension.test.ts trip-wire catches forgetting to add new
// GameState keys here.
export function hashableState(state: GameState): {
  tick: number;
  rng: Array<[HouseId, RngState]>;
  houses: Array<[HouseId, House]>;
  characters: Array<[CharacterId, Character]>;
  marriages: Array<[MarriageId, MarriageRecord]>;
  campaignName: string;
  era: "Earlier" | "Later";
  conversationHistory: Array<[ConversationPairKey, Exchange[]]>;
  affectionMap: Array<[ConversationPairKey, number]>;
  schemes: Array<[SchemeId, Scheme]>;
} {
  return {
    tick: state.tick,
    rng: serializeRegistry(state.rng),
    houses: serializeRegistry(state.houses),
    characters: serializeRegistry(state.characters),
    marriages: serializeRegistry(state.marriages),
    campaignName: state.campaignName,
    era: state.era,
    conversationHistory: serializeRegistry(state.conversationHistory),
    affectionMap: serializeRegistry(state.affectionMap),
    schemes: serializeRegistry(state.schemes),
  };
}

// Deterministic stringify. Contract:
// - Object keys sorted lexicographically.
// - Arrays in insertion order.
// - No whitespace.
// - `undefined` treated as omitted.
// - `NaN` / `Infinity` / `-Infinity` throw.
// - `BigInt` throws (gameplay numerics are `number` only).
// - `-0` normalized to `0`.
// `Set`/`Map` must be projected to arrays by hashableState first; this function
// rejects them to surface mis-projections loudly.
export function canonicalJSON(value: unknown): string {
  return stringify(value);
}

function stringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null"; // top-level undefined; nested handled in object/array
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return stringifyNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") {
    throw new TypeError("canonicalJSON: BigInt is forbidden; convert to number at projection time");
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => (v === undefined ? "null" : stringify(v)));
    return `[${items.join(",")}]`;
  }
  if (value instanceof Map) {
    throw new TypeError("canonicalJSON: Map must be projected to Array<[K, V]> by hashableState");
  }
  if (value instanceof Set) {
    throw new TypeError("canonicalJSON: Set must be projected to Array<T> by hashableState");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const v = obj[key];
      if (v === undefined) continue; // omit undefined per contract
      entries.push(`${JSON.stringify(key)}:${stringify(v)}`);
    }
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`canonicalJSON: unsupported value type: ${typeof value}`);
}

function stringifyNumber(n: number): string {
  if (Number.isNaN(n)) throw new TypeError("canonicalJSON: NaN is forbidden");
  if (!Number.isFinite(n)) throw new TypeError("canonicalJSON: Infinity is forbidden");
  // -0 normalization: emit "0" not "-0"; JSON.stringify(-0) already returns "0",
  // but be explicit so an future stringifier swap doesn't silently change hashes.
  if (Object.is(n, -0)) return "0";
  return JSON.stringify(n);
}

export function hashState(state: GameState): string {
  const json = canonicalJSON(hashableState(state));
  return createHash("sha256").update(json).digest("hex");
}

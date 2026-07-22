// P17 semantic-memory vector index — a Dexie SIDECAR keyed by save slot.
// NOT part of the JSON save / GameStateSchema / hashableState / replay hash
// (embedding vectors are network-derived and non-deterministic; the index is
// the conversation/LLM layer's concern, exactly like the persona cache).
//
// Entry shape per spec §4 line 561: id, embedding vector, source text, entry-
// type enum, optional (house, npc) filters, tick. Bounded by entry count with
// FIFO eviction by tick (spec §8 line 687). The pinned EMBEDDING_MODEL id is
// stored in the record metadata; a mismatch on read discards the index (no
// stale-vector cross-ranking, spec §5 pinning).

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, VECTOR_INDEX_MAX_ENTRIES } from "../game/constants";
import { vectorIndexTable } from "./dexie";

export type VectorIndexEntryType =
  | "Exchange"
  | "Whisper"
  | "Scheme"
  | "Grievance"
  | "Succession"
  | "Lore";

export type VectorIndexEntry = {
  id: string;
  vector: Float32Array;
  sourceText: string;
  entryType: VectorIndexEntryType;
  houseId: string | null;
  npcId: string | null;
  tick: number;
};

export type VectorIndexRecord = {
  slot: string;
  modelId: string;
  dimensions: number;
  entries: VectorIndexEntry[];
};

// FIFO eviction by tick: when over `max`, drop the oldest-tick entries first.
// Deterministic tiebreak (tick asc, id asc) so the keep-set is stable. Pure —
// exported for unit tests. Returns a new array (does not mutate input).
export function evictByTick(
  entries: ReadonlyArray<VectorIndexEntry>,
  max: number,
): VectorIndexEntry[] {
  if (entries.length <= max) return [...entries];
  const sorted = [...entries].sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  return sorted.slice(sorted.length - max);
}

// Per-slot write serialization: a single tick can fire 3+ indexed events
// (scheme + grievance + succession), each an async load-append-persist on the
// same slot record. Without serialization the concurrent read-modify-writes are
// last-write-wins and silently drop entries. Each slot gets a promise chain.
const slotChains = new Map<string, Promise<unknown>>();

function withSlotLock<T>(slot: string, fn: () => Promise<T>): Promise<T> {
  const prev = slotChains.get(slot) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  // Tail swallows errors so a failed op doesn't wedge the chain for the slot.
  slotChains.set(
    slot,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

// P26 (G5): raw record read — NO discard-on-mismatch. The re-embed path
// (reembedSlotIfStale) needs the stale record's metadata + sourceTexts to
// rebuild with the current provider instead of silently wiping the index.
export async function readRecordForSlot(slot: string): Promise<VectorIndexRecord | undefined> {
  return vectorIndexTable().get(slot);
}

// P26 (G5): overwrite a slot's record wholesale (used by the re-embed rebuild).
export async function putRecordForSlot(record: VectorIndexRecord): Promise<void> {
  await withSlotLock(record.slot, async () => {
    await vectorIndexTable().put(record);
  });
}

// Read entries for retrieval. Returns [] when the slot has no index OR the
// stored model id / dimensions don't match the pinned current values
// (discard-on-mismatch — the next append rebuilds with fresh metadata).
export async function readEntriesForSlot(slot: string): Promise<VectorIndexEntry[]> {
  const record = await vectorIndexTable().get(slot);
  if (record === undefined) return [];
  if (record.modelId !== EMBEDDING_MODEL || record.dimensions !== EMBEDDING_DIMENSIONS) return [];
  return record.entries;
}

// Append entries to a slot's index (serialized per slot), then FIFO-evict to
// the cap and persist. On a model/dimension mismatch the prior entries are
// discarded and the record is rebuilt with the current pinned metadata.
export async function appendEntries(
  slot: string,
  newEntries: ReadonlyArray<VectorIndexEntry>,
): Promise<void> {
  if (newEntries.length === 0) return;
  await withSlotLock(slot, async () => {
    const existing = await vectorIndexTable().get(slot);
    const base =
      existing === undefined ||
      existing.modelId !== EMBEDDING_MODEL ||
      existing.dimensions !== EMBEDDING_DIMENSIONS
        ? []
        : existing.entries;
    // Dedup by id: stable-id entries (e.g. lore "lore:<id>") must not duplicate
    // if seeded twice (concurrent init-site calls) — id collisions keep the base.
    const seen = new Set(base.map((e) => e.id));
    const additions = newEntries.filter((e) => !seen.has(e.id));
    if (additions.length === 0) return;
    const merged = evictByTick([...base, ...additions], VECTOR_INDEX_MAX_ENTRIES);
    const record: VectorIndexRecord = {
      slot,
      modelId: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      entries: merged,
    };
    await vectorIndexTable().put(record);
  });
}

// True when the slot already holds at least one Lore entry — used to make the
// one-time lore-corpus seed idempotent.
export async function hasLoreEntries(slot: string): Promise<boolean> {
  const entries = await readEntriesForSlot(slot);
  return entries.some((e) => e.entryType === "Lore");
}

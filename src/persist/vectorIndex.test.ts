import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { EMBEDDING_DIMENSIONS, VECTOR_INDEX_MAX_ENTRIES } from "../game/constants";
import { _resetForTests, vectorIndexTable } from "./dexie";
import {
  type VectorIndexEntry,
  appendEntries,
  evictByTick,
  hasLoreEntries,
  readEntriesForSlot,
} from "./vectorIndex";

const SLOT = "dev";

function makeEntry(
  id: string,
  tick: number,
  overrides: Partial<VectorIndexEntry> = {},
): VectorIndexEntry {
  return {
    id,
    vector: new Float32Array(EMBEDDING_DIMENSIONS),
    sourceText: `passage ${id}`,
    entryType: "Exchange",
    houseId: "player",
    npcId: null,
    tick,
    ...overrides,
  };
}

beforeEach(async () => {
  await _resetForTests();
});

afterEach(async () => {
  await _resetForTests();
});

describe("evictByTick (pure)", () => {
  it("keeps all when under the cap", () => {
    const entries = [makeEntry("a", 1), makeEntry("b", 2)];
    expect(evictByTick(entries, 5)).toHaveLength(2);
  });

  it("drops the oldest-tick entries when over the cap", () => {
    const entries = [makeEntry("a", 3), makeEntry("b", 1), makeEntry("c", 2)];
    const kept = evictByTick(entries, 2);
    expect(kept.map((e) => e.id).sort()).toEqual(["a", "c"]); // tick 1 ("b") evicted
  });

  it("breaks tick ties by id for determinism", () => {
    const entries = [makeEntry("z", 1), makeEntry("a", 1), makeEntry("m", 1)];
    const kept = evictByTick(entries, 2);
    // tick all equal → id asc keeps the two largest ids (m, z); "a" evicted
    expect(kept.map((e) => e.id)).toEqual(["m", "z"]);
  });
});

describe("appendEntries + readEntriesForSlot", () => {
  it("round-trips entries through IndexedDB", async () => {
    await appendEntries(SLOT, [makeEntry("a", 1), makeEntry("b", 2)]);
    const entries = await readEntriesForSlot(SLOT);
    expect(entries.map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(entries[0]?.vector).toBeInstanceOf(Float32Array);
  });

  it("accumulates across multiple appends and FIFO-evicts at the cap", async () => {
    // Append cap+10 entries with increasing ticks; the 10 oldest evict.
    const total = VECTOR_INDEX_MAX_ENTRIES + 10;
    for (let i = 0; i < total; i += 1) {
      await appendEntries(SLOT, [makeEntry(`e${i}`, i)]);
    }
    const entries = await readEntriesForSlot(SLOT);
    expect(entries).toHaveLength(VECTOR_INDEX_MAX_ENTRIES);
    const ticks = entries.map((e) => e.tick);
    expect(Math.min(...ticks)).toBe(10); // ticks 0..9 evicted
  });

  it("dedups by id (idempotent re-append, e.g. lore)", async () => {
    await appendEntries(SLOT, [makeEntry("lore:x", 0, { entryType: "Lore" })]);
    await appendEntries(SLOT, [makeEntry("lore:x", 0, { entryType: "Lore" })]);
    const entries = await readEntriesForSlot(SLOT);
    expect(entries.filter((e) => e.id === "lore:x")).toHaveLength(1);
  });

  it("serializes concurrent appends without dropping entries", async () => {
    await Promise.all([
      appendEntries(SLOT, [makeEntry("p", 1)]),
      appendEntries(SLOT, [makeEntry("q", 2)]),
      appendEntries(SLOT, [makeEntry("r", 3)]),
    ]);
    const entries = await readEntriesForSlot(SLOT);
    expect(entries.map((e) => e.id).sort()).toEqual(["p", "q", "r"]);
  });
});

describe("model-id mismatch discard", () => {
  it("readEntriesForSlot returns [] when the stored model id differs", async () => {
    await vectorIndexTable().put({
      slot: SLOT,
      modelId: "some-stale-model",
      dimensions: EMBEDDING_DIMENSIONS,
      entries: [makeEntry("old", 1)],
    });
    expect(await readEntriesForSlot(SLOT)).toEqual([]);
  });

  it("appendEntries rebuilds with the current model id after a mismatch", async () => {
    await vectorIndexTable().put({
      slot: SLOT,
      modelId: "some-stale-model",
      dimensions: EMBEDDING_DIMENSIONS,
      entries: [makeEntry("old", 1)],
    });
    await appendEntries(SLOT, [makeEntry("new", 2)]);
    const entries = await readEntriesForSlot(SLOT);
    expect(entries.map((e) => e.id)).toEqual(["new"]); // stale entries discarded
  });
});

describe("hasLoreEntries", () => {
  it("is false on an empty slot and true once lore is present", async () => {
    expect(await hasLoreEntries(SLOT)).toBe(false);
    await appendEntries(SLOT, [makeEntry("lore:a", 0, { entryType: "Lore" })]);
    expect(await hasLoreEntries(SLOT)).toBe(true);
  });
});

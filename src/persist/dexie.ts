import Dexie, { type EntityTable } from "dexie";
import type { GameState } from "../game/store";
import { type SaveV1, SaveV1Schema, toSaveV1 } from "./schema";

// Slot for dev/scaffold UI. UI components and the round-trip test reference
// this constant, not the literal "dev" string.
export const DEV_SLOT = "dev";

// Dexie schema version 1. Separate concept from save-format version: Dexie
// versions the object-store layout; save-format versions the JSON shape.
const DB_NAME = "the-season";
const DEXIE_SCHEMA_VERSION = 1;

type SaveRecord = {
  slot: string;
  data: SaveV1;
};

class SeasonDB extends Dexie {
  saves!: EntityTable<SaveRecord, "slot">;

  constructor() {
    super(DB_NAME);
    this.version(DEXIE_SCHEMA_VERSION).stores({
      saves: "slot",
    });
  }
}

let dbInstance: SeasonDB | null = null;

function db(): SeasonDB {
  if (dbInstance === null) dbInstance = new SeasonDB();
  return dbInstance;
}

export async function save(slot: string, state: GameState): Promise<void> {
  // Sync prep: toSaveV1 serializes and Zod-validates synchronously.
  const data = toSaveV1(state);
  // Async IO: structured-clone copy into IndexedDB.
  await db().saves.put({ slot, data });
}

export async function load(slot: string): Promise<SaveV1 | undefined> {
  const record = await db().saves.get(slot);
  if (record === undefined) return undefined;
  return SaveV1Schema.parse(record.data);
}

// Test-only: reset the singleton + delete the DB. Used by Vitest cleanup so
// tests don't leak state across files.
export async function _resetForTests(): Promise<void> {
  if (dbInstance !== null) {
    dbInstance.close();
    dbInstance = null;
  }
  await Dexie.delete(DB_NAME);
}

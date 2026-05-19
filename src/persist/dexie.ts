import Dexie, { type EntityTable } from "dexie";
import type { GameState } from "../game/store";
import { MIGRATIONS } from "./migrations";
import { runMigrations } from "./migrations/runner";
import { SAVE_VERSION_CURRENT, type SaveV1, type SaveV2, SaveV2Schema, toSaveV2 } from "./schema";

// Slot for dev/scaffold UI. UI components and the round-trip test reference
// this constant, not the literal "dev" string.
export const DEV_SLOT = "dev";

// Dexie schema version 1. Separate concept from save-format version: Dexie
// versions the object-store layout; save-format versions the JSON shape.
const DB_NAME = "the-season";
const DEXIE_SCHEMA_VERSION = 1;

// P1: data widens to `SaveV1 | SaveV2`. The on-disk structured-clone path
// returns whatever was written; load() is the ONLY sanctioned narrowing site
// (via `raw.version` discriminator). Other consumers must not assume the
// typed shape — route through load().
type SaveRecord = {
  slot: string;
  data: SaveV1 | SaveV2;
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
  // Sync prep: toSaveV2 serializes and Zod-validates synchronously.
  const data = toSaveV2(state);
  // Async IO: structured-clone copy into IndexedDB.
  await db().saves.put({ slot, data });
}

// Load returns SaveV2 by routing legacy SaveV1 records through runMigrations.
// Unknown-version handling: a record with `version` undefined or > current
// surfaces as MissingMigrationError from runMigrations — caller (e.g., the
// LoadButton onStatus channel) shows the error to the user. A user-friendly
// banner for corrupted/future-version saves is a P2 concern.
export async function load(slot: string): Promise<SaveV2 | undefined> {
  const record = await db().saves.get(slot);
  if (record === undefined) return undefined;
  const raw = record.data;
  if (raw.version === SAVE_VERSION_CURRENT) {
    return SaveV2Schema.parse(raw);
  }
  // Legacy version path — route through migrations.
  const migrated = runMigrations(raw, raw.version, SAVE_VERSION_CURRENT, MIGRATIONS);
  return SaveV2Schema.parse(migrated);
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

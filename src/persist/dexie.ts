import Dexie, { type EntityTable } from "dexie";
import { z } from "zod";
import type { GameState } from "../game/store";
import {
  InvalidSaveSchemaError,
  type SaveLoadError,
  SaveVersionTooNewError,
  UnknownSaveVersionError,
} from "./errors";
import { SAVE_VERSION_CURRENT, type SaveV1, SaveV1Schema, toSaveV1 } from "./schema";
import type { VectorIndexRecord } from "./vectorIndex";

// Slot for dev/scaffold UI. UI components and the round-trip test reference
// this constant, not the literal "dev" string.
export const DEV_SLOT = "dev";

// Dexie schema version. Separate concept from save-format version: Dexie
// versions the object-store layout; save-format versions the JSON shape.
// P17 bumps 1 → 2 to add the `vectorIndex` sidecar store (semantic memory).
// The save format does NOT change — the vector index is out-of-hash sidecar.
const DB_NAME = "the-season";
const DEXIE_SCHEMA_VERSION = 2;

// P19: the migration ladder is gone — only the live SaveV1 format persists.
type SaveRecord = {
  slot: string;
  data: SaveV1;
};

class SeasonDB extends Dexie {
  saves!: EntityTable<SaveRecord, "slot">;
  // P17: semantic-memory vector index, keyed by save slot. Sidecar — NOT part
  // of the JSON save / replay hash.
  vectorIndex!: EntityTable<VectorIndexRecord, "slot">;

  constructor() {
    super(DB_NAME);
    // Additive version ladder: v1 keeps the original `saves` store; v2 adds
    // `vectorIndex`. Dexie needs the full ladder to upgrade existing DBs — do
    // NOT collapse these into a single .version(2) declaration.
    this.version(1).stores({ saves: "slot" });
    this.version(DEXIE_SCHEMA_VERSION).stores({ saves: "slot", vectorIndex: "slot" });
  }
}

let dbInstance: SeasonDB | null = null;

function db(): SeasonDB {
  if (dbInstance === null) dbInstance = new SeasonDB();
  return dbInstance;
}

// P17: accessor for the vector-index sidecar table, consumed by
// src/persist/vectorIndex.ts (which owns the CRUD/eviction logic). Exported
// (not the raw db()) so vectorIndex.ts stays decoupled from the SaveRecord side.
export function vectorIndexTable(): EntityTable<VectorIndexRecord, "slot"> {
  return db().vectorIndex;
}

export async function save(slot: string, state: GameState): Promise<void> {
  // Sync prep: serializes and Zod-validates synchronously.
  const data = toSaveV1(state);
  // Async IO: structured-clone copy into IndexedDB.
  await db().saves.put({ slot, data });
}

// Load returns the single live SaveV1 format. P19 deleted the migration
// ladder, so there is no legacy-version branch. Errors are SaveLoadError
// variants:
// - InvalidSaveSchemaError: version field missing, or current-version Zod
//   validation failed
// - UnknownSaveVersionError: version non-numeric, non-integer, or < 1
// - SaveVersionTooNewError: version > SAVE_VERSION_CURRENT (e.g., a save from
//   a future build, or a pre-P19 dev save still at v2..v16)
export async function load(slot: string): Promise<SaveV1 | undefined> {
  const record = await db().saves.get(slot);
  if (record === undefined) return undefined;
  const raw = record.data as unknown;
  if (typeof raw !== "object" || raw === null || !("version" in raw)) {
    throw new InvalidSaveSchemaError([
      { path: "(root)", message: "Save record has no version field" },
    ]);
  }
  const observedVersion = (raw as { version: unknown }).version;
  if (
    typeof observedVersion !== "number" ||
    !Number.isInteger(observedVersion) ||
    observedVersion < 1
  ) {
    throw new UnknownSaveVersionError(observedVersion);
  }
  if (observedVersion > SAVE_VERSION_CURRENT) {
    throw new SaveVersionTooNewError(observedVersion, SAVE_VERSION_CURRENT);
  }
  // observedVersion === SAVE_VERSION_CURRENT (the only remaining case).
  try {
    return SaveV1Schema.parse(raw);
  } catch (cause) {
    throw asInvalidSaveSchemaError(cause);
  }
}

// Local helper, NOT exported. Converts a ZodError to InvalidSaveSchemaError;
// re-throws non-Zod errors unchanged so we don't accidentally swallow
// unrelated exceptions (e.g., Dexie internal errors).
function asInvalidSaveSchemaError(cause: unknown): SaveLoadError {
  if (cause instanceof z.ZodError) {
    return new InvalidSaveSchemaError(
      cause.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  throw cause;
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

// Test-only: write a hand-crafted record into IndexedDB. Used by Playwright
// corrupt-save tests to seed pathological data (e.g., {version: 99}) that
// the regular save() path would reject via Zod. Cast to `never` keeps the
// helper unaware of the SaveRecord union — the point is to bypass typing.
export async function _putRawForTests(slot: string, data: unknown): Promise<void> {
  await db().saves.put({ slot, data: data as never });
}

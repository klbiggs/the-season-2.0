// P17 semantic-memory orchestration. Subscribes (at module load) to the buses
// that already drive conversation history, embeds each new passage, and appends
// it to the per-slot vector-index sidecar; and exposes `retrieve` (read path)
// + `seedLoreCorpus` (one-time lore pass).
//
// DETERMINISM — the load-bearing contract:
//   The replay harness DOES invoke these subscribers (it drives advanceTick /
//   runYearPass, which fire publishSchemeTransitions /
//   publishArchetypeReclassificationsFromSuccession after `set`). What keeps
//   them inert is the EXPLICIT `semanticMemoryEnabled` flag (default false,
//   flipped true ONLY by enableSemanticMemory() from src/main.tsx) — NOT an
//   absence-of-global check (vitest stubs fetch + fake-indexeddb assigns
//   globalThis.indexedDB process-wide). The typeof fetch / indexedDB checks are
//   defense-in-depth. Every subscriber makes the flag-guard its first statement
//   and wraps the synchronous passage-build in try/catch so it can NEVER throw
//   synchronously back into bus.publish (bus.ts has no try/catch around sub()).

import {
  EMBEDDING_DIMENSIONS,
  EMBED_RETRIEVAL_TIMEOUT_MS,
  SEMANTIC_RETRIEVAL_TOP_K,
  SEMANTIC_SIMILARITY_THRESHOLD,
} from "../game/constants";
import { parsePairKey } from "../game/conversation/types";
import { LORE_CORPUS } from "../game/fixtures/lore";
import { PLAYER_HOUSE_ID } from "../game/rng";
import type { CharacterId } from "../game/rng";
import type { GameState } from "../game/store";
import { cosineSimilarity, embedTexts } from "../llm/embeddings";
import { DEV_SLOT } from "../persist/dexie";
import {
  type VectorIndexEntry,
  type VectorIndexEntryType,
  appendEntries,
  hasLoreEntries,
  readEntriesForSlot,
} from "../persist/vectorIndex";
import { conversationBus } from "./events/conversation";
import { familyBus } from "./events/family";
import { schemeBus } from "./events/scheme";
import { whisperBus } from "./events/whispers";

// ── Activation flag + slot + store accessor ──────────────────────────────

let semanticMemoryEnabled = false;
let activeSlot: string = DEV_SLOT;
let readState: (() => GameState) | null = null;

// Flipped ONLY by the browser app entry (src/main.tsx). Never called by tests
// or the replay harness, so every subscriber/retrieval/seed below early-returns.
export function enableSemanticMemory(): void {
  semanticMemoryEnabled = true;
}

// Test-only opt-in. Suites that exercise indexing/retrieval MUST reset to false
// in afterEach/finally (a left-true flag would leak into the replay-harness file
// under a future --no-isolate Vitest tweak).
export function __setSemanticMemoryEnabledForTests(enabled: boolean): void {
  semanticMemoryEnabled = enabled;
}

// Re-pointed by every replaceState/new-campaign init site (see src/main.tsx,
// SettingsMenu, CorruptSaveBanner). Defaults to DEV_SLOT — the only v1 slot.
export function setActiveSlot(slot: string): void {
  activeSlot = slot;
}

// Injected once by the store at init (avoids a store→runtime import cycle).
// Subscribers read it post-mutation to resolve passage text from ids.
export function bindStore(getState: () => GameState): void {
  readState = getState;
}

// ── Indexing (write path) ────────────────────────────────────────────────

type IndexJob = {
  entryType: VectorIndexEntryType;
  sourceText: string;
  npcId: CharacterId | null;
  tick: number;
};

let entrySeq = 0;

// Runs the synchronous passage-build inside try/catch so a throw never escapes
// back into bus.publish; then fires the async embed+append (fire-and-forget).
function index(build: () => IndexJob | null): void {
  let job: IndexJob | null;
  try {
    if (readState === null) return;
    job = build();
  } catch {
    return;
  }
  if (job === null) return;
  void embedAndAppend(job);
}

async function embedAndAppend(job: IndexJob): Promise<void> {
  if (typeof fetch !== "function" || typeof indexedDB === "undefined") return;
  try {
    const [vector] = await embedTexts(
      [job.sourceText],
      "RETRIEVAL_DOCUMENT",
      AbortSignal.timeout(EMBED_RETRIEVAL_TIMEOUT_MS),
    );
    if (vector === undefined) return;
    entrySeq += 1;
    const entry: VectorIndexEntry = {
      id: `${job.entryType}-${job.tick}-${entrySeq}`,
      vector,
      sourceText: job.sourceText,
      entryType: job.entryType,
      // Player-perspective index: indexed events are always written under the
      // player house so retrieval's `entry.houseId === queryHouseId` matches.
      houseId: PLAYER_HOUSE_ID,
      npcId: job.npcId,
      tick: job.tick,
    };
    await appendEntries(activeSlot, [entry]);
  } catch {
    // Spec §5 line 608: a failed embedding is logged and dropped (the passage
    // is simply not indexed). Game state is unaffected.
  }
}

// Exchange completion → index the just-appended player+NPC exchange pair.
conversationBus.subscribe("ConversationResolved", (event) => {
  if (!semanticMemoryEnabled) return;
  index(() => {
    const state = readState?.();
    if (state === undefined) return null;
    const { houseId, characterId } = parsePairKey(event.pairKey);
    if (houseId !== PLAYER_HOUSE_ID) return null;
    const history = state.conversationHistory.get(event.pairKey) ?? [];
    if (history.length === 0) return null;
    const npcName = state.characters.get(characterId)?.name ?? "an acquaintance";
    const lines = history
      .slice(-2)
      .map((ex) => `${ex.speaker === "house-head" ? "Player" : npcName}: ${ex.text}`);
    return {
      entryType: "Exchange",
      sourceText: `At tick ${event.tick}, a conversation with ${npcName} — ${lines.join(" / ")}`,
      npcId: characterId,
      tick: event.tick,
    };
  });
});

// Whisper publication → index the whisper text (player-destined only).
whisperBus.subscribe("WhisperCreated", (event) => {
  if (!semanticMemoryEnabled) return;
  index(() => {
    const state = readState?.();
    if (state === undefined) return null;
    if (event.destinationHouseId !== PLAYER_HOUSE_ID) return null;
    const text = state.whispers.get(event.whisperId)?.text;
    if (text === undefined) return null;
    return {
      entryType: "Whisper",
      sourceText: `A whisper (tick ${event.tick}): ${text}`,
      npcId: event.subjectCharacterId,
      tick: event.tick,
    };
  });
});

// Scheme completion → player-owned schemes. Smuggling has a null target (and no
// target name); other kinds resolve the target name.
schemeBus.subscribe("SchemeCompleted", (event) => {
  if (!semanticMemoryEnabled) return;
  index(() => {
    const state = readState?.();
    if (state === undefined) return null;
    if (event.ownerHouseId !== PLAYER_HOUSE_ID) return null;
    if (event.targetCharacterId === null) {
      return {
        entryType: "Scheme",
        sourceText: `A ${event.schemeKind} scheme completed at tick ${event.tick}`,
        npcId: null,
        tick: event.tick,
      };
    }
    const targetName = state.characters.get(event.targetCharacterId)?.name;
    if (targetName === undefined) return null;
    return {
      entryType: "Scheme",
      sourceText: `A ${event.schemeKind} scheme against ${targetName} completed at tick ${event.tick}`,
      npcId: event.targetCharacterId,
      tick: event.tick,
    };
  });
});

// Casus belli recording → grievances involving the player house.
schemeBus.subscribe("GrievanceRecorded", (event) => {
  if (!semanticMemoryEnabled) return;
  index(() => {
    const state = readState?.();
    if (state === undefined) return null;
    if (event.perpetratorHouseId !== PLAYER_HOUSE_ID && event.victimHouseId !== PLAYER_HOUSE_ID) {
      return null;
    }
    const otherHouseId =
      event.perpetratorHouseId === PLAYER_HOUSE_ID ? event.victimHouseId : event.perpetratorHouseId;
    if (state.houses.get(otherHouseId) === undefined) return null;
    return {
      entryType: "Grievance",
      sourceText: `A ${event.source} grievance involving the house "${otherHouseId}" was recorded at tick ${event.tick}`,
      npcId: null,
      tick: event.tick,
    };
  });
});

// Succession → player-house head reclassifications at succession.
familyBus.subscribe("ArchetypeReclassified", (event) => {
  if (!semanticMemoryEnabled) return;
  index(() => {
    const state = readState?.();
    if (state === undefined) return null;
    if (event.trigger !== "Succession") return null;
    const character = state.characters.get(event.characterId);
    if (character === undefined || character.houseId !== PLAYER_HOUSE_ID) return null;
    return {
      entryType: "Succession",
      sourceText: `At tick ${event.tick}, ${character.name} succeeded as head (reclassified ${event.from} → ${event.to})`,
      npcId: event.characterId,
      tick: event.tick,
    };
  });
});

// ── Retrieval (read path) ────────────────────────────────────────────────

// Embeds the player's message, ranks the slot's index (filtered by the active
// npc + the player house), and returns up to TOP_K source texts above the
// similarity threshold. Any failure → [] (spec §7 line 657: recency-only).
export async function retrieve(npcId: CharacterId, queryText: string): Promise<string[]> {
  if (!semanticMemoryEnabled) return [];
  if (typeof fetch !== "function" || typeof indexedDB === "undefined") return [];
  try {
    const [queryVector] = await embedTexts(
      [queryText],
      "RETRIEVAL_QUERY",
      AbortSignal.timeout(EMBED_RETRIEVAL_TIMEOUT_MS),
    );
    if (queryVector === undefined) return [];
    const entries = await readEntriesForSlot(activeSlot);
    // v1: queryHouseId is always the player house (everything is player-bound).
    const queryHouseId: string = PLAYER_HOUSE_ID;
    return entries
      .filter(
        (e) =>
          (e.houseId === null || e.houseId === queryHouseId) &&
          (e.npcId === null || e.npcId === npcId),
      )
      .map((e) => ({ e, score: cosineSimilarity(queryVector, e.vector) }))
      .filter((s) => s.score >= SEMANTIC_SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score || b.e.tick - a.e.tick || a.e.id.localeCompare(b.e.id))
      .slice(0, SEMANTIC_RETRIEVAL_TOP_K)
      .map((s) => s.e.sourceText);
  } catch {
    return [];
  }
}

// ── One-time lore-corpus pass ────────────────────────────────────────────

// Embeds the pre-authored lore corpus into the slot once. Idempotent: skipped
// when the slot already holds Lore entries (and appendEntries dedups by id as a
// second guard against concurrent init-site calls).
export async function seedLoreCorpus(slot: string): Promise<void> {
  if (!semanticMemoryEnabled) return;
  if (typeof fetch !== "function" || typeof indexedDB === "undefined") return;
  try {
    if (await hasLoreEntries(slot)) return;
    const texts = LORE_CORPUS.map((l) => l.text);
    const vectors = await embedTexts(
      texts,
      "RETRIEVAL_DOCUMENT",
      AbortSignal.timeout(EMBED_RETRIEVAL_TIMEOUT_MS),
    );
    const entries: VectorIndexEntry[] = [];
    for (let i = 0; i < LORE_CORPUS.length; i += 1) {
      const passage = LORE_CORPUS[i];
      const vector = vectors[i];
      if (passage === undefined || vector === undefined) continue;
      if (vector.length !== EMBEDDING_DIMENSIONS) continue;
      entries.push({
        id: `lore:${passage.id}`,
        vector,
        sourceText: passage.text,
        entryType: "Lore",
        houseId: null,
        npcId: null,
        tick: 0,
      });
    }
    await appendEntries(slot, entries);
  } catch {
    // logged + dropped — lore is best-effort context, never blocking.
  }
}

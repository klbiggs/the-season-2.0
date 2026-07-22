import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { makePairKey } from "../game/conversation/types";
import { LORE_CORPUS } from "../game/fixtures/lore";
import type { CharacterId, HouseId } from "../game/rng";
import type { GameState } from "../game/store";
import { embedTexts } from "../llm/embeddings";
import { _resetForTests } from "../persist/dexie";
import { appendEntries, readEntriesForSlot } from "../persist/vectorIndex";
import { conversationBus } from "./events/conversation";
import {
  __setSemanticMemoryEnabledForTests,
  bindStore,
  retrieve,
  seedLoreCorpus,
  setActiveSlot,
} from "./semanticIndex";

const SLOT = "dev";
const PLAYER = "player" as HouseId;
const NPC1 = "npc-1" as CharacterId;

// Minimal GameState stub — the subscribers only read conversationHistory,
// characters, whispers, houses.
function stubState(over: Partial<GameState> = {}): GameState {
  return {
    conversationHistory: new Map(),
    characters: new Map(),
    whispers: new Map(),
    houses: new Map(),
    ...over,
  } as unknown as GameState;
}

// Fire-and-forget indexing completes across several async hops; poll briefly.
async function flushUntil(predicate: () => Promise<boolean>, tries = 200): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 1));
  }
  return false;
}

beforeEach(async () => {
  await _resetForTests();
  setActiveSlot(SLOT);
  bindStore(() => stubState());
});

afterEach(async () => {
  // Teardown contract: reset the activation flag so a left-true flag can't leak
  // into other suites (load-bearing under a future --no-isolate Vitest tweak).
  __setSemanticMemoryEnabledForTests(false);
  await _resetForTests();
});

describe("activation flag (disabled by default)", () => {
  it("retrieve returns [] when disabled", async () => {
    expect(await retrieve(NPC1, "anything")).toEqual([]);
  });

  it("seedLoreCorpus is a no-op when disabled", async () => {
    await seedLoreCorpus(SLOT);
    expect(await readEntriesForSlot(SLOT)).toEqual([]);
  });

  it("a bus event indexes nothing when disabled", async () => {
    conversationBus.publish({
      kind: "ConversationResolved",
      tick: 1,
      pairKey: makePairKey(PLAYER, NPC1),
      classifiedTactic: "Flattery",
      affectionDelta: 10,
      composureDelta: 0,
      synergy: false,
      moodHint: null,
    });
    // Give any (incorrectly-firing) async work a chance, then assert nothing.
    await new Promise((r) => setTimeout(r, 20));
    expect(await readEntriesForSlot(SLOT)).toEqual([]);
  });
});

describe("retrieve (enabled)", () => {
  beforeEach(() => {
    __setSemanticMemoryEnabledForTests(true);
  });

  it("P26 (G4): cross-house filter — includes player-house + about-this-npc, excludes other-house-about-other-npc", async () => {
    const text = "the duel at dawn over a slighted honor";
    const [vector] = await embedTexts([text], "RETRIEVAL_DOCUMENT", AbortSignal.timeout(5000));
    if (vector === undefined) throw new Error("embed stub returned no vector");
    await appendEntries(SLOT, [
      {
        id: "hit",
        vector,
        sourceText: text,
        entryType: "Exchange",
        houseId: "player",
        npcId: NPC1,
        tick: 5,
      },
      // G4: a player-house memory about a DIFFERENT npc is now retrievable
      // (the player's own corpus is broadly available — no npc-filter on it).
      {
        id: "player-other-npc",
        vector,
        sourceText: "a player memory about npc-2",
        entryType: "Exchange",
        houseId: "player",
        npcId: "npc-2",
        tick: 6,
      },
      // G4: a rival-house memory ABOUT this npc is retrievable (about-self).
      {
        id: "rival-about-npc1",
        vector,
        sourceText: "gossip about npc-1 from a rival house",
        entryType: "Whisper",
        houseId: "rival-x",
        npcId: NPC1,
        tick: 7,
      },
      // G4: a rival-house memory about a DIFFERENT npc → filtered out.
      {
        id: "rival-about-npc2",
        vector,
        sourceText: "rival memory about npc-2",
        entryType: "Whisper",
        houseId: "rival-x",
        npcId: "npc-2",
        tick: 8,
      },
    ]);

    const hits = await retrieve(NPC1, text);
    expect(hits).toContain(text);
    expect(hits).toContain("a player memory about npc-2"); // player corpus
    expect(hits).toContain("gossip about npc-1 from a rival house"); // about-self
    expect(hits).not.toContain("rival memory about npc-2"); // other-house-other-npc
  });

  it("includes null-npc (lore-style) entries and excludes below-threshold ones", async () => {
    const loreText = "a general fact about the Season";
    const [loreVec] = await embedTexts([loreText], "RETRIEVAL_DOCUMENT", AbortSignal.timeout(5000));
    const [unrelatedVec] = await embedTexts(
      ["an utterly unrelated passage about canal trade tariffs"],
      "RETRIEVAL_DOCUMENT",
      AbortSignal.timeout(5000),
    );
    if (loreVec === undefined || unrelatedVec === undefined) throw new Error("no vector");
    await appendEntries(SLOT, [
      {
        id: "lore",
        vector: loreVec,
        sourceText: loreText,
        entryType: "Lore",
        houseId: null,
        npcId: null,
        tick: 0,
      },
      {
        id: "noise",
        vector: unrelatedVec,
        sourceText: "noise",
        entryType: "Exchange",
        houseId: "player",
        npcId: NPC1,
        tick: 1,
      },
    ]);

    const hits = await retrieve(NPC1, loreText);
    expect(hits).toContain(loreText); // null-npc lore is eligible
    expect(hits).not.toContain("noise"); // dissimilar → below threshold
  });
});

describe("seedLoreCorpus (enabled)", () => {
  beforeEach(() => {
    __setSemanticMemoryEnabledForTests(true);
  });

  it("seeds the full lore corpus once and is idempotent", async () => {
    await seedLoreCorpus(SLOT);
    const first = await readEntriesForSlot(SLOT);
    expect(first.filter((e) => e.entryType === "Lore")).toHaveLength(LORE_CORPUS.length);

    await seedLoreCorpus(SLOT); // second call — no duplication
    const second = await readEntriesForSlot(SLOT);
    expect(second.filter((e) => e.entryType === "Lore")).toHaveLength(LORE_CORPUS.length);
  });
});

describe("bus indexing (enabled)", () => {
  beforeEach(() => {
    __setSemanticMemoryEnabledForTests(true);
  });

  it("indexes an Exchange entry on ConversationResolved", async () => {
    const pairKey = makePairKey(PLAYER, NPC1);
    bindStore(() =>
      stubState({
        characters: new Map([[NPC1, { id: NPC1, name: "Lady Test" } as never]]),
        conversationHistory: new Map([
          [
            pairKey,
            [
              {
                speaker: "house-head",
                text: "Good evening.",
                classifiedTactic: "Flattery",
                tick: 3,
              },
              { speaker: "other", text: "And to you.", classifiedTactic: null, tick: 3 },
            ] as never,
          ],
        ]),
      }),
    );

    conversationBus.publish({
      kind: "ConversationResolved",
      tick: 3,
      pairKey,
      classifiedTactic: "Flattery",
      affectionDelta: 10,
      composureDelta: 0,
      synergy: false,
      moodHint: null,
    });

    const indexed = await flushUntil(async () => {
      const entries = await readEntriesForSlot(SLOT);
      return entries.some((e) => e.entryType === "Exchange" && e.npcId === NPC1);
    });
    expect(indexed).toBe(true);
  });
});

describe("publish-boundary safety", () => {
  it("a subscriber never throws synchronously back into bus.publish", () => {
    __setSemanticMemoryEnabledForTests(true);
    // A getState that throws would crash the publish loop if the subscriber
    // didn't wrap its synchronous build in try/catch.
    bindStore(() => {
      throw new Error("getState boom");
    });
    expect(() =>
      conversationBus.publish({
        kind: "ConversationResolved",
        tick: 1,
        pairKey: makePairKey(PLAYER, NPC1),
        classifiedTactic: "Flattery",
        affectionDelta: 0,
        composureDelta: 0,
        synergy: false,
        moodHint: null,
      }),
    ).not.toThrow();
  });
});

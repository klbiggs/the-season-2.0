// P18 flavorOrchestrator tests:
//   - ensureFlavor: flag-gated inertness, already-persisted short-circuit,
//     in-flight dedupe, success → recordFlavorText, failure → no persist.
//   - aggregateScandalEvents: window selection + nullable-tick skip.
//   - bus subscribers (bio + scandal) fire ONLY when the flag is enabled, and
//     never throw synchronously back into bus.publish.
// The flag is reset to false in afterEach (a left-true flag would leak into the
// replay-harness file under a future --no-isolate Vitest tweak).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeGameState,
  makeMarriage,
} from "../game/__test-utils__/factories";
import type { CharacterId, FlavorContentId } from "../game/rng";
import { INDEPENDENT_HOUSE_ID, PLAYER_HOUSE_ID } from "../game/rng";
import { type SeasonStore, createStore } from "../game/store";
import { familyBus } from "./events/family";
import {
  __setFlavorContentEnabledForTests,
  aggregateScandalEvents,
  ensureFlavor,
  regenerateFlavor,
  streamingFlavorTextFor,
  subscribeStreamingFlavor,
} from "./flavorOrchestrator";

const ARTIFACT_CTX = {
  kind: "ArtifactBackstory" as const,
  definitionId: "sapphires",
  displayName: "The Carrington Sapphires",
  family: "sapphires",
};

afterEach(() => {
  __setFlavorContentEnabledForTests(false);
  vi.restoreAllMocks();
});

describe("aggregateScandalEvents", () => {
  it("includes deaths in the (sinceTick, now] window and renders the name", () => {
    const dead = makeCharacter({
      id: "c-dead" as CharacterId,
      name: "Lord Mortimer",
      alive: false,
      diedAtTick: 5,
    });
    const state = makeGameState({ tick: 10, characters: makeCharactersMap([dead]) });
    const events = aggregateScandalEvents(state, 0);
    expect(events.some((e) => e.includes("Lord Mortimer") && e.includes("passed away"))).toBe(true);
  });

  it("skips a nullable tick (unresolved entry)", () => {
    const alive = makeCharacter({
      id: "c-alive" as CharacterId,
      name: "Lady Quick",
      alive: true,
      diedAtTick: null,
    });
    const state = makeGameState({ tick: 10, characters: makeCharactersMap([alive]) });
    expect(aggregateScandalEvents(state, 0)).toEqual([]);
  });

  it("excludes events at or before sinceTick (strict window)", () => {
    const dead = makeCharacter({ id: "c-d2" as CharacterId, alive: false, diedAtTick: 5 });
    const state = makeGameState({ tick: 10, characters: makeCharactersMap([dead]) });
    // sinceTick == diedAtTick → excluded (t must be strictly > sinceTick).
    expect(aggregateScandalEvents(state, 5)).toEqual([]);
  });

  it("renders a marriage in-window", () => {
    const a = makeCharacter({ id: "c-a" as CharacterId, name: "Mr Bingley" });
    const b = makeCharacter({ id: "c-b" as CharacterId, name: "Miss Bennet" });
    const marriage = makeMarriage({
      spouseAId: "c-a" as CharacterId,
      spouseBId: "c-b" as CharacterId,
      marriedAtTick: 4,
    });
    const state = makeGameState({
      tick: 10,
      characters: makeCharactersMap([a, b]),
      marriages: new Map([[marriage.id, marriage]]),
    });
    expect(aggregateScandalEvents(state, 0).some((e) => e.includes("wed"))).toBe(true);
  });
});

describe("ensureFlavor", () => {
  let store: SeasonStore;
  beforeEach(() => {
    store = createStore({ seed: "flavor-test" }); // also binds the orchestrator accessor
  });

  it("is inert when the flag is disabled (no fetch, no persist)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    __setFlavorContentEnabledForTests(false);
    const id = "artifact:sapphires" as FlavorContentId;
    ensureFlavor(id, ARTIFACT_CTX);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.getState().flavorText.has(id)).toBe(false);
  });

  it("persists generated text on success", async () => {
    __setFlavorContentEnabledForTests(true);
    const id = "artifact:sapphires" as FlavorContentId;
    ensureFlavor(id, ARTIFACT_CTX);
    await vi.waitFor(() => expect(store.getState().flavorText.has(id)).toBe(true));
    const entry = store.getState().flavorText.get(id);
    expect(entry?.kind).toBe("ArtifactBackstory");
    expect((entry?.text ?? "").length).toBeGreaterThan(0);
  });

  it("short-circuits when the id is already persisted (no fetch)", async () => {
    __setFlavorContentEnabledForTests(true);
    const id = "artifact:tiara" as FlavorContentId;
    store
      .getState()
      .recordFlavorText({ id, kind: "ArtifactBackstory", text: "preset", generatedAtTick: 0 });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    ensureFlavor(id, { ...ARTIFACT_CTX, definitionId: "tiara" });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.getState().flavorText.get(id)?.text).toBe("preset");
  });

  it("persists nothing when generation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    __setFlavorContentEnabledForTests(true);
    const id = "artifact:mount" as FlavorContentId;
    ensureFlavor(id, { ...ARTIFACT_CTX, definitionId: "mount" });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.getState().flavorText.has(id)).toBe(false);
  });
});

// ── P26 (G8) regenerate + author ─────────────────────────────────────────

describe("regenerateFlavor (G8)", () => {
  let store: SeasonStore;
  beforeEach(() => {
    store = createStore({ seed: "flavor-regen-test" });
  });

  it("is inert when the flag is disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    __setFlavorContentEnabledForTests(false);
    regenerateFlavor("artifact:sapphires" as FlavorContentId, ARTIFACT_CTX);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OVERWRITES an already-persisted entry (the ensureFlavor short-circuit is bypassed)", async () => {
    __setFlavorContentEnabledForTests(true);
    const id = "artifact:sapphires" as FlavorContentId;
    store
      .getState()
      .recordFlavorText({ id, kind: "ArtifactBackstory", text: "stale", generatedAtTick: 0 });
    regenerateFlavor(id, ARTIFACT_CTX);
    await vi.waitFor(() => expect(store.getState().flavorText.get(id)?.text).not.toBe("stale"));
    expect((store.getState().flavorText.get(id)?.text ?? "").length).toBeGreaterThan(0);
  });

  it("leaves the existing entry standing when generation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    __setFlavorContentEnabledForTests(true);
    const id = "artifact:tiara" as FlavorContentId;
    store
      .getState()
      .recordFlavorText({ id, kind: "ArtifactBackstory", text: "kept", generatedAtTick: 0 });
    regenerateFlavor(id, { ...ARTIFACT_CTX, definitionId: "tiara" });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.getState().flavorText.get(id)?.text).toBe("kept");
  });
});

describe("flavor streaming (G1)", () => {
  let store: SeasonStore;
  beforeEach(() => {
    store = createStore({ seed: "flavor-stream-test" });
  });

  function sseResponse(frames: ReadonlyArray<string>): Response {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const f of frames) controller.enqueue(enc.encode(`data: ${f}\n\n`));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  it("buffers deltas mid-flight, persists ONLY the final text, and clears the buffer", async () => {
    __setFlavorContentEnabledForTests(true);
    const id = "artifact:sapphires" as FlavorContentId;
    // The notifier fires on every delta — snapshot the buffer from there so we
    // observe it MID-flight rather than after the reader has settled.
    const seen: Array<string | undefined> = [];
    const unsubscribe = subscribeStreamingFlavor(() => seen.push(streamingFlavorTextFor(id)));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toBe("/api/llm/flavor/stream");
      return sseResponse([
        JSON.stringify({ kind: "delta", text: "A jewel " }),
        JSON.stringify({ kind: "delta", text: "of ill repute." }),
        JSON.stringify({ kind: "done", text: "A jewel of ill repute." }),
      ]);
    });

    try {
      ensureFlavor(id, ARTIFACT_CTX);
      await vi.waitFor(() => expect(store.getState().flavorText.has(id)).toBe(true));
    } finally {
      unsubscribe();
    }
    expect(store.getState().flavorText.get(id)?.text).toBe("A jewel of ill repute.");
    // Partials were buffered progressively, never persisted, cleared on settle.
    expect(seen).toContain("A jewel ");
    expect(streamingFlavorTextFor(id)).toBeUndefined();
  });

  it("falls back to the single-shot endpoint when the stream fails", async () => {
    __setFlavorContentEnabledForTests(true);
    const id = "artifact:tiara" as FlavorContentId;
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/stream")) throw new TypeError("stream route down");
      // Defer to the suite's stubbed single-shot flavor endpoint.
      return realFetch(input, init);
    });

    ensureFlavor(id, { ...ARTIFACT_CTX, definitionId: "tiara" });
    await vi.waitFor(() => expect(store.getState().flavorText.has(id)).toBe(true));
    expect(calls).toEqual(["/api/llm/flavor/stream", "/api/llm/flavor"]);
    expect(streamingFlavorTextFor(id)).toBeUndefined();
  });

  it("drops the partial when the stream fails mid-flight (no truncated persist)", async () => {
    __setFlavorContentEnabledForTests(true);
    const id = "artifact:mount" as FlavorContentId;
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/stream")) {
        return sseResponse([
          JSON.stringify({ kind: "delta", text: "Half a sen" }),
          JSON.stringify({ kind: "error", reason: "internal" }),
        ]);
      }
      return realFetch(input, init);
    });

    ensureFlavor(id, { ...ARTIFACT_CTX, definitionId: "mount" });
    await vi.waitFor(() => expect(store.getState().flavorText.has(id)).toBe(true));
    // The truncated fragment never reached the save — the fallback text did.
    expect(store.getState().flavorText.get(id)?.text).not.toBe("Half a sen");
    expect(streamingFlavorTextFor(id)).toBeUndefined();
  });
});

describe("authorFlavorText (G8)", () => {
  let store: SeasonStore;
  beforeEach(() => {
    store = createStore({ seed: "flavor-author-test" });
  });

  it("creates an entry when none exists, stamped with the current tick", () => {
    const id = "bio:someone" as FlavorContentId;
    store.getState().authorFlavorText(id, "NpcBio", "A person of no small consequence.");
    const entry = store.getState().flavorText.get(id);
    expect(entry?.text).toBe("A person of no small consequence.");
    expect(entry?.kind).toBe("NpcBio");
    expect(entry?.generatedAtTick).toBe(store.getState().tick);
  });

  it("OVERWRITES an existing entry (unlike recordFlavorText's once-only write)", () => {
    const id = "bio:someone" as FlavorContentId;
    store.getState().recordFlavorText({ id, kind: "NpcBio", text: "old", generatedAtTick: 0 });
    store.getState().recordFlavorText({ id, kind: "NpcBio", text: "ignored", generatedAtTick: 0 });
    expect(store.getState().flavorText.get(id)?.text).toBe("old");
    store.getState().authorFlavorText(id, "NpcBio", "new");
    expect(store.getState().flavorText.get(id)?.text).toBe("new");
  });

  it("trims, and rejects whitespace-only text as a no-op", () => {
    const id = "bio:someone" as FlavorContentId;
    store.getState().authorFlavorText(id, "NpcBio", "   \n  ");
    expect(store.getState().flavorText.has(id)).toBe(false);
    store.getState().authorFlavorText(id, "NpcBio", "  padded  ");
    expect(store.getState().flavorText.get(id)?.text).toBe("padded");
  });
});

describe("revealNpcBio (UI-triggered bio generation)", () => {
  let store: SeasonStore;
  beforeEach(() => {
    store = createStore({ seed: "flavor-bio-test" });
  });

  function anIndependentNpc(): CharacterId {
    const npc = [...store.getState().characters.values()].find(
      (c) => c.houseId === INDEPENDENT_HOUSE_ID && c.alive,
    );
    if (npc === undefined) throw new Error("no independent npc in bootstrap");
    return npc.id;
  }

  it("generates an NPC bio when enabled (no conversation required)", async () => {
    __setFlavorContentEnabledForTests(true);
    const npcId = anIndependentNpc();
    store.getState().revealNpcBio(npcId);
    const id = `bio:${npcId}` as FlavorContentId;
    await vi.waitFor(() => expect(store.getState().flavorText.has(id)).toBe(true));
  });

  it("is inert when disabled", async () => {
    __setFlavorContentEnabledForTests(false);
    const npcId = anIndependentNpc();
    store.getState().revealNpcBio(npcId);
    await new Promise((r) => setTimeout(r, 10));
    expect(store.getState().flavorText.has(`bio:${npcId}` as FlavorContentId)).toBe(false);
  });

  it("generates a bio for a player-house member too (P22 gate lift)", async () => {
    // P22 lifted the player-house early-return in revealNpcBio so the Family Tree
    // bio expander works for the player's own kin (FlavorContentKind unchanged).
    __setFlavorContentEnabledForTests(true);
    const player = [...store.getState().characters.values()].find(
      (c) => c.houseId === PLAYER_HOUSE_ID,
    );
    if (player === undefined) throw new Error("no player character");
    const id = `bio:${player.id}` as FlavorContentId;
    store.getState().revealNpcBio(player.id);
    await vi.waitFor(() => expect(store.getState().flavorText.has(id)).toBe(true));
  });
});

describe("scandal-column bus subscriber", () => {
  let store: SeasonStore;
  beforeEach(() => {
    store = createStore({ seed: "flavor-scandal-test" });
  });

  function anIndependentNpc(): CharacterId {
    const npc = [...store.getState().characters.values()].find(
      (c) => c.houseId === INDEPENDENT_HOUSE_ID && c.alive,
    );
    if (npc === undefined) throw new Error("no independent npc in bootstrap");
    return npc.id;
  }

  it("ArchetypeReclassified (player-house Succession) generates a scandal column", async () => {
    __setFlavorContentEnabledForTests(true);
    const head = [...store.getState().characters.values()].find(
      (c) => c.houseId === PLAYER_HOUSE_ID,
    );
    if (head === undefined) throw new Error("no player character");
    const generation = store.getState().houses.get(PLAYER_HOUSE_ID)?.generation ?? 0;
    familyBus.publish({
      kind: "ArchetypeReclassified",
      characterId: head.id,
      from: "None",
      to: "None",
      trigger: "Succession",
      tick: store.getState().tick,
    });
    const id = `scandal:${generation}` as FlavorContentId;
    await vi.waitFor(() => expect(store.getState().flavorText.has(id)).toBe(true));
  });

  it("ignores a non-player-house Succession reclassification", async () => {
    __setFlavorContentEnabledForTests(true);
    const npcId = anIndependentNpc();
    const generation = store.getState().houses.get(PLAYER_HOUSE_ID)?.generation ?? 0;
    familyBus.publish({
      kind: "ArchetypeReclassified",
      characterId: npcId,
      from: "None",
      to: "None",
      trigger: "Succession",
      tick: store.getState().tick,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(store.getState().flavorText.has(`scandal:${generation}` as FlavorContentId)).toBe(false);
  });

  it("publish does not throw when disabled (publish-boundary safety)", () => {
    __setFlavorContentEnabledForTests(false);
    const head = [...store.getState().characters.values()].find(
      (c) => c.houseId === PLAYER_HOUSE_ID,
    );
    if (head === undefined) throw new Error("no player character");
    expect(() =>
      familyBus.publish({
        kind: "ArchetypeReclassified",
        characterId: head.id,
        from: "None",
        to: "None",
        trigger: "Succession",
        tick: 0,
      }),
    ).not.toThrow();
  });
});

// P18 flavor-content orchestration. One fire-and-forget generation pipeline
// (ensureFlavor) fed by three first-encounter triggers:
//   - NPC bio       → revealNpcBio store-action (player opens the "Who is this?"
//     bio expander; calls ensureFlavor directly — see store.ts)
//   - artifact backstory → equipArtifact store-action (first equip; calls
//     ensureFlavor directly — see store.ts)
//   - scandal column → familyBus "ArchetypeReclassified" (player-house succession)
// On success, the generated text is persisted via the store's recordFlavorText
// action (read-back-verbatim thereafter); on failure, nothing is persisted and
// the designer stub keeps showing (a later encounter retries).
//
// DETERMINISM — the load-bearing contract (mirrors semanticIndex):
//   The replay harness DOES reach the bus subscribers (runYearPass fires the
//   familyBus succession publisher). What keeps them inert is the EXPLICIT
//   flavorContentEnabled flag (default false, flipped true ONLY by
//   enableFlavorContent() from src/main.tsx) — NOT an absence-of-fetch check.
//   Every entry point makes the flag-guard its first statement and wraps the
//   synchronous build in try/catch so it can NEVER throw synchronously back
//   into bus.publish (bus.ts has no try/catch around sub()). recordFlavorText
//   is only ever called from the flag-gated success path, so it never fires in
//   tests/replay and never advances the harness hash.

import { FLAVOR_REQUEST_TIMEOUT_MS } from "../game/constants";
import type { GameState } from "../game/entities";
import { resolveArtifactDefinition } from "../game/fixtures/artifacts";
import { PLAYER_HOUSE_ID } from "../game/rng";
import type { FlavorContentId } from "../game/rng";
import type { StoreState } from "../game/store";
import { fetchFlavorText } from "../llm/flavor";
import type { FlavorContext } from "../llm/types";
import { familyBus } from "./events/family";

// ── Activation flag + store accessor ──────────────────────────────────────

let flavorContentEnabled = false;
// StoreState (NOT GameState) so readState().recordFlavorText is callable —
// diverges deliberately from semanticIndex's GameState-narrowed accessor
// (which never calls an action). Type-only import, so no runtime store→runtime
// cycle.
let readState: (() => StoreState) | null = null;

// In-flight dedupe: a single tick can fire two ensureFlavor calls for the same
// id (e.g. rapid re-equip); the set drops the second until the first settles.
const inFlight = new Set<FlavorContentId>();

// Flipped ONLY by the browser app entry (src/main.tsx). Never called by tests
// or the replay harness, so every subscriber/ensureFlavor below early-returns.
export function enableFlavorContent(): void {
  flavorContentEnabled = true;
}

// Test-only opt-in. Suites that exercise generation MUST reset to false in
// afterEach/finally (a left-true flag would leak into the replay-harness file
// under a future --no-isolate Vitest tweak).
export function __setFlavorContentEnabledForTests(enabled: boolean): void {
  flavorContentEnabled = enabled;
}

// Injected once by the store at init (avoids a store→runtime import cycle).
export function bindStore(getState: () => StoreState): void {
  readState = getState;
}

// ── Generation pipeline ───────────────────────────────────────────────────

// Fire-and-forget. Idempotent: returns immediately when disabled, when the id
// is already persisted, or when a request for it is in flight. Safe to call
// from store actions and bus subscribers — the flag-guard is the first statement.
export function ensureFlavor(id: FlavorContentId, context: FlavorContext): void {
  if (!flavorContentEnabled) return;
  if (typeof fetch !== "function") return;
  const state = readState?.();
  if (state === undefined) return;
  if (state.flavorText.has(id)) return;
  if (inFlight.has(id)) return;
  inFlight.add(id);
  void generate(id, context);
}

async function generate(id: FlavorContentId, context: FlavorContext): Promise<void> {
  try {
    const text = await fetchFlavorText(context, AbortSignal.timeout(FLAVOR_REQUEST_TIMEOUT_MS));
    const store = readState?.();
    if (store === undefined) return;
    store.recordFlavorText({
      id,
      kind: context.kind,
      text,
      generatedAtTick: store.tick,
    });
  } catch {
    // Spec §3 line 269: a failed generation falls back to the designer stub.
    // Nothing is persisted; a later encounter retries.
  } finally {
    inFlight.delete(id);
  }
}

// ── Scandal-event aggregation (pure) ──────────────────────────────────────

// Walks the tick-stamped state Maps for notable events in (sinceTick, now].
// Pure: reads state, returns string summaries, no RNG, no mutation. NOT a
// gameplay rule (never imported by rules/**) — it only feeds the gossip prompt.
// NOTE: every *AtTick source field is nullable (null = unresolved/in-progress);
// inWindow() skips null so a `null < n` coercion can't include unresolved entries.
const MAX_SCANDAL_EVENTS = 15;

export function aggregateScandalEvents(state: GameState, sinceTick: number): string[] {
  const now = state.tick;
  const inWindow = (t: number | null): boolean => t !== null && t > sinceTick && t <= now;
  const name = (id: string): string =>
    state.characters.get(id as never)?.name ?? "an unknown party";
  const events: Array<{ tick: number; text: string }> = [];

  for (const scheme of state.schemes.values()) {
    if (
      (scheme.status === "Completed" || scheme.status === "Failed") &&
      inWindow(scheme.resolvedAtTick)
    ) {
      const target = scheme.targetCharacterId === null ? null : name(scheme.targetCharacterId);
      const verb = scheme.status === "Completed" ? "succeeded" : "came to nothing";
      events.push({
        tick: scheme.resolvedAtTick as number,
        text:
          target === null
            ? `a ${scheme.kind} scheme ${verb}`
            : `a ${scheme.kind} scheme against ${target} ${verb}`,
      });
    }
  }
  for (const whisper of state.whispers.values()) {
    if (whisper.status === "Weaponized" && inWindow(whisper.weaponizedAtTick)) {
      events.push({
        tick: whisper.weaponizedAtTick as number,
        text: `a damaging whisper concerning ${name(whisper.subjectCharacterId)} was made public`,
      });
    }
  }
  for (const duel of state.duels.values()) {
    if (inWindow(duel.resolvedAtTick)) {
      const fatal = duel.loserCasualty === "Killed" ? " — one party did not survive" : "";
      events.push({
        tick: duel.resolvedAtTick as number,
        text: `${name(duel.challengerCharacterId)} and ${name(duel.defenderCharacterId)} met at dawn${fatal}`,
      });
    }
  }
  for (const character of state.characters.values()) {
    if (inWindow(character.diedAtTick)) {
      events.push({ tick: character.diedAtTick as number, text: `${character.name} passed away` });
    }
  }
  for (const marriage of state.marriages.values()) {
    if (inWindow(marriage.marriedAtTick)) {
      events.push({
        tick: marriage.marriedAtTick,
        text: `${name(marriage.spouseAId)} wed ${name(marriage.spouseBId)}`,
      });
    }
    if (marriage.dissolved && inWindow(marriage.dissolvedAtTick)) {
      events.push({
        tick: marriage.dissolvedAtTick as number,
        text: `the marriage of ${name(marriage.spouseAId)} and ${name(marriage.spouseBId)} ended`,
      });
    }
  }
  for (const forgery of state.forgeries.values()) {
    if (forgery.surfaced && inWindow(forgery.surfacedAtTick)) {
      const inst = state.artifactInstances.get(forgery.forgedArtifactInstanceId);
      const defName =
        inst === undefined
          ? "an heirloom"
          : (resolveArtifactDefinition(state, inst.definitionId)?.displayName ?? inst.definitionId);
      events.push({
        tick: forgery.surfacedAtTick as number,
        text: `a forged ${defName} was exposed as counterfeit`,
      });
    }
  }
  // Blood feuds are nested per-house arrays, NOT a top-level Map — walk houses.
  for (const house of state.houses.values()) {
    for (const feud of house.bloodFeuds) {
      if (inWindow(feud.incurredAtTick)) {
        events.push({
          tick: feud.incurredAtTick,
          text: `a blood feud was declared against the house "${feud.offendingHouseId}"`,
        });
      }
    }
  }

  return events
    .sort((a, b) => a.tick - b.tick)
    .slice(0, MAX_SCANDAL_EVENTS)
    .map((e) => e.text);
}

// ── Triggers ──────────────────────────────────────────────────────────────

// Trigger 1 — NPC bio is UI-triggered (NOT bus-driven): the store's
// `revealNpcBio` action calls `ensureFlavor` when the player opens an NPC's
// "Who is this?" bio expander. Generating on that deliberate reveal (rather
// than gating behind a full conversation round-trip) means the bio is there
// when the player asks who someone is, and scopes generation to NPCs they
// actually inspect. See store.ts:revealNpcBio.

// Trigger 3 — scandal column on player-house head succession. The event carries
// only characterId (no houseId) and the publisher iterates ALL characters
// (rivals/Independent included), so the player-house resolution is correctness-
// critical: a rival succession would otherwise mint a column keyed under the
// player's generation.
familyBus.subscribe("ArchetypeReclassified", (event) => {
  if (!flavorContentEnabled) return;
  try {
    if (event.trigger !== "Succession") return;
    const state = readState?.();
    if (state === undefined) return;
    const character = state.characters.get(event.characterId);
    if (character === undefined || character.houseId !== PLAYER_HOUSE_ID) return;
    const generationCount = state.houses.get(PLAYER_HOUSE_ID)?.generation ?? 0;
    const id = `scandal:${generationCount}` as FlavorContentId;
    if (state.flavorText.has(id)) return;
    // Window = (priorColumnTick, now]. priorColumnTick = newest existing column.
    let priorTick = 0;
    for (const entry of state.flavorText.values()) {
      if (entry.kind === "ScandalColumn" && entry.generatedAtTick > priorTick) {
        priorTick = entry.generatedAtTick;
      }
    }
    ensureFlavor(id, {
      kind: "ScandalColumn",
      generationCount,
      eventSummaries: aggregateScandalEvents(state, priorTick),
    });
  } catch {
    // Never throw synchronously back into bus.publish.
  }
});

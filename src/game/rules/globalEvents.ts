// P13: applyGlobalEventPhase — slot 6 of the tick orchestrator chain.
//
// Composition: era-flip → active-event tick effects → expiry → trigger roll
// (load-bearing ordering; see in-body rationale on each sub-step).
//
// Per CLAUDE.md "Designer constants in one place" non-negotiable: the per-kind
// identity register `GLOBAL_EVENT_KINDS` lives here (rule-module local) since
// it's both type-providing AND consumed in switch statements within this
// module. NUMERIC tunings (durations, deltas, probability basis points) live
// in src/game/constants.ts.

import {
  COURIER_RESEARCH_WEALTH_COST,
  ERA_TRANSITION_TICK,
  GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS,
  MARKET_CRASH_DURATION_TICKS,
  MARKET_CRASH_WEALTH_PER_TICK,
  MONARCHS_MOOD_DURATION_TICKS,
  MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK,
  MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK,
  WAR_EFFORT_DURATION_TICKS,
  WAR_EFFORT_OFFICER_DEATH_PROBABILITY_BASIS_POINTS,
  WAR_EFFORT_REPUTATION_PER_TICK,
  WAR_EFFORT_WEALTH_PER_TICK,
} from "../constants";
import type { GameState, GlobalEvent, House } from "../entities";
import { ARTIFACT_FAMILIES, ARTIFACT_REGISTRY, type ArtifactFamily } from "../fixtures/artifacts";
import {
  type CharacterId,
  type GlobalEventId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type TraitId,
  drawInt,
  drawNext,
  getOrThrow,
} from "../rng";
import { clamp } from "../util/clamp";
import { pruneOrphanedConversationKeys } from "./aging";

// ── Identity register ────────────────────────────────────────────────────

export const GLOBAL_EVENT_KINDS = ["WarEffort", "MarketCrash", "MonarchsMood"] as const;
export type GlobalEventKind = (typeof GLOBAL_EVENT_KINDS)[number];

if (GLOBAL_EVENT_KINDS.length !== 3) {
  throw new Error(
    `GLOBAL_EVENT_KINDS length changed (${GLOBAL_EVENT_KINDS.length} !== 3) without phase plan + (where needed) save-version bump`,
  );
}

// Strict-TS-friendly cast of the trait literal. Per CLAUDE.md
// "wired-but-inert at v1" pin — no bootstrap-seeded officers exist; tests
// MUST seed officer-tagged characters via fixture literal to exercise the
// dormant branches.
const MILITARY_OFFICER: TraitId = "MilitaryOfficer" as TraitId;

// ── Deterministic ID factory ─────────────────────────────────────────────

// Per-kind index walker. Walks state.globalEvents.values() for the highest
// existing index of this kind; returns `globalevent-{kind}-{maxIdx + 1}`.
// Per-kind indexing means duplicate-kind skips (which never spawn) don't
// perturb other-kind indices. Pure function of state.
export function makeGlobalEventId(state: GameState, kind: GlobalEventKind): GlobalEventId {
  const prefix = `globalevent-${kind}-`;
  let maxIdx = -1;
  for (const e of state.globalEvents.values()) {
    if (e.kind !== kind) continue;
    const tail = e.id.slice(prefix.length);
    const idx = Number.parseInt(tail, 10);
    if (!Number.isFinite(idx)) {
      throw new Error(`makeGlobalEventId: malformed id "${e.id}" for kind ${kind}`);
    }
    if (idx > maxIdx) maxIdx = idx;
  }
  return `${prefix}${maxIdx + 1}` as GlobalEventId;
}

// ── Phase entry point ────────────────────────────────────────────────────

// Composes era-flip → per-tick effects of active events → expiry → 5%/tick
// trigger roll. Order is load-bearing:
//   1. Era flip MUST come first as defensive forward-compat — future phases
//      that read state.era from post-slot-6 phases see the flipped value
//      this tick. No current post-slot-6 phase reads state.era.
//   2. Active-event effects run BEFORE expiry so the <= expire predicate
//      drops events on tick === endTick AFTER the final effect application.
//      Worked example for WarEffort spawned at tick=100 (endTick=110): fires
//      effects at ticks 101-110 inclusive (10 applications), expires at
//      tick=110 after the 10th apply.
//   3. Trigger roll runs LAST so a newly-spawned event does NOT apply its
//      first-tick effects on the spawn tick (effects begin next tick).
//      Without this, same-tick spawn-and-apply would double-count tick 1.
export function applyGlobalEventPhase(state: GameState): GameState {
  let acc = maybeFlipEra(state);
  acc = applyActiveEventTickEffects(acc);
  acc = expireFinishedEvents(acc);
  acc = maybeFireNewEvent(acc);
  return acc;
}

// ── Era transition (one-shot at threshold) ──────────────────────────────

function maybeFlipEra(state: GameState): GameState {
  if (state.era === "Earlier" && state.tick >= ERA_TRANSITION_TICK) {
    return { ...state, era: "Later" };
  }
  return state;
}

// ── Per-tick effects of active events ───────────────────────────────────

function applyActiveEventTickEffects(state: GameState): GameState {
  // Iterate events in lex-sorted id order so determinism holds across
  // arbitrary insertion sequences. Max 3 active events at v1 (one per kind);
  // ids prefixed `globalevent-{kind}-{idx}` so MarketCrash sorts first
  // alphabetically.
  const sortedEvents = [...state.globalEvents.values()].sort((a, b) => a.id.localeCompare(b.id));
  let acc = state;
  for (const event of sortedEvents) {
    switch (event.kind) {
      case "WarEffort":
        acc = applyWarEffortTick(acc);
        break;
      case "MarketCrash":
        acc = applyMarketCrashTick(acc);
        break;
      case "MonarchsMood":
        acc = applyMonarchsMoodTick(acc, event.favoredFamily);
        break;
    }
  }
  return acc;
}

// WarEffort per-tick: +1 rep / -2 wealth on EVERY house (player + rivals +
// Independent), then per-officer death roll. Reputation clamped at mutation
// site per CLAUDE.md "Clamp at every mutation site" non-negotiable.
// Wealth is INTENTIONALLY UNCLAMPED — matches the economy.ts:60 precedent
// (bankruptcy tier "Ruined" requires wealth <= -500; clamping at a min
// would mask the tier transition).
//
// NOTE: RIVAL_HOUSE_IDS_SET intentionally NOT consulted — rivals participate
// in macro-economic pressure (per the user-resolved P13 design decision
// "all houses get hit"). Future refactor should NOT add a rival-skip gate
// here without revising the design decision.
function applyWarEffortTick(state: GameState): GameState {
  // House-wide deltas first (no RNG).
  const newHouses = new Map<HouseId, House>();
  for (const [id, h] of state.houses) {
    newHouses.set(id, {
      ...h,
      reputation: clamp(h.reputation + WAR_EFFORT_REPUTATION_PER_TICK, 0, 100),
      wealth: h.wealth + WAR_EFFORT_WEALTH_PER_TICK, // UNCLAMPED — see header note
    });
  }
  let acc: GameState = { ...state, houses: newHouses };

  // Officer death roll. Lex-sorted (houseId outer, characterId inner) per
  // CLAUDE.md "Lex-sort iteration over identifier Maps" non-negotiable.
  // Single rng stream (PLAYER_HOUSE_ID — campaign-wide stream same as
  // forgery surfacing / thief notice / global-event trigger). Rationale:
  // cross-house officer death uses the player stream so a future per-house
  // refactor surfaces as a save-migration concern (rng callCount divergence).
  const sortedHouseIds = [...acc.houses.keys()].sort((a, b) => a.localeCompare(b));
  let nextRng = getOrThrow(acc.rng, PLAYER_HOUSE_ID);
  const newlyDead = new Set<CharacterId>();
  for (const houseId of sortedHouseIds) {
    const charIdsInHouse = [...acc.characters.values()]
      .filter((c) => c.houseId === houseId && c.alive && c.traits.includes(MILITARY_OFFICER))
      .map((c) => c.id)
      .sort((a, b) => a.localeCompare(b));
    for (const charId of charIdsInHouse) {
      const { next: roll, rngState: r } = drawNext(nextRng);
      nextRng = r;
      if (Math.floor(roll * 10000) < WAR_EFFORT_OFFICER_DEATH_PROBABILITY_BASIS_POINTS) {
        newlyDead.add(charId);
      }
    }
  }
  acc = { ...acc, rng: new Map(acc.rng).set(PLAYER_HOUSE_ID, nextRng) };

  if (newlyDead.size === 0) {
    return acc; // RNG advanced (per-officer rolls always burn), no deaths
  }

  // Flip alive=false then route through the canonical death-cascade helper.
  // Per CLAUDE.md "Every caller of pruneOrphanedConversationKeys MUST flip
  // Character.alive = false BEFORE invoking" pin.
  const newChars = new Map(acc.characters);
  for (const id of newlyDead) {
    const c = newChars.get(id);
    if (c === undefined) continue; // unreachable — id came from the iteration above
    newChars.set(id, { ...c, alive: false });
  }
  return pruneOrphanedConversationKeys({ ...acc, characters: newChars }, newlyDead);
}

// MarketCrash per-tick: -3 wealth on EVERY house. No RNG. No deaths.
// Wealth UNCLAMPED per the WarEffort header note.
// NOTE: RIVAL_HOUSE_IDS_SET intentionally NOT consulted (same rationale as
// applyWarEffortTick — rivals participate in macro-economic pressure).
function applyMarketCrashTick(state: GameState): GameState {
  const newHouses = new Map<HouseId, House>();
  for (const [id, h] of state.houses) {
    newHouses.set(id, {
      ...h,
      wealth: h.wealth + MARKET_CRASH_WEALTH_PER_TICK, // UNCLAMPED
    });
  }
  return { ...state, houses: newHouses };
}

// MonarchsMood per-tick: per-house, check if any alive character equips an
// artifact whose family matches favoredFamily. Match → +2 rep surge; no
// match → +1 scandal. Per §7 line 658 pin, no-match branch is +1 scandal
// ONLY (no doubling, no negative-surge branch). No RNG.
//
// NOTE: RIVAL_HOUSE_IDS_SET intentionally NOT consulted — rivals ship with
// equippedArtifactIds: [] (fixtures/rivals.ts) at v1, so they hit the snub
// branch on every tick of every MonarchsMood. Intentional macro-pressure pin
// per design decision (rivals carry +1 scandal/tick pressure same as player).
// Out-of-scope for P13: a rival-only artifact bootstrap path; intent revisit
// at v1.5 if rivals become too brittle.
function applyMonarchsMoodTick(state: GameState, favoredFamily: ArtifactFamily): GameState {
  const newHouses = new Map<HouseId, House>();
  for (const [houseId, h] of state.houses) {
    if (houseHasFamilyEquipped(state, houseId, favoredFamily)) {
      newHouses.set(houseId, {
        ...h,
        reputation: clamp(
          h.reputation + MONARCHS_MOOD_FAVORED_FAMILY_REPUTATION_SURGE_PER_TICK,
          0,
          100,
        ),
      });
    } else {
      newHouses.set(houseId, {
        ...h,
        scandal: clamp(h.scandal + MONARCHS_MOOD_SNUB_SCANDAL_PER_TICK, 0, 100),
      });
    }
  }
  return { ...state, houses: newHouses };
}

// Read-side projection. Iterates alive characters in the house and returns
// true on the first equipped artifact whose definition.family matches.
// Pure; no state mutation; no RNG.
export function houseHasFamilyEquipped(
  state: GameState,
  houseId: HouseId,
  family: ArtifactFamily,
): boolean {
  for (const c of state.characters.values()) {
    if (c.houseId !== houseId) continue;
    if (!c.alive) continue;
    for (const instId of c.equippedArtifactIds) {
      const inst = state.artifactInstances.get(instId);
      if (inst === undefined) continue;
      const def = ARTIFACT_REGISTRY.get(inst.definitionId);
      if (def === undefined) continue;
      if (def.family === family) return true;
    }
  }
  return false;
}

// ── Expiry ──────────────────────────────────────────────────────────────

// Events whose endTick is <= state.tick are dropped (drop predicate uses
// <=, NOT <). Combined with the apply-before-expire ordering above, this
// yields EXACTLY DURATION_TICKS effect applications per event.
//
// Worked example: WarEffort spawned at tick=100 with endTick=100+10=110.
//   - Tick 100: trigger-roll spawns LAST in slot 6; no effects this tick.
//   - Tick 101: active-effects applies (#1). Expire: 110 <= 101 → false → keep.
//   - ...
//   - Tick 110: active-effects applies (#10). Expire: 110 <= 110 → TRUE → drop.
//   - Tick 111: event no longer in Map; no apply.
//   - Total: 10 effect applications across ticks 101-110.
function expireFinishedEvents(state: GameState): GameState {
  let changed = false;
  const newEvents = new Map<GlobalEventId, GlobalEvent>();
  for (const [id, e] of state.globalEvents) {
    if (e.endTick <= state.tick) {
      changed = true;
      continue;
    }
    newEvents.set(id, e);
  }
  return changed ? { ...state, globalEvents: newEvents } : state;
}

// ── Trigger roll (5%/tick) ──────────────────────────────────────────────

// Per CLAUDE.md "Cooldown burns on ALL outcomes (P8)" — the trigger roll
// burns ONE player-rng draw EVERY single tick regardless of outcome. This
// is the only per-tick UNCONDITIONAL draw in the game (P10 forgery/thief
// rolls are conditional on registry-entry existence).
function maybeFireNewEvent(state: GameState): GameState {
  const playerRng = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  const { next: triggerRoll, rngState: r1 } = drawNext(playerRng);

  // No-event path: commit the trigger-roll draw and return.
  if (Math.floor(triggerRoll * 10000) >= GLOBAL_EVENT_TRIGGER_PROBABILITY_BASIS_POINTS) {
    return { ...state, rng: new Map(state.rng).set(PLAYER_HOUSE_ID, r1) };
  }

  // Pick event kind (uniform across GLOBAL_EVENT_KINDS — 3 entries).
  const { next: kindIdx, rngState: r2 } = drawInt(r1, GLOBAL_EVENT_KINDS.length);
  const candidateKind = GLOBAL_EVENT_KINDS[kindIdx];
  if (candidateKind === undefined) {
    // ts noUncheckedIndexedAccess defense — unreachable.
    throw new Error(`maybeFireNewEvent: drawInt returned out-of-range index ${kindIdx}`);
  }

  // Duplicate-type skip per spec line 388. Burns the kind-pick draw but
  // NOT a favored-family draw (the favored-family roll is gated on a
  // successful spawn — otherwise idle MonarchsMood-blocked ticks would
  // silently advance the rng more than active ticks).
  const alreadyActive = [...state.globalEvents.values()].some((e) => e.kind === candidateKind);
  if (alreadyActive) {
    return { ...state, rng: new Map(state.rng).set(PLAYER_HOUSE_ID, r2) };
  }

  // Mint the event. MonarchsMood needs a third draw for favored-family.
  let event: GlobalEvent;
  let finalRng = r2;
  if (candidateKind === "MonarchsMood") {
    const { next: famIdx, rngState: r3 } = drawInt(r2, ARTIFACT_FAMILIES.length);
    finalRng = r3;
    const favoredFamily = ARTIFACT_FAMILIES[famIdx];
    if (favoredFamily === undefined) {
      throw new Error(`maybeFireNewEvent: drawInt returned out-of-range family index ${famIdx}`);
    }
    event = {
      kind: "MonarchsMood",
      id: makeGlobalEventId(state, "MonarchsMood"),
      startTick: state.tick,
      endTick: state.tick + MONARCHS_MOOD_DURATION_TICKS,
      favoredFamily,
    };
  } else if (candidateKind === "WarEffort") {
    event = {
      kind: "WarEffort",
      id: makeGlobalEventId(state, "WarEffort"),
      startTick: state.tick,
      endTick: state.tick + WAR_EFFORT_DURATION_TICKS,
    };
  } else {
    // MarketCrash
    event = {
      kind: "MarketCrash",
      id: makeGlobalEventId(state, "MarketCrash"),
      startTick: state.tick,
      endTick: state.tick + MARKET_CRASH_DURATION_TICKS,
    };
  }

  const newEvents = new Map(state.globalEvents);
  newEvents.set(event.id, event);
  return {
    ...state,
    globalEvents: newEvents,
    rng: new Map(state.rng).set(PLAYER_HOUSE_ID, finalRng),
  };
}

// ── Courier-research action (pure rule, called from store wrapper) ──────

export type ResearchFastCouriersRejection =
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }
  | { kind: "EraNotYetLater" }
  | { kind: "AlreadyResearched" }
  | { kind: "InsufficientWealth"; have: number; need: number };

// Free-action pure rule (no tick advance). Caller (store wrapper) composes
// the rejection check + overwriteFromGameState + direct-publish.
export function applyResearchFastCouriers(
  state: GameState,
): { ok: true; nextState: GameState } | { ok: false; reason: ResearchFastCouriersRejection } {
  const player = state.houses.get(PLAYER_HOUSE_ID);
  if (player === undefined || player.exiled) {
    return { ok: false, reason: { kind: "PlayerExiled" } };
  }
  if (state.elopement !== null) {
    return { ok: false, reason: { kind: "ElopementInProgress" } };
  }
  if (state.era !== "Later") {
    return { ok: false, reason: { kind: "EraNotYetLater" } };
  }
  if (player.courierResearchEarned) {
    return { ok: false, reason: { kind: "AlreadyResearched" } };
  }
  if (player.wealth < COURIER_RESEARCH_WEALTH_COST) {
    return {
      ok: false,
      reason: {
        kind: "InsufficientWealth",
        have: player.wealth,
        need: COURIER_RESEARCH_WEALTH_COST,
      },
    };
  }
  // Deduct wealth + flip the latch. Per CLAUDE.md "Action gating is atomic"
  // — validation above, deduction here, no partial paths.
  // Wealth UNCLAMPED — the InsufficientWealth precondition above guarantees
  // player.wealth >= COURIER_RESEARCH_WEALTH_COST, so the subtraction is
  // always >= 0. No upper bound (HouseSchema wealth is unbounded).
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...player,
    wealth: player.wealth - COURIER_RESEARCH_WEALTH_COST,
    courierResearchEarned: true,
  });
  return { ok: true, nextState: { ...state, houses: newHouses } };
}

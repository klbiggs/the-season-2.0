// P12 Hyde Park Promenade rules layer. Pure functions; no imports from UI,
// persistence, LLM, runtime, or events. Spec §3 "Hyde Park Daytime Promenade"
// (lines 192-198) + "Hyde Park Promenade" (lines 444-450).
//
// Five exported entry points:
//   eligiblePromenadePartners — lex-sorted partner pool projection
//   pickPromenadePartners      — deterministic k-draw multi-partner scene pick
//   canEnterPromenade          — pure entry-gate validator
//   resolvePromenadeCombat     — pure combat resolver (NO faux-pas, NO composure)
//   appendPromenadeExchange    — pure history + affection-map writer
//
// Plus read-side helpers:
//   playerHeadEquipsMountFamily — player-head mount-family equip check
//   characterEquipsMountFamily  — generic character mount-family equip check
//   narrowToPromenadeTactic     — narrowing helper for store-side cast safety

import {
  BALLROOM_APPROACH_PROBABILITY_BASIS_POINTS,
  COMBAT_BONUS_VALUE,
  CONVERSATION_TRAIT_BONUSES,
  PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT,
  PROMENADE_BASE_AFFECTION_DEEP_EMPATHY,
  PROMENADE_BASE_AFFECTION_WITTY_BANTER,
  PROMENADE_PARTNER_COUNT_MAX,
  PROMENADE_PLAYER_MOUNT_MINGLE_BONUS,
  QUALITY_MULTIPLIER_CEIL,
  QUALITY_MULTIPLIER_FLOOR,
  type Stance,
  TACTIC_BONUS_MOOD,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { GameState } from "../entities";
// MOUNT_FAMILY narrows "mount" to the typed ArtifactFamily literal —
// single source of truth shared with src/game/bootstrap.ts's
// bootstrapNpcMountFamily helper (which imports MOUNT_FAMILY from here).
import { type ArtifactFamily, resolveArtifactDefinition } from "../fixtures/artifacts";
import type { LocationId } from "../fixtures/locations";
import type { Mood } from "../fixtures/moods";
import { RIVAL_CHARACTER_IDS_SET, RIVAL_HOUSE_IDS_SET, isSocietyHouse } from "../fixtures/rivals";
import {
  type ArtifactInstanceId,
  type CharacterId,
  PLAYER_HOUSE_ID,
  type TraitId,
  drawInt,
  drawNext,
  getOrThrow,
} from "../rng";
import { clamp } from "../util/clamp";
import { hasActivePlayerElopement } from "./elopement";

// ── Typed mount-family literal (shared cross-module) ─────────────────────

// Exported so bootstrap.ts:bootstrapNpcMountFamily shares the single source
// of truth (no parallel literal in the bootstrap helper). The cross-tree
// edge bootstrap.ts → rules/promenade.ts is permitted by the boundaries
// config — bootstrap is the store-layer composer, not a rules module, so
// the pure-rule import restriction doesn't apply in this direction.
export const MOUNT_FAMILY: ArtifactFamily = "mount";

// ── Rejection unions ─────────────────────────────────────────────────────

export type PromenadeEntryRejection =
  | { kind: "WrongLocation"; current: LocationId }
  | { kind: "NoEligiblePartner" } // empty partner pool (rare; e.g., every NPC dead)
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }
  | { kind: "SessionAlreadyOpen" }; // ballroom OR promenade already open

// ── Deterministic partner picker ─────────────────────────────────────────

// Returns the eligible partner pool in lex-sorted CharacterId order. Pool =
// all living non-player non-rival characters. Rivals are excluded via
// RIVAL_CHARACTER_IDS_SET (cycle-aware: future v1.5 rival widenings
// automatically narrow the pool). Children (pre-adult) ARE included —
// matches ballroom's otherCharactersInScene composition.
export function eligiblePromenadePartners(state: GameState): ReadonlyArray<CharacterId> {
  return [...state.characters.values()]
    .filter((c) => c.alive && c.houseId !== PLAYER_HOUSE_ID && !RIVAL_CHARACTER_IDS_SET.has(c.id))
    .map((c) => c.id)
    .sort((a, b) => a.localeCompare(b));
}

// P26: the ballroom roster as a PURE, lex-sorted CharacterId projection — the
// valid draw pool for the NPC ballroom-approach roll (Q14). Alive society-house
// NPCs (INDEPENDENT + minted soc-house-<n>) PLUS alive rival-house characters,
// excluded by house class (mirrors BallroomView's visible ring). Deliberately
// DIFFERS from the calling-card caller pool (eligiblePromenadePartners —
// character-id rival exclusion, adults only): the ballroom approach draws from
// who is physically at the ball; the calling card is a social call. The UI ring
// (BallroomView) consumes THIS projection so the visible ring and the draw pool
// are the same set by construction. NOTE the ballroom itself has no location
// filter here — entry is already gated to Capital by enterBallroom.
//
// RIVALS ADDED at the P25<-P26 merge. P26 wrote this projection excluding rivals
// ("non-conversable until P25") while P25 shipped exactly that widening in a
// parallel worktree. Widening HERE rather than in the view is load-bearing: the
// ring and the draw pool must stay the same set, or rivals would render on
// screen yet never be drawn to approach. This CHANGES the drawInt range for
// rollBallroomApproach → replay re-baseline (pre-release, deliberate).
export function ballroomRoster(state: GameState): ReadonlyArray<CharacterId> {
  return [...state.characters.values()]
    .filter((c) => c.alive && (isSocietyHouse(c.houseId) || RIVAL_HOUSE_IDS_SET.has(c.houseId)))
    .map((c) => c.id)
    .sort((a, b) => a.localeCompare(b));
}

// P26 (H3): multi-NPC promenade scene. Draws up to PROMENADE_PARTNER_COUNT_MAX
// DISTINCT partners WITHOUT replacement: for i in 0..k-1, drawInt over the
// SHRINKING range [0, pool.length - i) then splice the pick out of the working
// pool. Exactly k draws on the player stream (k = min(MAX, pool.length)); ZERO
// draws on an empty pool. The shrinking per-draw range is what fixes the rng
// trajectory — the store test pins the exact draw count.
export function pickPromenadePartners(state: GameState): {
  partnerIds: ReadonlyArray<CharacterId>;
  nextState: GameState;
} {
  const pool = [...eligiblePromenadePartners(state)];
  if (pool.length === 0) {
    // Empty pool: surface rejection without burning RNG.
    return { partnerIds: [], nextState: state };
  }
  const k = Math.min(PROMENADE_PARTNER_COUNT_MAX, pool.length);
  let rng = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  const picked: CharacterId[] = [];
  for (let i = 0; i < k; i += 1) {
    const { next: idx, rngState } = drawInt(rng, pool.length);
    rng = rngState;
    const [id] = pool.splice(idx, 1);
    if (id !== undefined) picked.push(id);
  }
  const newRng = new Map(state.rng);
  newRng.set(PLAYER_HOUSE_ID, rng);
  return { partnerIds: picked, nextState: { ...state, rng: newRng } };
}

// P26 (Q14 ballroom-approach shape): on a NEW ballroom entry, roll whether an
// NPC approaches the player first + which one. Consumes ONE player-rng trigger
// draw ALWAYS (committed), plus one approacher-pick draw ONLY on a hit with a
// non-empty roster. Pure — the caller (enterBallroom) commits nextState.rng.
export function rollBallroomApproach(state: GameState): {
  nextState: GameState;
  approachingCharacterId: CharacterId | null;
} {
  const playerRng = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  const { next: triggerRoll, rngState: r1 } = drawNext(playerRng);
  const commit = (rng: typeof r1): GameState => ({
    ...state,
    rng: new Map(state.rng).set(PLAYER_HOUSE_ID, rng),
  });
  if (Math.floor(triggerRoll * 10000) >= BALLROOM_APPROACH_PROBABILITY_BASIS_POINTS) {
    return { nextState: commit(r1), approachingCharacterId: null };
  }
  const roster = ballroomRoster(state);
  if (roster.length === 0) {
    return { nextState: commit(r1), approachingCharacterId: null };
  }
  const { next: idx, rngState: r2 } = drawInt(r1, roster.length);
  return { nextState: commit(r2), approachingCharacterId: roster[idx] ?? null };
}

// ── Entry gate (validation only — caller advances rng + opens session) ──

export function canEnterPromenade(
  state: GameState,
): { ok: true } | { ok: false; reason: PromenadeEntryRejection } {
  const player = state.houses.get(PLAYER_HOUSE_ID);
  if (player === undefined) {
    return { ok: false, reason: { kind: "PlayerExiled" } };
  }
  if (player.exiled) {
    return { ok: false, reason: { kind: "PlayerExiled" } };
  }
  if (hasActivePlayerElopement(state)) {
    return { ok: false, reason: { kind: "ElopementInProgress" } };
  }
  if (player.currentLocation !== "Capital") {
    return { ok: false, reason: { kind: "WrongLocation", current: player.currentLocation } };
  }
  return { ok: true };
}

// ── Combat resolver (pure) ──────────────────────────────────────────────

export type PromenadeTactic = "WittyBanter" | "DeepEmpathy" | "ComplimentMount";

const PROMENADE_TACTIC_SET: ReadonlySet<string> = new Set([
  "WittyBanter",
  "DeepEmpathy",
  "ComplimentMount",
]);

// Narrowing helper consumed by sendPromenadeMessage store wrapper. Throws
// on out-of-set values — defense-in-depth against future resolver-pin drift.
// Production paths SHOULD NEVER hit the throw because the player UI pins
// a PromenadeTactic and the client-side resolveTactic at src/llm/types.ts
// returns the pin verbatim when non-null.
export function narrowToPromenadeTactic(tactic: string): PromenadeTactic {
  if (!PROMENADE_TACTIC_SET.has(tactic)) {
    throw new Error(
      `narrowToPromenadeTactic: expected one of [WittyBanter, DeepEmpathy, ComplimentMount], got "${tactic}"`,
    );
  }
  return tactic as PromenadeTactic;
}

export type PromenadeCombatInput = {
  tactic: PromenadeTactic;
  // P26 (H1): the promenade stance. Only "Mingle" enables the mount bonus (spec
  // §3 L450); Wallflower/TargetedPursuit are otherwise inert in promenade (no
  // multipliers — the low-risk envelope holds).
  stance: Stance;
  qualityMultiplier: number; // clamped to [0.5, 1.5] inside resolver
  targetHasMountFamilyEquipped: boolean; // gates ComplimentMount fixed bonus
  playerHasMountFamilyEquipped: boolean; // gates the per-action Mingle stack
  // P26 (H2): mood/trait synergy inputs — the SAME maps the ballroom resolver
  // consults (TACTIC_BONUS_MOOD / CONVERSATION_TRAIT_BONUSES).
  targetMood: Mood;
  targetTraits: ReadonlyArray<TraitId>;
};

export type PromenadeCombatOutcome = {
  kind: "Normal"; // never InstantFail (no faux-pas) — single discriminant
  affectionDelta: number;
  composureDelta: 0; // ALWAYS 0 — spec "low-risk daytime alternative"
};

// Pure combat resolver. NO state reads; NO PRNG draws.
//
// P26 (H1/H2) widened from the P12 base-only form:
//  - Composure delta is STILL ALWAYS 0 (zero composure damage across all 3
//    actions; penalty traits stay inert — the low-risk envelope).
//  - Mount+Mingle bonus now gates on stance === "Mingle" (spec §3 L450).
//  - Mood/trait synergy now applies (same maps as the ballroom resolver).
//  - Mountless ComplimentMount is a hard 0 (parity with the H4 ballroom
//    ZeroYield): zero-gated BEFORE synergy so it never accrues trait/mood bonus.
export function resolvePromenadeCombat(input: PromenadeCombatInput): PromenadeCombatOutcome {
  // H2 parity gate: a ComplimentMount against a mountless target yields nothing
  // (no base, no synergy, no mount bonus).
  if (input.tactic === "ComplimentMount" && !input.targetHasMountFamilyEquipped) {
    return { kind: "Normal", affectionDelta: 0, composureDelta: 0 };
  }

  let baseAffection: number;
  switch (input.tactic) {
    case "WittyBanter":
      baseAffection = PROMENADE_BASE_AFFECTION_WITTY_BANTER;
      break;
    case "DeepEmpathy":
      baseAffection = PROMENADE_BASE_AFFECTION_DEEP_EMPATHY;
      break;
    case "ComplimentMount":
      baseAffection = PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT;
      break;
  }

  // H2: mood/trait synergy (same maps as the ballroom resolver).
  const bonusCount = input.targetTraits.filter((t) =>
    CONVERSATION_TRAIT_BONUSES.get(t)?.includes(input.tactic),
  ).length;
  const moodMatches = TACTIC_BONUS_MOOD.get(input.tactic) === input.targetMood;

  // H1: mount+Mingle bonus, additive (NOT multiplicative), gated on Mingle.
  const mountBonus =
    input.stance === "Mingle" && input.playerHasMountFamilyEquipped
      ? PROMENADE_PLAYER_MOUNT_MINGLE_BONUS
      : 0;

  // Applied BEFORE quality modulation so the LLM phrasing-quality factor scales
  // the composed (base + synergy + bonus) affection.
  const composedBase =
    baseAffection +
    bonusCount * COMBAT_BONUS_VALUE +
    (moodMatches ? COMBAT_BONUS_VALUE : 0) +
    mountBonus;
  const quality = clamp(input.qualityMultiplier, QUALITY_MULTIPLIER_FLOOR, QUALITY_MULTIPLIER_CEIL);
  return {
    kind: "Normal",
    affectionDelta: Math.round(composedBase * quality),
    composureDelta: 0,
  };
}

// ── Read-side helpers (consumed by store wrapper + UI) ──────────────────

// Returns true if the given character has a mount-family ArtifactInstance
// EQUIPPED. Used both for the player head's "Mingle+mount bonus" gate AND
// the partner's "ComplimentMount available" gate.
//
// equippedArtifactIds is the canonical branded `ArtifactInstanceId` array
// (matches `Character.equippedArtifactIds` shape at src/game/entities.ts).
// No `as never` workaround needed.
export function characterEquipsMountFamily(
  state: GameState,
  equippedArtifactIds: ReadonlyArray<ArtifactInstanceId>,
): boolean {
  for (const instId of equippedArtifactIds) {
    const inst = state.artifactInstances.get(instId);
    if (inst === undefined) continue;
    const def = resolveArtifactDefinition(state, inst.definitionId);
    if (def === undefined) continue;
    if (def.family === MOUNT_FAMILY) return true;
  }
  return false;
}

// Returns true if the player house head has a mount-family ArtifactInstance
// EQUIPPED. Spec uses "owned" / "on the player" — read as "equipped on the
// player head" for v1.
export function playerHeadEquipsMountFamily(state: GameState): boolean {
  const player = state.houses.get(PLAYER_HOUSE_ID);
  if (player === undefined) return false;
  const head = state.characters.get(player.headOfHouseCharacterId);
  if (head === undefined) return false;
  return characterEquipsMountFamily(state, head.equippedArtifactIds);
}

// ── Exchange-write helper (post-LLM-resolution) ─────────────────────────

// Writes the resolved promenade exchange to state.conversationHistory AND
// updates state.affectionMap[(playerHouseId, partnerId)]. Pure transform;
// no PRNG draws; no tick advance. Caller composes this with advanceTickPure
// ON EXIT (not per-turn).
//
// Affection is clamped to [0, 100] at this mutation site per CLAUDE.md
// "Clamp at every mutation site" non-negotiable.
export function appendPromenadeExchange(
  state: GameState,
  partnerCharId: CharacterId,
  playerExchange: { text: string; classifiedTactic: PromenadeTactic },
  npcExchange: { text: string },
  affectionDelta: number,
  tick: number,
): GameState {
  const pairKey = makePairKey(PLAYER_HOUSE_ID, partnerCharId);
  const newHistory = new Map(state.conversationHistory);
  const existing = newHistory.get(pairKey) ?? [];
  newHistory.set(pairKey, [
    ...existing,
    {
      speaker: "house-head",
      text: playerExchange.text,
      classifiedTactic: playerExchange.classifiedTactic,
      tick,
    },
    { speaker: "other", text: npcExchange.text, classifiedTactic: null, tick },
  ]);
  const newAffection = new Map(state.affectionMap);
  const current = newAffection.get(pairKey) ?? 0;
  newAffection.set(pairKey, clamp(current + affectionDelta, 0, 100));
  return { ...state, conversationHistory: newHistory, affectionMap: newAffection };
}

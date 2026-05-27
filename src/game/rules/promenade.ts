// P12 Hyde Park Promenade rules layer. Pure functions; no imports from UI,
// persistence, LLM, runtime, or events. Spec §3 "Hyde Park Daytime Promenade"
// (lines 192-198) + "Hyde Park Promenade" (lines 444-450).
//
// Five exported entry points:
//   eligiblePromenadePartners — lex-sorted partner pool projection
//   pickPromenadePartner       — deterministic 1-RNG-draw partner pick
//   canEnterPromenade          — pure entry-gate validator
//   resolvePromenadeCombat     — pure combat resolver (NO faux-pas, NO composure)
//   appendPromenadeExchange    — pure history + affection-map writer
//
// Plus read-side helpers:
//   playerHeadEquipsMountFamily — player-head mount-family equip check
//   characterEquipsMountFamily  — generic character mount-family equip check
//   narrowToPromenadeTactic     — narrowing helper for store-side cast safety

import {
  PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT,
  PROMENADE_BASE_AFFECTION_DEEP_EMPATHY,
  PROMENADE_BASE_AFFECTION_WITTY_BANTER,
  PROMENADE_PLAYER_MOUNT_MINGLE_BONUS,
  QUALITY_MULTIPLIER_CEIL,
  QUALITY_MULTIPLIER_FLOOR,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { GameState } from "../entities";
// MOUNT_FAMILY narrows "mount" to the typed ArtifactFamily literal —
// single source of truth shared with src/game/bootstrap.ts's
// bootstrapNpcMountFamily helper (which imports MOUNT_FAMILY from here).
import { ARTIFACT_REGISTRY, type ArtifactFamily } from "../fixtures/artifacts";
import type { LocationId } from "../fixtures/locations";
import { RIVAL_CHARACTER_IDS_SET } from "../fixtures/rivals";
import {
  type ArtifactInstanceId,
  type CharacterId,
  PLAYER_HOUSE_ID,
  drawInt,
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

// Single-draw partner pick. ALWAYS advances state.rng[PLAYER_HOUSE_ID] by
// exactly 1 callCount on non-empty pools; ZERO advance on empty pool.
// Caller (store action) commits the new rng map to GameState.
export function pickPromenadePartner(state: GameState): {
  partnerId: CharacterId | null;
  nextState: GameState;
} {
  const pool = eligiblePromenadePartners(state);
  if (pool.length === 0) {
    // Empty pool: surface rejection without burning RNG (matches
    // "denial paths cost nothing" semantics from applyAudience).
    return { partnerId: null, nextState: state };
  }
  const playerRng = getOrThrow(state.rng, PLAYER_HOUSE_ID);
  const { next: idx, rngState: nextRng } = drawInt(playerRng, pool.length);
  const newRng = new Map(state.rng);
  newRng.set(PLAYER_HOUSE_ID, nextRng);
  const partnerId = pool[idx] ?? null; // unreachable per drawInt range; required by noUncheckedIndexedAccess
  return { partnerId, nextState: { ...state, rng: newRng } };
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
  qualityMultiplier: number; // clamped to [0.5, 1.5] inside resolver
  targetHasMountFamilyEquipped: boolean; // gates ComplimentMount fixed bonus
  playerHasMountFamilyEquipped: boolean; // gates the per-action Mingle stack
};

export type PromenadeCombatOutcome = {
  kind: "Normal"; // never InstantFail (no faux-pas) — single discriminant
  affectionDelta: number;
  composureDelta: 0; // ALWAYS 0 — spec "low-risk daytime alternative"
};

// Pure combat resolver. NO state reads; NO PRNG draws.
//
// Distinct from src/game/rules/combat.ts:resolveCombat because:
//  - Faux-pas branch (Flattery-vs-Defensive InstantFail) is unreachable —
//    Flattery isn't a PromenadeTactic. WittyBanter-vs-Distracted ZeroYield
//    is also unreachable: spec line 449 reads as the WHOLE penalty envelope.
//  - Composure delta is ALWAYS 0 (zero composure damage across all 3 actions).
//  - ComplimentMount is target-gated, not trait/mood-modulated.
//  - Mount+Mingle bonus stacks per-action (not per-session).
export function resolvePromenadeCombat(input: PromenadeCombatInput): PromenadeCombatOutcome {
  let baseAffection: number;
  switch (input.tactic) {
    case "WittyBanter":
      baseAffection = PROMENADE_BASE_AFFECTION_WITTY_BANTER;
      break;
    case "DeepEmpathy":
      baseAffection = PROMENADE_BASE_AFFECTION_DEEP_EMPATHY;
      break;
    case "ComplimentMount":
      // Gated bonus: 0 affection if target doesn't equip a mount-family.
      // UI suppresses the button in this state, but defense-in-depth: a
      // stale classification (model classifies into ComplimentMount when
      // the target has since unequipped) silently degrades rather than
      // fabricating affection.
      baseAffection = input.targetHasMountFamilyEquipped
        ? PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT
        : 0;
      break;
  }
  // Mount+Mingle bonus is additive (NOT multiplicative). Applied BEFORE
  // quality modulation so the LLM phrasing-quality factor scales the
  // composed (base + bonus) affection.
  const composedBase =
    baseAffection + (input.playerHasMountFamilyEquipped ? PROMENADE_PLAYER_MOUNT_MINGLE_BONUS : 0);
  const quality = clamp(input.qualityMultiplier, QUALITY_MULTIPLIER_FLOOR, QUALITY_MULTIPLIER_CEIL);
  const affectionDelta = Math.round(composedBase * quality);
  return {
    kind: "Normal",
    affectionDelta,
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
    const def = ARTIFACT_REGISTRY.get(inst.definitionId);
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

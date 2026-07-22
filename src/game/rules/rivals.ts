// P8: rival-action loop. Per-tick rule walking state.rivalActors in lex-id
// order. For each rival passing activation + cooldown + head-alive + player-
// not-exiled gates, rolls one weighted action from RIVAL_ACTION_WEIGHTS and
// dispatches to one of the 5 branches (LeakWhisper, PettySabotage,
// OpenSabotage, RaiseFactionTension, Seduction).
//
// Uses each rival's own state.rng[rivalHouseId] — NEVER the player's RNG.
//
// P25 R3: the phase threads ONE full working `GameState` through the loop
// (hostility decay → gates → dispatch → cooldown burn) rather than a
// field-subset accumulator. A DemandSatisfaction duel resolves via
// `resolveDuel`, whose death cascade (`pruneOrphanedConversationKeys`) mutates
// conversationHistory / affectionMap / betrothals / elopements BEYOND the
// old accumulator's tracked Maps — a field-subset accumulator would silently
// drop those, so the whole-GameState thread is load-bearing. Every dispatch
// branch reads from and returns the working state; the P6 per-iteration
// collision-avoidance is preserved because id factories walk the working
// state (not the captured `state` parameter).
//
// Replaces the P1 identity stub at tickOrchestrator.ts slot 15 ("rivals
// always run last" — CLAUDE.md non-negotiable).

import {
  FACTION_TENSION_CAP,
  FACTION_TENSION_DELTA_PER_RAISE_ACTION,
  PETTY_SABOTAGE_REPUTATION_DELTA,
  RIVAL_ACTION_COOLDOWN_TICKS,
  RIVAL_ACTION_KINDS,
  RIVAL_ACTION_WEIGHTS,
  RIVAL_HOSTILITY_ACTIVATION_THRESHOLD,
  RIVAL_HOSTILITY_DECAY_PER_TICK,
  RIVAL_OPEN_SABOTAGE_TENSION_BIAS_SLOPE_SCALED,
  RIVAL_WEIGHT_SCALE,
  type RivalActionKind,
} from "../constants";
import type { GameState, House, RivalActorState } from "../entities";
import {
  FACTION_IDS,
  PLAYER_FACTION_ID,
  lexPickOpposingFaction,
  makeFactionPairKey,
} from "../fixtures/factions";
import {
  type CharacterId,
  type FactionPairKey,
  PLAYER_HOUSE_ID,
  type WhisperId,
  drawNext,
} from "../rng";
import { clamp } from "../util/clamp";
import { tryStartScheme } from "./schemes";

type DispatchResult =
  | { kind: "Fired"; action: RivalActionKind }
  | {
      kind: "Skipped";
      reason: "TargetDead" | "FactionTensionAtCap" | "PlayerHouseNotFound" | "OtherRejection";
    };

// computeEffectiveWeights returns ALREADY-SCALED integer weights per
// RIVAL_ACTION_KINDS index order. Float-free arithmetic (resolves IEEE-754
// cross-engine determinism risk). Pre-filters RaiseFactionTension to weight 0
// when the rival's lex-pick opposing pair is already at FACTION_TENSION_CAP
// (resolves the wedge where a capped rival would deterministically re-skip).
function computeEffectiveWeights(
  rival: RivalActorState,
  factionTensions: ReadonlyMap<FactionPairKey, number>,
): readonly number[] {
  return RIVAL_ACTION_KINDS.map((kind) => {
    const baseScaled = RIVAL_ACTION_WEIGHTS[kind] * RIVAL_WEIGHT_SCALE;
    if (kind === "RaiseFactionTension") {
      const opposing = lexPickOpposingFaction(rival.factionId);
      if (opposing !== null) {
        const pairKey = makeFactionPairKey(rival.factionId, opposing);
        if ((factionTensions.get(pairKey) ?? 0) >= FACTION_TENSION_CAP) return 0;
      }
      return baseScaled;
    }
    if (kind !== "OpenSabotage") return baseScaled;
    // OpenSabotage tension bias: weight grows linearly in (maxOpposing - 50).
    let maxOpposing = 0;
    for (const fid of FACTION_IDS) {
      if (fid === rival.factionId || fid === PLAYER_FACTION_ID) continue;
      const pairKey = makeFactionPairKey(rival.factionId, fid);
      const t = factionTensions.get(pairKey) ?? 0;
      if (t > maxOpposing) maxOpposing = t;
    }
    const biasScaled =
      maxOpposing > 50 ? RIVAL_OPEN_SABOTAGE_TENSION_BIAS_SLOPE_SCALED * (maxOpposing - 50) : 0;
    return baseScaled + biasScaled;
  });
}

// Deterministic index pick from a roll in [0, poolSize). Walks the scaled
// weights cumulatively; returns the kind whose cumulative sum first exceeds
// rollScaled. All-zero pool would never satisfy the predicate; we default to
// the last kind as defense-in-depth (caller ensures poolSize > 0 in practice).
function pickByScaledWeight(scaledWeights: readonly number[], rollScaled: number): RivalActionKind {
  let cumulative = 0;
  for (let i = 0; i < scaledWeights.length; i++) {
    cumulative += scaledWeights[i] ?? 0;
    if (rollScaled < cumulative) {
      const kind = RIVAL_ACTION_KINDS[i];
      if (kind !== undefined) return kind;
    }
  }
  return RIVAL_ACTION_KINDS[RIVAL_ACTION_KINDS.length - 1] ?? "LeakWhisper";
}

// Each branch reads from and returns the working `GameState`. `rivalHouse` is
// the post-decay house for this rival (already written into `working.houses`).
function dispatchRivalAction(
  pickedKind: RivalActionKind,
  rival: RivalActorState,
  rivalHouse: House,
  working: GameState,
  tick: number,
): { working: GameState; result: DispatchResult } {
  switch (pickedKind) {
    case "LeakWhisper": {
      // Pick a player-house character to talk about (lex-smallest alive id).
      const candidates: CharacterId[] = [];
      for (const c of working.characters.values()) {
        if (c.houseId === PLAYER_HOUSE_ID && c.alive) candidates.push(c.id);
      }
      candidates.sort();
      const targetCharId = candidates[0];
      if (targetCharId === undefined) {
        return { working, result: { kind: "Skipped", reason: "PlayerHouseNotFound" } };
      }
      // Deterministic stub whisper id keyed on (rivalId, target, tick) —
      // rival-leaks have no synergy-flag origin (full factory is P6).
      const whisperId = `rival-leak:${rival.houseId}:${targetCharId}:${tick}` as WhisperId;
      if (working.whispers.has(whisperId)) {
        return { working, result: { kind: "Fired", action: "LeakWhisper" } };
      }
      const newWhispers = new Map(working.whispers);
      newWhispers.set(whisperId, {
        id: whisperId,
        text: "",
        originatingTick: tick,
        sourceCharacterId: rival.associatedCharacterIds[0] ?? rivalHouse.headOfHouseCharacterId,
        subjectCharacterId: targetCharId,
        destinationHouseId: PLAYER_HOUSE_ID,
        arrivedAtTick: tick,
        verificationProgress: 0,
        status: "Unverified",
        weaponizedAs: null,
        weaponizedAtTick: null,
        scandalSheetAttribution: null,
        accidentalSlipDripsRemaining: 0,
        llmGenerated: false,
      });
      return {
        working: { ...working, whispers: newWhispers },
        result: { kind: "Fired", action: "LeakWhisper" },
      };
    }
    case "PettySabotage": {
      const playerHouse = working.houses.get(PLAYER_HOUSE_ID);
      if (playerHouse === undefined) {
        return { working, result: { kind: "Skipped", reason: "PlayerHouseNotFound" } };
      }
      const newHouses = new Map(working.houses);
      newHouses.set(PLAYER_HOUSE_ID, {
        ...playerHouse,
        reputation: clamp(playerHouse.reputation + PETTY_SABOTAGE_REPUTATION_DELTA, 0, 100),
      });
      return {
        working: { ...working, houses: newHouses },
        result: { kind: "Fired", action: "PettySabotage" },
      };
    }
    case "OpenSabotage": {
      const playerHouse = working.houses.get(PLAYER_HOUSE_ID);
      if (playerHouse === undefined) {
        return { working, result: { kind: "Skipped", reason: "PlayerHouseNotFound" } };
      }
      // tryStartScheme mutates only houses + schemes and returns a full state;
      // adopt it wholesale (it carries every other working Map forward).
      const result = tryStartScheme(working, rival.houseId, {
        kind: "Sabotage",
        targetCharacterId: playerHouse.headOfHouseCharacterId,
        skipWealthDeduction: true,
      });
      if (result.ok) {
        return { working: result.state, result: { kind: "Fired", action: "OpenSabotage" } };
      }
      if (result.reason.kind === "TargetIsDead") {
        return { working, result: { kind: "Skipped", reason: "TargetDead" } };
      }
      return { working, result: { kind: "Skipped", reason: "OtherRejection" } };
    }
    case "RaiseFactionTension": {
      const opposing = lexPickOpposingFaction(rival.factionId);
      if (opposing === null) {
        return { working, result: { kind: "Skipped", reason: "OtherRejection" } };
      }
      const pairKey = makeFactionPairKey(rival.factionId, opposing);
      const current = working.factionTensions.get(pairKey) ?? 0;
      if (current >= FACTION_TENSION_CAP) {
        return { working, result: { kind: "Skipped", reason: "FactionTensionAtCap" } };
      }
      const newTensions = new Map(working.factionTensions);
      newTensions.set(
        pairKey,
        clamp(current + FACTION_TENSION_DELTA_PER_RAISE_ACTION, 0, FACTION_TENSION_CAP),
      );
      return {
        working: { ...working, factionTensions: newTensions },
        result: { kind: "Fired", action: "RaiseFactionTension" },
      };
    }
    case "Seduction": {
      // P24a: a rival runs a Seduction against the lex-smallest alive
      // player-house character. tryStartScheme creates the Active scheme; the
      // discovery branch (applySchemeResolutionPhase) later mounts a NON-player
      // auto-resolving sprint and lands the discovery scandal on the rival
      // (owner) house. The per-aggressor Q2 gate may reject if the rival head
      // already runs an Active Seduction (→ Skipped/OtherRejection).
      const candidates: CharacterId[] = [];
      for (const c of working.characters.values()) {
        if (c.houseId === PLAYER_HOUSE_ID && c.alive) candidates.push(c.id);
      }
      candidates.sort();
      const targetCharId = candidates[0];
      if (targetCharId === undefined) {
        return { working, result: { kind: "Skipped", reason: "PlayerHouseNotFound" } };
      }
      const result = tryStartScheme(working, rival.houseId, {
        kind: "Seduction",
        targetCharacterId: targetCharId,
        skipWealthDeduction: true,
      });
      if (result.ok) {
        return { working: result.state, result: { kind: "Fired", action: "Seduction" } };
      }
      if (result.reason.kind === "TargetIsDead") {
        return { working, result: { kind: "Skipped", reason: "TargetDead" } };
      }
      return { working, result: { kind: "Skipped", reason: "OtherRejection" } };
    }
  }
}

export type ApplyRivalActionPhaseOptions = {
  cooldownOverride?: number;
};

export function applyRivalActionPhase(
  state: GameState,
  opts?: ApplyRivalActionPhaseOptions,
): GameState {
  let working = state;

  const sortedRivalIds = [...state.rivalActors.keys()].sort();
  for (const rivalId of sortedRivalIds) {
    const rival = working.rivalActors.get(rivalId);
    if (rival === undefined) continue;
    const preDecayHouse = working.houses.get(rivalId);
    if (preDecayHouse === undefined) continue;

    // 1. Hostility decay (-1/tick), clamp [0, 100]. Runs unconditionally
    //    even when the rival fails subsequent gates (spec §3 line 403:
    //    "passive decay keeps inactive rivals quiet").
    const postDecayHouse: House = {
      ...preDecayHouse,
      hostility: clamp(preDecayHouse.hostility + RIVAL_HOSTILITY_DECAY_PER_TICK, 0, 100),
    };
    {
      const newHouses = new Map(working.houses);
      newHouses.set(rivalId, postDecayHouse);
      working = { ...working, houses: newHouses };
    }

    // 2. Activation gate.
    if (postDecayHouse.hostility < RIVAL_HOSTILITY_ACTIVATION_THRESHOLD) continue;

    // 3. Cooldown gate (test-mode override supported).
    const cooldownTicks = opts?.cooldownOverride ?? RIVAL_ACTION_COOLDOWN_TICKS;
    const cooldownReady =
      rival.lastActionTick === null || state.tick - rival.lastActionTick >= cooldownTicks;
    if (!cooldownReady) continue;

    // 4. Head-alive gate. selectAggressor throws on dead head; skip here so
    //    the throw site is never reached. Reads the WORKING state so a mid-loop
    //    duel death (a later phase feature) is seen.
    const rivalHead = working.characters.get(postDecayHouse.headOfHouseCharacterId);
    if (rivalHead === undefined || !rivalHead.alive) continue;

    // 5. Player-exile gate. Terminal-state per CLAUDE.md — all rival actions
    //    target the player; skip the entire dispatch on exile.
    const playerHouseExileCheck = working.houses.get(PLAYER_HOUSE_ID);
    if (playerHouseExileCheck?.exiled === true) continue;

    // 6. Weighted pick (integer-scaled). All-zero pool (e.g., RaiseFactionTension
    //    pre-filtered to 0 AND no OpenSabotage bias) means no action available
    //    — skip without burning RNG.
    const scaledWeights = computeEffectiveWeights(rival, working.factionTensions);
    const poolSize = scaledWeights.reduce((a, b) => a + b, 0);
    if (poolSize <= 0) continue;

    const rngState = working.rng.get(rivalId);
    if (rngState === undefined) continue;
    const { next: roll, rngState: nextRng } = drawNext(rngState);
    {
      const newRng = new Map(working.rng);
      newRng.set(rivalId, nextRng);
      working = { ...working, rng: newRng };
    }
    const rollScaled = Math.floor(roll * poolSize);
    const pickedKind = pickByScaledWeight(scaledWeights, rollScaled);

    // 7. Dispatch — reads/returns the working state.
    working = dispatchRivalAction(pickedKind, rival, postDecayHouse, working, state.tick).working;

    // 8. Cooldown burn — unconditional on every roll (Fired AND Skipped) so
    //    a terminal-skip action doesn't wedge the rival into a deterministic
    //    re-pick loop (spec §3 line 404). Re-read the rival from the working
    //    state (a dispatch death cascade may have re-written rivalActors) so
    //    the lastActionTick write doesn't clobber a cascade prune.
    const rivalNow = working.rivalActors.get(rivalId) ?? rival;
    const newRivalActors = new Map(working.rivalActors);
    newRivalActors.set(rivalId, { ...rivalNow, lastActionTick: state.tick });
    working = { ...working, rivalActors: newRivalActors };
  }

  return working;
}

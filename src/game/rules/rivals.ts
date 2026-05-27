// P8: rival-action loop. Per-tick rule walking state.rivalActors in lex-id
// order. For each rival passing activation + cooldown + head-alive + player-
// not-exiled gates, rolls one weighted action from RIVAL_ACTION_WEIGHTS and
// dispatches to one of the 4 branches (LeakWhisper, PettySabotage,
// OpenSabotage, RaiseFactionTension).
//
// Uses each rival's own state.rng[rivalHouseId] — NEVER the player's RNG.
// Per-iteration multi-Map accumulator pattern (CLAUDE.md non-negotiable):
// lazy-clones all mutable Maps on first write; subsequent iterations read
// from acc.* (not state.*) so cross-iteration collisions are impossible.
//
// Replaces the P1 identity stub at tickOrchestrator.ts slot 10 ("rivals
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
import type {
  CourierPayload,
  GameState,
  House,
  RivalActorState,
  Scheme,
  Whisper,
} from "../entities";
import {
  FACTION_IDS,
  PLAYER_FACTION_ID,
  lexPickOpposingFaction,
  makeFactionPairKey,
} from "../fixtures/factions";
import {
  type CharacterId,
  type CourierPayloadId,
  type FactionPairKey,
  type HouseId,
  PLAYER_HOUSE_ID,
  type RngState,
  type SchemeId,
  type WhisperId,
  drawNext,
} from "../rng";
import { clamp } from "../util/clamp";
import { tryStartScheme } from "./schemes";

// Module-scope so dispatchRivalAction can reference the type.
type Acc = {
  rivalActors: Map<HouseId, RivalActorState> | null;
  schemes: Map<SchemeId, Scheme> | null;
  whispers: Map<WhisperId, Whisper> | null;
  couriers: Map<CourierPayloadId, CourierPayload> | null;
  houses: Map<HouseId, House> | null;
  factionTensions: Map<FactionPairKey, number> | null;
  rng: Map<HouseId, RngState> | null;
};

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

function dispatchRivalAction(
  pickedKind: RivalActionKind,
  rival: RivalActorState,
  rivalHouse: House,
  acc: Acc,
  state: GameState,
  tick: number,
): DispatchResult {
  switch (pickedKind) {
    case "LeakWhisper": {
      // Pick a player-house character to talk about. state.characters is
      // read-stable across this loop (the rival-action phase never mutates
      // characters); safe to read from state directly. Lex-smallest id wins.
      const candidates: CharacterId[] = [];
      for (const c of state.characters.values()) {
        if (c.houseId === PLAYER_HOUSE_ID && c.alive) candidates.push(c.id);
      }
      candidates.sort();
      const targetCharId = candidates[0];
      if (targetCharId === undefined) {
        return { kind: "Skipped", reason: "PlayerHouseNotFound" };
      }
      // P8: minimal whisper creation. Full whisper-id factory + courier flow
      // is implemented at P6; for P8 we generate a deterministic stub whisper
      // id keyed on (rivalId, target, tick) since rival-leaks have no
      // synergy-flag origin.
      const whisperId = `rival-leak:${rival.houseId}:${targetCharId}:${tick}` as WhisperId;
      acc.whispers ??= new Map(state.whispers);
      if (!acc.whispers.has(whisperId)) {
        acc.whispers.set(whisperId, {
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
      }
      return { kind: "Fired", action: "LeakWhisper" };
    }
    case "PettySabotage": {
      acc.houses ??= new Map(state.houses);
      const playerHouse = acc.houses.get(PLAYER_HOUSE_ID);
      if (playerHouse === undefined) return { kind: "Skipped", reason: "PlayerHouseNotFound" };
      acc.houses.set(PLAYER_HOUSE_ID, {
        ...playerHouse,
        reputation: clamp(playerHouse.reputation + PETTY_SABOTAGE_REPUTATION_DELTA, 0, 100),
      });
      return { kind: "Fired", action: "PettySabotage" };
    }
    case "OpenSabotage": {
      const playerHouse = (acc.houses ?? state.houses).get(PLAYER_HOUSE_ID);
      if (playerHouse === undefined) return { kind: "Skipped", reason: "PlayerHouseNotFound" };
      // Reconstruct synthetic GameState from the accumulator so tryStartScheme
      // reads post-mutation Maps (resolves Cycle-4 B2 stale-state risk).
      // state.characters is read-stable across this loop; passed through.
      const accState: GameState = {
        ...state,
        houses: acc.houses ?? state.houses,
        schemes: acc.schemes ?? state.schemes,
        rng: acc.rng ?? state.rng,
        whispers: acc.whispers ?? state.whispers,
        couriers: acc.couriers ?? state.couriers,
        factionTensions: acc.factionTensions ?? state.factionTensions,
      };
      const result = tryStartScheme(accState, rival.houseId, {
        kind: "Sabotage",
        targetCharacterId: playerHouse.headOfHouseCharacterId,
        skipWealthDeduction: true,
      });
      if (result.ok) {
        // Propagate scheme + house mutations from result.state back to acc.
        acc.schemes ??= new Map(state.schemes);
        const newScheme = result.state.schemes.get(result.schemeId);
        if (newScheme !== undefined) acc.schemes.set(result.schemeId, newScheme);
        acc.houses ??= new Map(state.houses);
        for (const [hid, h] of result.state.houses) {
          if (acc.houses.get(hid) !== h) acc.houses.set(hid, h);
        }
        return { kind: "Fired", action: "OpenSabotage" };
      }
      if (result.reason.kind === "TargetIsDead") {
        return { kind: "Skipped", reason: "TargetDead" };
      }
      // Any other rejection (MissingArchetype, WrongEra, etc.) — at v1 these
      // are structurally unreachable for rival OpenSabotage but the catch-all
      // keeps the dispatch result honest.
      return { kind: "Skipped", reason: "OtherRejection" };
    }
    case "RaiseFactionTension": {
      const opposing = lexPickOpposingFaction(rival.factionId);
      if (opposing === null) return { kind: "Skipped", reason: "OtherRejection" };
      const pairKey = makeFactionPairKey(rival.factionId, opposing);
      const tensions = acc.factionTensions ?? state.factionTensions;
      const current = tensions.get(pairKey) ?? 0;
      if (current >= FACTION_TENSION_CAP) {
        return { kind: "Skipped", reason: "FactionTensionAtCap" };
      }
      acc.factionTensions ??= new Map(state.factionTensions);
      acc.factionTensions.set(
        pairKey,
        clamp(current + FACTION_TENSION_DELTA_PER_RAISE_ACTION, 0, FACTION_TENSION_CAP),
      );
      return { kind: "Fired", action: "RaiseFactionTension" };
    }
    case "Seduction": {
      // P24a: a rival runs a Seduction against the lex-smallest alive
      // player-house character. tryStartScheme creates the Active scheme; the
      // discovery branch (applySchemeResolutionPhase) later mounts a NON-player
      // auto-resolving sprint and lands the discovery scandal on the rival
      // (owner) house. The per-aggressor Q2 gate may reject if the rival head
      // already runs an Active Seduction (→ Skipped/OtherRejection).
      const candidates: CharacterId[] = [];
      for (const c of state.characters.values()) {
        if (c.houseId === PLAYER_HOUSE_ID && c.alive) candidates.push(c.id);
      }
      candidates.sort();
      const targetCharId = candidates[0];
      if (targetCharId === undefined) {
        return { kind: "Skipped", reason: "PlayerHouseNotFound" };
      }
      const accState: GameState = {
        ...state,
        houses: acc.houses ?? state.houses,
        schemes: acc.schemes ?? state.schemes,
        rng: acc.rng ?? state.rng,
        whispers: acc.whispers ?? state.whispers,
        couriers: acc.couriers ?? state.couriers,
        factionTensions: acc.factionTensions ?? state.factionTensions,
      };
      const result = tryStartScheme(accState, rival.houseId, {
        kind: "Seduction",
        targetCharacterId: targetCharId,
        skipWealthDeduction: true,
      });
      if (result.ok) {
        acc.schemes ??= new Map(state.schemes);
        const newScheme = result.state.schemes.get(result.schemeId);
        if (newScheme !== undefined) acc.schemes.set(result.schemeId, newScheme);
        acc.houses ??= new Map(state.houses);
        for (const [hid, h] of result.state.houses) {
          if (acc.houses.get(hid) !== h) acc.houses.set(hid, h);
        }
        return { kind: "Fired", action: "Seduction" };
      }
      if (result.reason.kind === "TargetIsDead") {
        return { kind: "Skipped", reason: "TargetDead" };
      }
      return { kind: "Skipped", reason: "OtherRejection" };
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
  const acc: Acc = {
    rivalActors: null,
    schemes: null,
    whispers: null,
    couriers: null,
    houses: null,
    factionTensions: null,
    rng: null,
  };

  const sortedRivalIds = [...state.rivalActors.keys()].sort();
  for (const rivalId of sortedRivalIds) {
    const rival = (acc.rivalActors ?? state.rivalActors).get(rivalId);
    if (rival === undefined) continue;
    const preDecayHouse = (acc.houses ?? state.houses).get(rivalId);
    if (preDecayHouse === undefined) continue;

    // 1. Hostility decay (-1/tick), clamp [0, 100]. Runs unconditionally
    //    even when the rival fails subsequent gates (spec §3 line 403:
    //    "passive decay keeps inactive rivals quiet").
    acc.houses ??= new Map(state.houses);
    const postDecayHouse: House = {
      ...preDecayHouse,
      hostility: clamp(preDecayHouse.hostility + RIVAL_HOSTILITY_DECAY_PER_TICK, 0, 100),
    };
    acc.houses.set(rivalId, postDecayHouse);

    // 2. Activation gate.
    if (postDecayHouse.hostility < RIVAL_HOSTILITY_ACTIVATION_THRESHOLD) continue;

    // 3. Cooldown gate (test-mode override supported).
    const cooldownTicks = opts?.cooldownOverride ?? RIVAL_ACTION_COOLDOWN_TICKS;
    const cooldownReady =
      rival.lastActionTick === null || state.tick - rival.lastActionTick >= cooldownTicks;
    if (!cooldownReady) continue;

    // 4. Head-alive gate. selectAggressor throws on dead head; skip here so
    //    the throw site is never reached.
    const rivalHead = state.characters.get(postDecayHouse.headOfHouseCharacterId);
    if (rivalHead === undefined || !rivalHead.alive) continue;

    // 5. Player-exile gate. Terminal-state per CLAUDE.md — all 4 rival
    //    actions target the player; skip the entire dispatch on exile.
    const playerHouseExileCheck = state.houses.get(PLAYER_HOUSE_ID);
    if (playerHouseExileCheck?.exiled === true) continue;

    // 6. Weighted pick (integer-scaled). All-zero pool (e.g., RaiseFactionTension
    //    pre-filtered to 0 AND no OpenSabotage bias) means no action available
    //    — skip without burning RNG.
    const scaledWeights = computeEffectiveWeights(
      rival,
      acc.factionTensions ?? state.factionTensions,
    );
    const poolSize = scaledWeights.reduce((a, b) => a + b, 0);
    if (poolSize <= 0) continue;

    acc.rng ??= new Map(state.rng);
    const rngState = acc.rng.get(rivalId);
    if (rngState === undefined) continue;
    const { next: roll, rngState: nextRng } = drawNext(rngState);
    acc.rng.set(rivalId, nextRng);
    const rollScaled = Math.floor(roll * poolSize);
    const pickedKind = pickByScaledWeight(scaledWeights, rollScaled);

    // 7. Dispatch.
    dispatchRivalAction(pickedKind, rival, postDecayHouse, acc, state, state.tick);

    // 8. Cooldown burn — unconditional on every roll (Fired AND Skipped) so
    //    a terminal-skip action (e.g., RaiseFactionTension at-cap, though
    //    pre-filtered) doesn't wedge the rival into a deterministic re-pick
    //    loop. Per spec §3 line 404 "cooldown advances even on defensive
    //    no-ops".
    acc.rivalActors ??= new Map(state.rivalActors);
    acc.rivalActors.set(rivalId, { ...rival, lastActionTick: state.tick });
  }

  return {
    ...state,
    rivalActors: acc.rivalActors ?? state.rivalActors,
    schemes: acc.schemes ?? state.schemes,
    whispers: acc.whispers ?? state.whispers,
    couriers: acc.couriers ?? state.couriers,
    houses: acc.houses ?? state.houses,
    factionTensions: acc.factionTensions ?? state.factionTensions,
    rng: acc.rng ?? state.rng,
  };
}

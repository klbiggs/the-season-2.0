// P11 inherited-secrets + blood-feuds rule layer. Three responsibilities:
//   (1) `accumulateInheritedSecretsAtSuccession` — runs inside applySuccessionStep
//       on the PROMOTED branch (heirless succession → no accumulation). Copies
//       Verified+Weaponized whispers about player-house subjects into the
//       player house's inherited-secrets ledger. Evicts oldest past MAX_INHERITED_SECRETS.
//   (2) `applyInheritedSecretSurfacingPhase` — runs at tick-phase slot 13.
//       (a) Walks active blood-feuds; flips to Resolved with kind GenerationalDecay
//           if BLOOD_FEUD_DECAY_TICKS_MAX ticks have elapsed since incurredAtTick.
//       (b) Per-unsurfaced-secret roll. Picker = lex-smallest of
//           RIVAL_HOUSE_IDS_SET ∩ hostility ≥ BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD.
//           Surfacing mints (BloodFeud + casus-belli Grievance) and applies
//           BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE × associate-count to the
//           single (rival → player head) affectionMap key.
//   (3) `resolveBloodFeudByGrievance` — called from resolveDuel after the
//       Grievance.resolved flip, to mirror the flip onto any BloodFeud whose
//       triggeringGrievanceId matches.
//
// Plan: plans/phases/11-sibling-rivals-secrets.md

import {
  BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE,
  BLOOD_FEUD_DECAY_TICKS_MAX,
  BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD,
  INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS,
  MAX_INHERITED_SECRETS,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { BloodFeud, Grievance, House, InheritedSecret } from "../entities";
import { RIVAL_HOUSE_IDS_SET } from "../fixtures/rivals";
import {
  type BloodFeudId,
  type CharacterId,
  type GrievanceId,
  type InheritedSecretId,
  PLAYER_HOUSE_ID,
  drawNext,
} from "../rng";
import type { GameState } from "../store";

// ── Accumulation at succession ─────────────────────────────────────────────
export function accumulateInheritedSecretsAtSuccession(
  state: GameState,
  _deadHeadId: CharacterId,
  _newHeirId: CharacterId,
): GameState {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return state;

  // Subject filter (resolves cycle-4-iter-1 B3): whispers about any character
  // whose house was PLAYER_HOUSE_ID at accumulation time.
  // Lex-sort whispers for deterministic accumulation order.
  const sortedWhispers = [...state.whispers.values()].sort((a, b) => a.id.localeCompare(b.id));
  const existingSourceIds = new Set(playerHouse.inheritedSecrets.map((s) => s.sourceWhisperId));
  const newSecrets: InheritedSecret[] = [];

  for (const w of sortedWhispers) {
    if (existingSourceIds.has(w.id)) continue;
    if (w.status !== "Verified" && w.status !== "Weaponized") continue;
    const subjectChar = state.characters.get(w.subjectCharacterId);
    if (subjectChar === undefined) continue;
    if (subjectChar.houseId !== PLAYER_HOUSE_ID) continue;

    // Accumulator-aware id derivation (resolves cycle-4-iter-2 B2).
    const inGenIndex =
      playerHouse.inheritedSecrets.filter(
        (s) => s.originatingGenerationCount === playerHouse.generation,
      ).length +
      newSecrets.filter((s) => s.originatingGenerationCount === playerHouse.generation).length;
    newSecrets.push({
      id: `inheritedSecret-gen${playerHouse.generation}-${inGenIndex}` as InheritedSecretId,
      sourceWhisperId: w.id,
      description: w.text,
      originatingGenerationCount: playerHouse.generation,
      originatingTick: state.tick,
      surfacedAgainstHouseId: null,
      surfacedAtTick: null,
    });
  }

  if (newSecrets.length === 0) return state;

  // Push, then evict oldest if past MAX_INHERITED_SECRETS.
  let ledger = [...playerHouse.inheritedSecrets, ...newSecrets];
  let summary = playerHouse.ancestorSummary;
  while (ledger.length > MAX_INHERITED_SECRETS) {
    const sorted = [...ledger].sort((a, b) => a.originatingTick - b.originatingTick);
    const oldest = sorted[0];
    if (oldest === undefined) break;
    summary = [
      ...summary,
      `Generation ${oldest.originatingGenerationCount} inherited secret: ${oldest.description}`,
    ];
    ledger = ledger.filter((s) => s.id !== oldest.id);
  }

  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, {
    ...playerHouse,
    inheritedSecrets: ledger,
    ancestorSummary: summary,
  });
  return { ...state, houses: newHouses };
}

// ── Surfacing phase (PHASES slot 13) ───────────────────────────────────────
export function applyInheritedSecretSurfacingPhase(state: GameState): GameState {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return state;
  if (playerHouse.exiled) return state;

  // (1) Generational-decay walk: flip Active feuds older than DECAY_TICKS_MAX.
  let newBloodFeuds: BloodFeud[] | null = null;
  for (let i = 0; i < playerHouse.bloodFeuds.length; i += 1) {
    const bf = playerHouse.bloodFeuds[i];
    if (bf === undefined || bf.resolved) continue;
    if (state.tick - bf.incurredAtTick >= BLOOD_FEUD_DECAY_TICKS_MAX) {
      newBloodFeuds ??= [...playerHouse.bloodFeuds];
      newBloodFeuds[i] = {
        ...bf,
        resolved: true,
        resolvedAtTick: state.tick,
        resolutionKind: "GenerationalDecay",
      };
    }
  }

  // (2) Per-unsurfaced-secret roll.
  const accBloodFeuds: BloodFeud[] = newBloodFeuds ?? [...playerHouse.bloodFeuds];
  const accGrievances: Grievance[] = [...playerHouse.grievances];
  const accSecrets: InheritedSecret[] = [...playerHouse.inheritedSecrets];
  let accRng = state.rng.get(PLAYER_HOUSE_ID);
  const accAffectionMap = new Map(state.affectionMap);

  if (accRng === undefined) {
    // No player RNG entry — return current state with any decay updates only.
    if (newBloodFeuds === null) return state;
    const newHouses = new Map(state.houses);
    newHouses.set(PLAYER_HOUSE_ID, { ...playerHouse, bloodFeuds: newBloodFeuds });
    return { ...state, houses: newHouses };
  }

  const unsurfacedSecrets = [...playerHouse.inheritedSecrets]
    .filter((s) => s.surfacedAgainstHouseId === null)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const secret of unsurfacedSecrets) {
    const { next: roll, rngState: newRngState } = drawNext(accRng);
    accRng = newRngState;
    const rollBp = Math.floor(roll * 10000);
    if (rollBp >= INHERITED_SECRET_SURFACING_PROBABILITY_BASIS_POINTS) continue;

    // Picker pool — lex-smallest of RIVAL_HOUSE_IDS_SET ∩ hostility ≥ threshold.
    const eligibleRivalIds = [...RIVAL_HOUSE_IDS_SET]
      .filter(
        (rid) => (state.houses.get(rid)?.hostility ?? 0) >= BLOOD_FEUD_RIVAL_HOSTILITY_THRESHOLD,
      )
      .sort();
    if (eligibleRivalIds.length === 0) continue; // §7 line 655 missed roll
    const picked = eligibleRivalIds[0];
    if (picked === undefined) continue;

    // Flip secret to surfaced.
    const secretIdx = accSecrets.findIndex((s) => s.id === secret.id);
    if (secretIdx === -1) continue;
    const target = accSecrets[secretIdx];
    if (target === undefined) continue;
    accSecrets[secretIdx] = {
      ...target,
      surfacedAgainstHouseId: picked,
      surfacedAtTick: state.tick,
    };

    // Mint paired Grievance + BloodFeud (linked via triggeringGrievanceId).
    const grievanceInTickIdx = accGrievances.filter(
      (g) =>
        g.perpetratorHouseId === picked &&
        g.source === "BloodFeud" &&
        g.recordedAtTick === state.tick,
    ).length;
    const grievanceId = `${picked}:BloodFeud:${state.tick}:${grievanceInTickIdx}` as GrievanceId;
    const grievance: Grievance = {
      id: grievanceId,
      perpetratorHouseId: picked,
      defendantCharacterId: null,
      source: "BloodFeud",
      schemeId: null,
      recordedAtTick: state.tick,
      resolved: false,
    };
    accGrievances.push(grievance);

    const feudId = `bloodFeud-${secret.id}-${picked}-t${state.tick}` as BloodFeudId;
    const feud: BloodFeud = {
      id: feudId,
      offendingHouseId: picked,
      triggeringSecretId: secret.id,
      triggeringGrievanceId: grievanceId,
      incurredAtTick: state.tick,
      resolved: false,
      resolvedAtTick: null,
      resolutionKind: null,
    };
    accBloodFeuds.push(feud);

    // Affection-penalty walk: per-associate-count magnitude applied to the
    // single (rival house → player head) affectionMap key.
    const rivalActor = state.rivalActors.get(picked);
    if (rivalActor !== undefined && rivalActor.associatedCharacterIds.length > 0) {
      const key = makePairKey(picked, playerHouse.headOfHouseCharacterId);
      const current = accAffectionMap.get(key) ?? 0;
      const delta =
        BLOOD_FEUD_AFFECTION_PENALTY_PER_ASSOCIATE * rivalActor.associatedCharacterIds.length;
      accAffectionMap.set(key, Math.max(0, Math.min(100, current - delta)));
    }
  }

  // Single write-back if anything mutated.
  const someBloodFeudsChanged =
    newBloodFeuds !== null || accBloodFeuds.length !== playerHouse.bloodFeuds.length;
  const someGrievancesChanged = accGrievances.length !== playerHouse.grievances.length;
  const someSecretsChanged = accSecrets.some((s, i) => playerHouse.inheritedSecrets[i] !== s);

  if (!someBloodFeudsChanged && !someGrievancesChanged && !someSecretsChanged) {
    // No surfacing happened AND no decay. Still need to persist accRng if it advanced.
    if (accRng === state.rng.get(PLAYER_HOUSE_ID)) return state;
    const newRngMap = new Map(state.rng);
    newRngMap.set(PLAYER_HOUSE_ID, accRng);
    return { ...state, rng: newRngMap };
  }

  const newPlayerHouse: House = {
    ...playerHouse,
    bloodFeuds: accBloodFeuds,
    grievances: accGrievances,
    inheritedSecrets: accSecrets,
  };
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, newPlayerHouse);

  const newRngMap = new Map(state.rng);
  newRngMap.set(PLAYER_HOUSE_ID, accRng);

  return {
    ...state,
    houses: newHouses,
    rng: newRngMap,
    affectionMap: accAffectionMap,
  };
}

// ── BloodFeud → Grievance resolution wiring (called from resolveDuel) ─────
export function resolveBloodFeudByGrievance(
  state: GameState,
  grievanceId: GrievanceId,
  resolutionKind: "DuelWin" | "DuelLoss",
): GameState {
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return state;
  const idx = playerHouse.bloodFeuds.findIndex(
    (bf) => bf.triggeringGrievanceId === grievanceId && !bf.resolved,
  );
  if (idx === -1) return state;
  const target = playerHouse.bloodFeuds[idx];
  if (target === undefined) return state;
  const newBloodFeuds = [...playerHouse.bloodFeuds];
  newBloodFeuds[idx] = {
    ...target,
    resolved: true,
    resolvedAtTick: state.tick,
    resolutionKind,
  };
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, { ...playerHouse, bloodFeuds: newBloodFeuds });
  return { ...state, houses: newHouses };
}

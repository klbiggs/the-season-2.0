// P6: whisper resolver module. Owns whisper generation (synergy, wallflower-
// bonus, LLM-additive ingestion), verification cadence (per-tick progress),
// courier draining + delivery, and three weaponization branches (Blackmail,
// Scandal Sheet, Accidental Slip). Pure rule layer per CLAUDE.md non-
// negotiable §1 — no imports from runtime/llm/persist/UI.
//
// Determinism: makeWhisperId + makeCourierPayloadId are deterministic
// factories (no PRNG). The single PRNG-consuming branch is Scandal Sheet
// weaponization (attribution roll). All other paths are deterministic.

import {
  ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION,
  ACCIDENTAL_SLIP_DURATION_TICKS,
  BLACKMAIL_AFFECTION_BOOST,
  BLACKMAIL_SCANDAL_COST,
  SCANDAL_SHEET_ATTRIBUTION_PROBABILITY,
  SCANDAL_SHEET_REPUTATION_DROP,
  WEAPONIZATION_BRANCHES,
  WHISPERS_PERK_VERIFICATION_MULTIPLIER,
  WHISPER_VERIFICATION_PER_TICK,
  WHISPER_VERIFICATION_THRESHOLD,
  type WeaponizationBranch,
  type WhisperStatus,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { CourierPayload, GameState, Whisper } from "../entities";
import { makeCourierPayloadId } from "../fixtures/courierPayloadIdFactory";
import type { LocationId } from "../fixtures/locations";
import { makeWhisperId } from "../fixtures/whisperIdFactory";
import {
  type CharacterId,
  type HouseId,
  PLAYER_HOUSE_ID,
  type WhisperId,
  drawNext,
  getOrThrow,
} from "../rng";
import { clamp } from "../util/clamp";
import { getCharacterOrThrow, getHouseOrThrow } from "../util/lookups";
import { transitTicks } from "./courier";
import { hasDynastyPerk } from "./dynastyLegacies";

// ── Public input/result types ────────────────────────────────────────────

export type WeaponizeWhisperResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: WeaponizeWhisperRejection };

export type WeaponizeWhisperRejection =
  | { kind: "WhisperNotFound"; whisperId: WhisperId }
  | { kind: "WhisperNotVerified"; whisperId: WhisperId; currentStatus: WhisperStatus }
  | { kind: "BlackmailInsufficientScandalCapacity"; have: number; cap: 100; need: number }
  | { kind: "SubjectIsDead"; subjectId: CharacterId }
  | { kind: "SubjectIsSelf"; subjectId: CharacterId }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }; // P9 Q4

export type DismissWhisperResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: DismissWhisperRejection };

export type DismissWhisperRejection =
  | { kind: "WhisperNotFound"; whisperId: WhisperId }
  | { kind: "WhisperAlreadyTerminal"; whisperId: WhisperId; currentStatus: WhisperStatus }
  | { kind: "PlayerExiled" }
  | { kind: "ElopementInProgress" }; // P9 Q4

// ── Generation (called from sendBallroomMessage post-resolve block) ──────

// Build a new Whisper entity. NOT a state mutation — caller is responsible
// for setting state.whispers.set(w.id, w) in its own producer body. Subject
// + source are CharacterIds; destination is the recipient house (player at v1).
// llmGenerated:false flag distinguishes deterministic synergy whispers from
// LLM-additive ingests at debug-trace time.
export function generateSynergyWhisper(
  state: GameState,
  sourceCharacterId: CharacterId,
  subjectCharacterId: CharacterId,
  conversationTick: number,
): Whisper {
  const source = state.characters.get(sourceCharacterId);
  const subject = state.characters.get(subjectCharacterId);
  const sourceName = source?.name ?? sourceCharacterId;
  const subjectName = subject?.name ?? subjectCharacterId;
  return {
    id: makeWhisperId(state, sourceCharacterId, subjectCharacterId),
    text: `Whisper about ${subjectName} from ${sourceName}.`,
    originatingTick: conversationTick,
    sourceCharacterId,
    subjectCharacterId,
    destinationHouseId: PLAYER_HOUSE_ID,
    arrivedAtTick: null,
    verificationProgress: 0,
    status: "Unverified",
    weaponizedAs: null,
    weaponizedAtTick: null,
    scandalSheetAttribution: null,
    accidentalSlipDripsRemaining: 0,
    llmGenerated: false,
  };
}

// Build an LLM-additive whisper. Same shape as generateSynergyWhisper but
// with llmGenerated:true and the LLM-supplied text body. Caller validates
// the subjectCharacterId predicates (exists, not target, not player-house)
// BEFORE invoking this — see store.ts:sendBallroomMessage.
export function ingestLlmAdditiveWhisper(
  state: GameState,
  sourceCharacterId: CharacterId,
  subjectCharacterId: CharacterId,
  text: string,
): Whisper {
  return {
    id: makeWhisperId(state, sourceCharacterId, subjectCharacterId),
    text,
    originatingTick: state.tick,
    sourceCharacterId,
    subjectCharacterId,
    destinationHouseId: PLAYER_HOUSE_ID,
    arrivedAtTick: null,
    verificationProgress: 0,
    status: "Unverified",
    weaponizedAs: null,
    weaponizedAtTick: null,
    scandalSheetAttribution: null,
    accidentalSlipDripsRemaining: 0,
    llmGenerated: true,
  };
}

// Build the courier carrying a whisper from origin to destination. arrivalTick
// is absolute (state.tick + transitTicks). Destination location read from
// destination house's currentLocation at COURIER START. Returns a new
// CourierPayload — caller sets state.couriers.set(c.id, c).
export function generateWhisperCourier(
  state: GameState,
  whisper: Whisper,
  originLocation: LocationId,
  destinationHouseId: HouseId,
): CourierPayload {
  const destinationHouse = getHouseOrThrow(state, destinationHouseId);
  const destinationLocation = destinationHouse.currentLocation;
  // P13: transitTicks widened to take (state, originatorHouseId, from, to).
  // At v1 only PLAYER_HOUSE_ID originates couriers (see literal at line 147
  // below), so we thread PLAYER_HOUSE_ID directly. Halves transit when the
  // player has applied the Later-era research action.
  const arrivalTick =
    state.tick + transitTicks(state, PLAYER_HOUSE_ID, originLocation, destinationLocation);
  const direction = destinationHouseId === PLAYER_HOUSE_ID ? "Inbound" : "Outbound";
  return {
    id: makeCourierPayloadId(state, PLAYER_HOUSE_ID),
    payloadType: "Whisper",
    whisperId: whisper.id,
    originHouseId: PLAYER_HOUSE_ID, // at v1 only PLAYER_HOUSE_ID originates couriers
    destinationHouseId,
    originLocation,
    destinationLocation,
    originTick: state.tick,
    arrivalTick,
    interceptable: direction === "Inbound",
    direction,
    status: "InFlight",
    resolvedAtTick: null,
  };
}

// Wallflower-bonus subject selection (spec §3 line 304 "deterministically
// picked non-target NPC"). v1 rule: lex-smallest CharacterId among living
// non-PLAYER non-target characters. Returns null when no eligible subject
// exists (e.g., target is the only non-player NPC).
export function pickWallflowerBonusSubject(
  state: GameState,
  conversationTargetCharId: CharacterId,
): { id: CharacterId } | null {
  const candidates: CharacterId[] = [];
  for (const c of state.characters.values()) {
    if (c.alive && c.houseId !== PLAYER_HOUSE_ID && c.id !== conversationTargetCharId) {
      candidates.push(c.id);
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort();
  // biome-ignore lint/style/noNonNullAssertion: candidates is non-empty per length check
  return { id: candidates[0]! };
}

// ── Phase functions (called from applyCourierAndStaffPhase) ──────────────

// Verify-progress step: +WHISPER_VERIFICATION_PER_TICK on every Unverified
// whisper whose courier has arrived (arrivedAtTick !== null). Flips status
// to Verified when progress crosses the threshold. NO PRNG draws.
export function applyWhisperVerificationPhase(state: GameState): GameState {
  // P15: the Whispers perk doubles the per-tick verification increment for
  // player-SOURCED whispers (offensive determinant, plan D5). Read the perk
  // flag once outside the loop; the per-whisper source-house resolve happens
  // inside. RNG-free.
  const hasWhispersPerk = hasDynastyPerk(state, "Whispers");
  let mutated = false;
  const newWhispers = new Map(state.whispers);
  const sortedIds = [...newWhispers.keys()].sort();
  for (const id of sortedIds) {
    // biome-ignore lint/style/noNonNullAssertion: id from keys() always present
    const w = newWhispers.get(id)!;
    if (w.status !== "Unverified" || w.arrivedAtTick === null) continue;
    const playerSourced = state.characters.get(w.sourceCharacterId)?.houseId === PLAYER_HOUSE_ID;
    const increment =
      hasWhispersPerk && playerSourced
        ? WHISPER_VERIFICATION_PER_TICK * WHISPERS_PERK_VERIFICATION_MULTIPLIER
        : WHISPER_VERIFICATION_PER_TICK;
    const nextProgress = Math.min(100, w.verificationProgress + increment);
    const nextStatus: WhisperStatus =
      nextProgress >= WHISPER_VERIFICATION_THRESHOLD ? "Verified" : "Unverified";
    newWhispers.set(id, { ...w, verificationProgress: nextProgress, status: nextStatus });
    mutated = true;
  }
  return mutated ? { ...state, whispers: newWhispers } : state;
}

// Courier drain step: flip InFlight couriers whose arrivalTick === state.tick
// to Delivered, AND set their carried Whisper's arrivedAtTick to state.tick.
// NO PRNG draws.
export function applyCourierDrainStep(state: GameState): GameState {
  let mutated = false;
  const newCouriers = new Map(state.couriers);
  const newWhispers = new Map(state.whispers);
  const sortedIds = [...newCouriers.keys()].sort();
  for (const id of sortedIds) {
    // biome-ignore lint/style/noNonNullAssertion: id from keys() always present
    const c = newCouriers.get(id)!;
    if (c.status !== "InFlight" || c.arrivalTick !== state.tick) continue;
    newCouriers.set(id, { ...c, status: "Delivered", resolvedAtTick: state.tick });
    const w = newWhispers.get(c.whisperId);
    if (w !== undefined && w.arrivedAtTick === null) {
      newWhispers.set(c.whisperId, { ...w, arrivedAtTick: state.tick });
    }
    mutated = true;
  }
  return mutated ? { ...state, couriers: newCouriers, whispers: newWhispers } : state;
}

// ── Player actions ───────────────────────────────────────────────────────

export function tryWeaponizeWhisper(
  state: GameState,
  ownerHouseId: HouseId,
  whisperId: WhisperId,
  branch: WeaponizationBranch,
): WeaponizeWhisperResult {
  // Defensive: branch must be a known enum value. Module-load assertion at
  // constants.ts catches enum-cardinality drift; this is the per-call guard.
  if (!WEAPONIZATION_BRANCHES.includes(branch)) {
    throw new Error(`tryWeaponizeWhisper: unknown branch=${branch}`);
  }
  const whisper = state.whispers.get(whisperId);
  if (whisper === undefined) {
    return { ok: false, reason: { kind: "WhisperNotFound", whisperId } };
  }
  if (whisper.status !== "Verified") {
    return {
      ok: false,
      reason: { kind: "WhisperNotVerified", whisperId, currentStatus: whisper.status },
    };
  }
  const subject = getCharacterOrThrow(state, whisper.subjectCharacterId);
  if (!subject.alive) {
    return { ok: false, reason: { kind: "SubjectIsDead", subjectId: subject.id } };
  }
  // PINNED: house-membership, not literal-id-equals — see
  // plans/phases/06-whispers-espionage.md "predicate-alignment table".
  if (subject.houseId === ownerHouseId) {
    return { ok: false, reason: { kind: "SubjectIsSelf", subjectId: subject.id } };
  }
  const owner = getHouseOrThrow(state, ownerHouseId);
  if (branch === "Blackmail" && owner.scandal + BLACKMAIL_SCANDAL_COST > 100) {
    return {
      ok: false,
      reason: {
        kind: "BlackmailInsufficientScandalCapacity",
        have: owner.scandal,
        cap: 100,
        need: BLACKMAIL_SCANDAL_COST,
      },
    };
  }

  // Branch-specific effect application + status flip atomic.
  switch (branch) {
    case "Blackmail":
      return resolveBlackmail(state, owner, whisper);
    case "ScandalSheet":
      return resolveScandalSheet(state, owner, whisper);
    case "AccidentalSlip":
      return resolveAccidentalSlip(state, owner, whisper);
  }
}

function resolveBlackmail(
  state: GameState,
  owner: ReturnType<typeof getHouseOrThrow>,
  whisper: Whisper,
): WeaponizeWhisperResult {
  // owner.scandal += BLACKMAIL_SCANDAL_COST (clamped)
  const newHouses = new Map(state.houses);
  newHouses.set(owner.id, {
    ...owner,
    scandal: clamp(owner.scandal + BLACKMAIL_SCANDAL_COST, 0, 100),
  });
  // P15: increment the owner's cumulative-weaponized-whispers counter. Read the
  // POST-write entry so the increment composes with the just-written scandal
  // bump above instead of clobbering it.
  const ownerAfterScandal = newHouses.get(owner.id) ?? owner;
  newHouses.set(owner.id, {
    ...ownerAfterScandal,
    cumulativeWeaponizedWhispers: ownerAfterScandal.cumulativeWeaponizedWhispers + 1,
  });
  // affectionMap[(playerHouseId, subjectCharacterId)] += BLACKMAIL_AFFECTION_BOOST (clamped)
  const key = makePairKey(owner.id, whisper.subjectCharacterId);
  const newAffection = new Map(state.affectionMap);
  const currentAff = newAffection.get(key) ?? 0;
  newAffection.set(key, clamp(currentAff + BLACKMAIL_AFFECTION_BOOST, 0, 100));
  // whisper status flip
  const newWhispers = new Map(state.whispers);
  newWhispers.set(whisper.id, {
    ...whisper,
    status: "Weaponized",
    weaponizedAs: "Blackmail",
    weaponizedAtTick: state.tick,
  });
  return {
    ok: true,
    state: { ...state, houses: newHouses, affectionMap: newAffection, whispers: newWhispers },
  };
}

function resolveScandalSheet(
  state: GameState,
  owner: ReturnType<typeof getHouseOrThrow>,
  whisper: Whisper,
): WeaponizeWhisperResult {
  const subject = getCharacterOrThrow(state, whisper.subjectCharacterId);
  // Apply SCANDAL_SHEET_REPUTATION_DROP to the subject's house (clamped)
  const subjectHouse = getHouseOrThrow(state, subject.houseId);
  // Draw 1 from owner's RNG for attribution roll
  const rngBefore = getOrThrow(state.rng, owner.id);
  const { next, rngState: rngAfter } = drawNext(rngBefore);
  const attributed = next < SCANDAL_SHEET_ATTRIBUTION_PROBABILITY;
  const newRng = new Map(state.rng);
  newRng.set(owner.id, rngAfter);
  const newHouses = new Map(state.houses);
  newHouses.set(subject.houseId, {
    ...subjectHouse,
    reputation: clamp(subjectHouse.reputation - SCANDAL_SHEET_REPUTATION_DROP, 0, 100),
  });
  if (attributed) {
    // On attribution → owner is exiled. The newHouses Map may already carry
    // the subject-house update; re-fetch the owner to extend with exiled:true.
    const updatedOwner = newHouses.get(owner.id) ?? owner;
    newHouses.set(owner.id, { ...updatedOwner, exiled: true });
  }
  // P15: increment the owner's cumulative-weaponized-whispers counter. Read the
  // POST-write entry (which may carry the exiled flag set above) so the
  // increment composes instead of clobbering the just-written owner state.
  const ownerAfterWrites = newHouses.get(owner.id) ?? owner;
  newHouses.set(owner.id, {
    ...ownerAfterWrites,
    cumulativeWeaponizedWhispers: ownerAfterWrites.cumulativeWeaponizedWhispers + 1,
  });
  const newWhispers = new Map(state.whispers);
  newWhispers.set(whisper.id, {
    ...whisper,
    status: "Weaponized",
    weaponizedAs: "ScandalSheet",
    weaponizedAtTick: state.tick,
    scandalSheetAttribution: attributed,
  });
  return {
    ok: true,
    state: { ...state, rng: newRng, houses: newHouses, whispers: newWhispers },
  };
}

function resolveAccidentalSlip(
  state: GameState,
  owner: ReturnType<typeof getHouseOrThrow>,
  whisper: Whisper,
): WeaponizeWhisperResult {
  // No upfront effect; the drip fires on subsequent conversation turns.
  const newWhispers = new Map(state.whispers);
  newWhispers.set(whisper.id, {
    ...whisper,
    status: "Weaponized",
    weaponizedAs: "AccidentalSlip",
    weaponizedAtTick: state.tick,
    accidentalSlipDripsRemaining: ACCIDENTAL_SLIP_DURATION_TICKS,
  });
  // P15: increment the owner's cumulative-weaponized-whispers counter. This
  // branch has NO existing houses clone, so add a fresh new Map clone.
  const newHouses = new Map(state.houses);
  newHouses.set(owner.id, {
    ...owner,
    cumulativeWeaponizedWhispers: owner.cumulativeWeaponizedWhispers + 1,
  });
  return { ok: true, state: { ...state, whispers: newWhispers, houses: newHouses } };
}

export function dismissWhisper(state: GameState, whisperId: WhisperId): DismissWhisperResult {
  const whisper = state.whispers.get(whisperId);
  if (whisper === undefined) {
    return { ok: false, reason: { kind: "WhisperNotFound", whisperId } };
  }
  if (whisper.status === "Weaponized" || whisper.status === "Dismissed") {
    return {
      ok: false,
      reason: { kind: "WhisperAlreadyTerminal", whisperId, currentStatus: whisper.status },
    };
  }
  const newWhispers = new Map(state.whispers);
  newWhispers.set(whisperId, { ...whisper, status: "Dismissed" });
  return { ok: true, state: { ...state, whispers: newWhispers } };
}

// Called from sendBallroomMessage's post-resolve block — same Immer-producer
// semantic is inlined as Immer-draft mutations there. This pure-rule mirror
// is the Vitest-testable shape; semantic-identity assertion via
// expect(applyAccidentalSlipDripOnConversation(...)).toEqual(simulatedSet).
export function applyAccidentalSlipDripOnConversation(
  state: GameState,
  conversationTargetCharId: CharacterId,
): GameState {
  let mutated = false;
  const newWhispers = new Map(state.whispers);
  const newHouses = new Map(state.houses);
  const sortedIds = [...newWhispers.keys()].sort();
  for (const id of sortedIds) {
    // biome-ignore lint/style/noNonNullAssertion: id from keys() always present
    const w = newWhispers.get(id)!;
    if (
      w.status !== "Weaponized" ||
      w.weaponizedAs !== "AccidentalSlip" ||
      w.accidentalSlipDripsRemaining <= 0 ||
      w.subjectCharacterId !== conversationTargetCharId
    ) {
      continue;
    }
    const subject = state.characters.get(w.subjectCharacterId);
    if (subject !== undefined) {
      const subjectHouse = newHouses.get(subject.houseId);
      if (subjectHouse !== undefined) {
        newHouses.set(subject.houseId, {
          ...subjectHouse,
          reputation: clamp(
            subjectHouse.reputation + ACCIDENTAL_SLIP_DRIP_PER_CONVERSATION,
            0,
            100,
          ),
        });
      }
    }
    newWhispers.set(id, {
      ...w,
      accidentalSlipDripsRemaining: w.accidentalSlipDripsRemaining - 1,
    });
    mutated = true;
  }
  return mutated ? { ...state, whispers: newWhispers, houses: newHouses } : state;
}

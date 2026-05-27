// P24a (C3, Q25): deliberate marriage dissolution (Abandonment / Divorce).
//
// Pure rule per CLAUDE.md non-negotiable #1. Modal-state gates (PlayerExiled /
// ElopementInProgress) live at the store-action wrapper; this rule owns the
// marriage-specific gates + effects. Dissolves the marriage with
// `viaAbandonment: true`, nulls BOTH spouses' marriageId, recomputes the
// surviving player-house spouse's role + archetype (reusing the P23
// recomputeWidowRole), applies scandal to the player house, and bumps a rival
// house's hostility if the abandoned spouse belongs to one (symmetric with the
// betrothal-break bump). The store wrapper direct-publishes MarriageDissolved
// (deceasedSpouseId: null marks the non-death dissolution — the event was
// designed forward-compat for divorce/annulment flows).

import { ABANDONMENT_RIVAL_HOSTILITY_BUMP, ABANDONMENT_SCANDAL } from "../constants";
import type { Character, GameState } from "../entities";
import { classifyArchetype } from "../fixtures/archetypes";
import { RIVAL_HOUSE_IDS_SET } from "../fixtures/rivals";
import type { CharacterId, MarriageId } from "../rng";
import { PLAYER_HOUSE_ID } from "../rng";
import { clamp } from "../util/clamp";
import { recomputeWidowRole } from "./aging";

export type AbandonMarriageRejection =
  | { kind: "MarriageNotFound" }
  | { kind: "MarriageAlreadyDissolved" }
  | { kind: "NotPlayerMarriage" };

export type AbandonMarriageResult =
  | { ok: true; nextState: GameState; survivingSpouseId: CharacterId }
  | { ok: false; reason: AbandonMarriageRejection };

export function applyAbandonMarriagePure(
  state: GameState,
  marriageId: MarriageId,
): AbandonMarriageResult {
  const marriage = state.marriages.get(marriageId);
  if (marriage === undefined) {
    return { ok: false, reason: { kind: "MarriageNotFound" } };
  }
  if (marriage.dissolved) {
    return { ok: false, reason: { kind: "MarriageAlreadyDissolved" } };
  }
  const spouseA = state.characters.get(marriage.spouseAId);
  const spouseB = state.characters.get(marriage.spouseBId);
  const aIsPlayer = spouseA?.houseId === PLAYER_HOUSE_ID;
  const bIsPlayer = spouseB?.houseId === PLAYER_HOUSE_ID;
  if (!aIsPlayer && !bIsPlayer) {
    return { ok: false, reason: { kind: "NotPlayerMarriage" } };
  }

  // Dissolve the marriage with the abandonment flag.
  const newMarriages = new Map(state.marriages);
  newMarriages.set(marriageId, {
    ...marriage,
    dissolved: true,
    dissolvedAtTick: state.tick,
    viaAbandonment: true,
  });

  // Null both spouses' marriageId; recompute role + archetype for player-house
  // spouses who were in the "Spouse" role (they re-enter the marriage market).
  const newCharacters = new Map(state.characters);
  for (const sid of [marriage.spouseAId, marriage.spouseBId]) {
    const c = newCharacters.get(sid);
    if (c === undefined) continue;
    let updated: Character = { ...c, marriageId: null };
    if (c.houseId === PLAYER_HOUSE_ID && c.role === "Spouse") {
      updated = { ...updated, role: recomputeWidowRole(updated) };
      updated = { ...updated, archetype: classifyArchetype(updated) };
    }
    newCharacters.set(sid, updated);
  }

  // Scandal to the player house; hostility bump if the abandoned spouse is a rival.
  const newHouses = new Map(state.houses);
  const playerHouse = newHouses.get(PLAYER_HOUSE_ID);
  if (playerHouse !== undefined) {
    newHouses.set(PLAYER_HOUSE_ID, {
      ...playerHouse,
      scandal: clamp(playerHouse.scandal + ABANDONMENT_SCANDAL, 0, 100),
    });
  }
  const otherSpouseId = aIsPlayer ? marriage.spouseBId : marriage.spouseAId;
  const otherSpouse = state.characters.get(otherSpouseId);
  if (otherSpouse !== undefined && RIVAL_HOUSE_IDS_SET.has(otherSpouse.houseId)) {
    const rivalHouse = newHouses.get(otherSpouse.houseId);
    if (rivalHouse !== undefined) {
      newHouses.set(otherSpouse.houseId, {
        ...rivalHouse,
        hostility: clamp(rivalHouse.hostility + ABANDONMENT_RIVAL_HOSTILITY_BUMP, 0, 100),
      });
    }
  }

  return {
    ok: true,
    nextState: { ...state, marriages: newMarriages, characters: newCharacters, houses: newHouses },
    survivingSpouseId: aIsPlayer ? marriage.spouseAId : marriage.spouseBId,
  };
}

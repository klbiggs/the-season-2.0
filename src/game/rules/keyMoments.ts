// P26 (G3): key-moment detection for Pro model routing. A "key moment" (spec §5
// "Model routing" — pre-wired at v1, activated here) routes the conversation to
// the more capable model. Pure, RNG-free: derived from current state at
// send-time. The server's routeModel maps a non-null keyMoment (or an empty
// history) to the Pro model.
//
// Priority proposal > duel > scheme (pinned). "audience" is wired into the enum
// as plumbing but NO v1.5 site emits it (there is no audience conversation
// mode) — it stays inert per the spec's "pre-wired but not active" phrasing.

import { AFFECTION_PROPOSAL_THRESHOLD } from "../constants";
import { makePairKey } from "../conversation/types";
import type { GameState } from "../entities";
import { type CharacterId, PLAYER_HOUSE_ID } from "../rng";
import { isAvailableForRemarriage } from "./elopement";

export type KeyMoment = "proposal" | "scheme" | "duel" | "audience";

export function computeKeyMoment(
  state: GameState,
  targetCharacterId: CharacterId,
): KeyMoment | null {
  const target = state.characters.get(targetCharacterId);
  if (target === undefined) return null;

  // proposal: affection at/above the propose threshold AND the target is
  // available to marry. Uses RAW affection (mirrors the propose gate).
  const pairKey = makePairKey(PLAYER_HOUSE_ID, targetCharacterId);
  const affection = state.affectionMap.get(pairKey) ?? 0;
  if (affection >= AFFECTION_PROPOSAL_THRESHOLD && isAvailableForRemarriage(target, state)) {
    return "proposal";
  }

  // duel: an unresolved grievance links the player house and the target's house
  // in either direction (player-perpetrated against the target house, or the
  // target house perpetrated against the player).
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  const targetHouse = state.houses.get(target.houseId);
  const playerVsTarget =
    playerHouse?.grievances.some((g) => !g.resolved && g.perpetratorHouseId === target.houseId) ??
    false;
  const targetVsPlayer =
    targetHouse?.grievances.some((g) => !g.resolved && g.perpetratorHouseId === PLAYER_HOUSE_ID) ??
    false;
  if (playerVsTarget || targetVsPlayer) {
    return "duel";
  }

  // scheme: an Active player-house scheme targets this character.
  for (const scheme of state.schemes.values()) {
    if (
      scheme.status === "Active" &&
      scheme.ownerHouseId === PLAYER_HOUSE_ID &&
      scheme.targetCharacterId === targetCharacterId
    ) {
      return "scheme";
    }
  }

  return null;
}

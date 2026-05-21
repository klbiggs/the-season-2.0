// P8: deterministic duel-id factory. Mirrors schemeIdFactory.ts / whisperIdFactory.ts.
// Format: `${challengerId}|${defenderId}|${tick}|${index}` where index is the
// per-(challenger, defender, tick) collision counter walking state.duels.values().
//
// Challenger and defender are NOT lex-sorted in the key — the directionality
// matters (player-as-challenger vs player-as-defender are distinct duels even
// against the same opponent on the same tick; v1 only the player-as-challenger
// path is reachable, but the factory is forward-compatible).

import type { GameState } from "../entities";
import type { CharacterId, DuelId } from "../rng";

export function makeDuelId(
  state: GameState,
  challengerId: CharacterId,
  defenderId: CharacterId,
): DuelId {
  let index = 0;
  for (const d of state.duels.values()) {
    if (
      d.challengerCharacterId === challengerId &&
      d.defenderCharacterId === defenderId &&
      d.initiatedAtTick === state.tick
    ) {
      index += 1;
    }
  }
  return `${challengerId}|${defenderId}|${state.tick}|${index}` as DuelId;
}

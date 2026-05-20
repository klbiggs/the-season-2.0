// P6: deterministic WhisperId factory. Whispers participate in the hash
// projection; UUID-based ids would break the replay-harness 30-run stability
// NFR. Format: `${sourceCharacterId}:${subjectCharacterId}:${tick}:${index}`
// where `index` is the count of existing whispers at this tick from this
// (source, subject) pair.
//
// **Partition by (source, subject)** so a single conversation can generate
// (a) the synergy whisper (source = NPC, subject = conversation target) AND
// (b) the wallflower-bonus whisper (source = same NPC, subject = different
// non-target NPC) WITHOUT colliding on index 0. Each pair gets its own
// counter; both whispers receive distinct ids.

import type { GameState } from "../entities";
import type { CharacterId, WhisperId } from "../rng";

export function makeWhisperId(
  state: GameState,
  sourceCharacterId: CharacterId,
  subjectCharacterId: CharacterId,
): WhisperId {
  // Walk state.whispers (never deleted; status flips only — every prior
  // whisper at this tick with the same (source, subject) increments index).
  // O(N) walk over state.whispers; acceptable at v1 (whispers count
  // measured in dozens). At scale (P11+ inherited secrets), consider a
  // per-(tick, source, subject) creation-count cache.
  let index = 0;
  for (const w of state.whispers.values()) {
    if (
      w.sourceCharacterId === sourceCharacterId &&
      w.subjectCharacterId === subjectCharacterId &&
      w.originatingTick === state.tick
    ) {
      index += 1;
    }
  }
  return `${sourceCharacterId}:${subjectCharacterId}:${state.tick}:${index}` as WhisperId;
}

// Deterministic SchemeId factory. Format:
//   `${ownerHouseId}:${kind}:${startedAtTick}:${index}`
// where `index` is the count of schemes already started by the same owner
// with the same kind on the same tick. This partitioning keeps two same-
// tick Sabotages against different targets distinct (`:0` and `:1`) while
// letting a same-tick Sabotage + Courting both use `:0` for their respective
// kinds.
//
// Why deterministic (not UUID): schemes participate in the hash projection
// via state.schemes; non-deterministic ids would break the replay-harness
// 30-run NFR (§8). Lex-sort across mixed-kind ids is alphabetical-by-kind-
// name (Assassination < Chaperone < Courting < Sabotage < Seduction <
// Smuggling) — NOT chronological. Implementer intuition: "first-started-
// first" is wrong; "first-alphabetically-by-kind" is correct.

import type { SchemeKind } from "../constants";
import type { GameState } from "../entities";
import type { HouseId, SchemeId } from "../rng";

export function makeSchemeId(
  state: GameState,
  ownerHouseId: HouseId,
  kind: SchemeKind,
): SchemeId {
  // Walk ALL schemes (Active + Completed + Cancelled + Failed) — schemes are
  // never deleted per CLAUDE.md "status flips only" invariant. The filter
  // partitions on (owner, kind, startedAtTick) so the index is per-bucket.
  // O(N) per start over the cumulative scheme registry; benign at P5's
  // expected ~1 scheme/tick volume.
  let index = 0;
  for (const s of state.schemes.values()) {
    if (s.ownerHouseId === ownerHouseId && s.kind === kind && s.startedAtTick === state.tick) {
      index += 1;
    }
  }
  return `${ownerHouseId}:${kind}:${state.tick}:${index}` as SchemeId;
}

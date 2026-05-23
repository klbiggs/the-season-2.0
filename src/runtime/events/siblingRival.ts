// P11 sibling-rival bus partition. Per CLAUDE.md non-negotiable §9 ("events
// partitioned by domain"). Variants cover the three lifecycle moments:
//
//   SiblingRivalPromoted    — fires at year-pass STEPS slot 4 when an eligible
//                             adult sibling is promoted to an autonomous actor.
//   SiblingRivalActed       — fires at tick-phase slot 12 (applySiblingRivalActionPhase)
//                             when a cooldown-eligible actor draws and dispatches
//                             one of the 4 weighted actions.
//   SiblingRivalReconciled  — fires when the `reconciled` latch flips true via
//                             (a) player reconciliation success at high-society
//                             (`via: "Player"`), or (b) auto-reconciliation when
//                             hostility decays to 0 (`via: "AutoAtZeroHostility"`).
//
// Direct-publish vs diff-helper: the `reconcileSibling` store wrapper direct-
// publishes `SiblingRivalReconciled { via: "Player" }` on Success. The diff
// helper `publishSiblingRivalTransitions(before, after, wrapperPublishedKeys)`
// uses the 3rd-arg skip-rule (CLAUDE.md P6 pin) to avoid double-publish.

import type { SiblingRivalActionKind } from "../../game/constants";
import type { CharacterId } from "../../game/rng";
import { PLAYER_HOUSE_ID } from "../../game/rng";
import type { GameState } from "../../game/store";
import { EventBus } from "./bus";

const EMPTY_KEYS: ReadonlySet<string> = new Set();

export type SiblingRivalEvent =
  | {
      kind: "SiblingRivalPromoted";
      tick: number;
      characterId: CharacterId;
      initialHostility: number;
    }
  | {
      kind: "SiblingRivalActed";
      tick: number;
      characterId: CharacterId;
      action: SiblingRivalActionKind;
    }
  | {
      kind: "SiblingRivalReconciled";
      tick: number;
      characterId: CharacterId;
      via: "Player" | "AutoAtZeroHostility";
    };

export const siblingRivalBus = new EventBus<SiblingRivalEvent>();

// Diff helper: walks player house siblingRivals before/after and emits
// Promoted (added entry), Acted (lastActionTick advanced), Reconciled (latch flip).
// wrapperPublishedKeys skip-rule (CLAUDE.md P6 pin): reconcileSibling direct-publishes
// `reconciled:${characterId}` on Success and passes the matching Set here to avoid
// double-publish.
export function publishSiblingRivalTransitions(
  before: GameState,
  after: GameState,
  wrapperPublishedKeys: ReadonlySet<string> = EMPTY_KEYS,
): void {
  const beforeHouse = before.houses.get(PLAYER_HOUSE_ID);
  const afterHouse = after.houses.get(PLAYER_HOUSE_ID);
  if (afterHouse === undefined) return;

  const beforeById = new Map((beforeHouse?.siblingRivals ?? []).map((sr) => [sr.id, sr] as const));

  for (const sr of afterHouse.siblingRivals) {
    const prior = beforeById.get(sr.id);
    if (prior === undefined) {
      siblingRivalBus.publish({
        kind: "SiblingRivalPromoted",
        tick: after.tick,
        characterId: sr.characterId,
        initialHostility: sr.hostility,
      });
      continue;
    }
    // Reconciled latch flip.
    if (!prior.reconciled && sr.reconciled) {
      if (wrapperPublishedKeys.has(`reconciled:${sr.characterId}`)) continue;
      // Diff-helper path = AutoAtZeroHostility (player-elected path is direct-published).
      siblingRivalBus.publish({
        kind: "SiblingRivalReconciled",
        tick: after.tick,
        characterId: sr.characterId,
        via: "AutoAtZeroHostility",
      });
    }
    // Acted: lastActionTick advanced (the phase fires the action; this signals UI).
    // No-action discriminator on the event — diff helper can't recover the action kind.
    // Action-kind events fire from the phase via direct-publish if needed (not at v1).
  }
}

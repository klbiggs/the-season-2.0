// P5: scheme launch buttons. Six buttons (one per SchemeKind) rendered
// adjacent to the tactic-buttons panel in the ballroom view. Per spec §3
// line 73: "Each ballroom session also surfaces buttons to start any of
// six schemes against the selected target."
//
// Disabled-state UX: per the plan's archetype-launch dead-state pin —
// Chaperone (requires Spymaster) and Assassination (requires BohemianRake
// or CountryExile) are functionally UNLAUNCHABLE at P5 because
// classifyArchetype returns "None" until P7. The buttons render disabled
// with the corresponding tooltip ("Requires X archetype in family") rather
// than via P5-only fake-classification debt.
//
// Smuggling has no target. Spec §3 line 357 ("Sets a one-shot blockade
// bypass flag") implies the action targets the BLOCKADE, not a person —
// the button reads `targetCharacterId: null`.

import { useState } from "react";
import { SCHEME_KINDS, SCHEME_PREREQUISITES, SCHEME_TUNING } from "../../game/constants";
import type { CharacterId } from "../../game/rng.seeds";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { SeasonStore } from "../../game/store";
import { ActionRejectionToast } from "../map/ActionRejectionToast";

type Props = {
  store: SeasonStore;
  selectedTargetId: CharacterId | null;
};

export function SchemeButtons({ store, selectedTargetId }: Props) {
  const houses = store((s) => s.houses);
  const characters = store((s) => s.characters);
  const era = store((s) => s.era);
  const startScheme = store((s) => s.startScheme);
  const [toast, setToast] = useState<string | null>(null);

  const playerHouse = houses.get(PLAYER_HOUSE_ID);
  if (playerHouse === undefined) return null;

  // For each kind, compute disabled state + tooltip. Render six buttons in
  // a row (or grid; CSS-driven).
  return (
    <div className="scheme-buttons">
      <div className="scheme-buttons__label">Schemes:</div>
      <div className="scheme-buttons__list">
        {SCHEME_KINDS.map((kind) => {
          const tuning = SCHEME_TUNING[kind];
          const acceptable = SCHEME_PREREQUISITES[kind];
          const targetForKind = kind === "Smuggling" ? null : selectedTargetId;

          // Disabled reasons. Check in player-relevant order: cheapest checks
          // first so the tooltip names the actionable rejection.
          let disabledReason: string | null = null;
          if (kind !== "Smuggling" && targetForKind === null) {
            disabledReason = "Select a target NPC";
          } else if (playerHouse.wealth < tuning.wealthCost) {
            disabledReason = `Insufficient wealth (need ${tuning.wealthCost}, have ${playerHouse.wealth})`;
          } else if (acceptable.length > 0) {
            const hasArchetype = [...characters.values()].some(
              (c) => c.houseId === PLAYER_HOUSE_ID && c.alive && acceptable.includes(c.archetype),
            );
            if (!hasArchetype) {
              // Spec §10 dead-state pin: Chaperone (Spymaster) +
              // Assassination (BohemianRake|CountryExile) unlaunchable
              // until P7 ships classifyArchetype.
              const archetypeLabel = acceptable.join(" or ");
              disabledReason = `Requires ${archetypeLabel} archetype in family — available after P7`;
            }
          } else if (kind === "Smuggling") {
            if (era !== "Earlier") {
              disabledReason = "Smuggling only available in the Earlier era";
            } else if (playerHouse.blockadeBypassEarned) {
              disabledReason = "Previous Smuggling pass not yet claimed";
            }
          } else if (targetForKind !== null) {
            const target = characters.get(targetForKind);
            if (target === undefined || !target.alive) {
              disabledReason = "Target is deceased";
            } else if (target.houseId === PLAYER_HOUSE_ID) {
              disabledReason = "Cannot target your own family";
            }
          }

          const onClick = () => {
            const result = startScheme({ kind, targetCharacterId: targetForKind });
            if (!result.ok) {
              // P21: surface the rule-layer rejection. Disabled-state gates the
              // common cases; this covers the race-rejections it can't (UI not
              // refreshed since the action was issued).
              setToast(`Cannot start ${kind}: ${result.reason.kind}.`);
            }
          };

          return (
            <button
              key={kind}
              type="button"
              className="scheme-buttons__button"
              disabled={disabledReason !== null}
              title={
                disabledReason ??
                `Cost: ${tuning.wealthCost} wealth · Duration: ${tuning.durationTicks} ticks`
              }
              onClick={onClick}
            >
              {kind}
            </button>
          );
        })}
      </div>
      {toast !== null && <ActionRejectionToast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

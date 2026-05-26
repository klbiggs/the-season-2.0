// P6: Spymaster mail-intercept affordance. The button is gated on a living
// Spymaster archetype in the player house (classifyArchetype ships at P7), so
// it is enabled whenever such a character exists. P21 surfaces the rule-layer
// rejection via a toast (was a swallowed console.warn).

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { SPYMASTER_INTERCEPT_WEALTH_COST } from "../../game/constants";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { SeasonStore } from "../../game/store";
import { ActionRejectionToast } from "../map/ActionRejectionToast";

type Props = {
  store: SeasonStore;
};

export function SpymasterInterceptCard({ store }: Props) {
  const { characters } = store(useShallow((s) => ({ characters: s.characters })));
  const spymasterIntercept = store((s) => s.spymasterIntercept);
  const [toast, setToast] = useState<string | null>(null);

  // Mirror the rule layer's NoLivingSpymaster check so the button reflects
  // whether the rule would accept the action.
  let hasSpymaster = false;
  for (const c of characters.values()) {
    if (c.houseId === PLAYER_HOUSE_ID && c.alive && c.archetype === "Spymaster") {
      hasSpymaster = true;
      break;
    }
  }

  return (
    <div className="spymaster-intercept-card">
      <h3 className="spymaster-intercept-card__title">Spymaster Mail Intercept</h3>
      <button
        type="button"
        className="spymaster-intercept-card__btn"
        disabled={!hasSpymaster}
        title={
          hasSpymaster
            ? `Drop the lex-smallest inbound courier targeting your house. Costs ${SPYMASTER_INTERCEPT_WEALTH_COST} wealth.`
            : "Requires a living Spymaster archetype in your family."
        }
        onClick={() => {
          const result = spymasterIntercept();
          if (!result.ok) {
            setToast(`Cannot intercept: ${result.reason.kind}.`);
          }
        }}
      >
        Intercept Inbound Mail ({SPYMASTER_INTERCEPT_WEALTH_COST} wealth)
      </button>
      {toast !== null && <ActionRejectionToast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

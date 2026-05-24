// P6: Spymaster mail-intercept affordance. At P6 the rule layer ships
// fully but classifyArchetype is stubbed at "None" until P7 — so the
// button is functionally disabled until P7 produces real archetypes.
// Tooltip explains the dependency.

import { useShallow } from "zustand/react/shallow";
import { SPYMASTER_INTERCEPT_WEALTH_COST } from "../../game/constants";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { SeasonStore } from "../../game/store";

type Props = {
  store: SeasonStore;
};

export function SpymasterInterceptCard({ store }: Props) {
  const { characters } = store(useShallow((s) => ({ characters: s.characters })));
  const spymasterIntercept = store((s) => s.spymasterIntercept);

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
            : "Requires a living Spymaster archetype in your family — available after P7 ships archetype classification."
        }
        onClick={() => {
          const result = spymasterIntercept();
          if (!result.ok) {
            console.warn("spymasterIntercept rejected:", result.reason);
          }
        }}
      >
        Intercept Inbound Mail ({SPYMASTER_INTERCEPT_WEALTH_COST} wealth)
      </button>
    </div>
  );
}

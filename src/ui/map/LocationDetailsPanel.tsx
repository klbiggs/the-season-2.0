import { useState } from "react";
import { COURIER_RESEARCH_WEALTH_COST } from "../../game/constants";
import {
  LOCATION_DESCRIPTIONS,
  LOCATION_LABELS,
  type LocationId,
} from "../../game/fixtures/locations";
import { type CharacterId, PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { hasActivePlayerElopement } from "../../game/rules/elopement";
import { getLocationDelta } from "../../game/rules/locationEffects";
import { eligiblePromenadePartners } from "../../game/rules/promenade";
import type { SeasonStore } from "../../game/store";
import { conversationOrchestrator } from "../../runtime/conversationOrchestrator";
import { ActionRejectionToast } from "./ActionRejectionToast";

// Right-side details panel. Shows the current location's name, description,
// per-tick deltas, and available actions. Conditional rendering per location:
// - All: "Stay here a while" (calls store.advanceTick — advances the STRATEGIC
//   tick only; the dynasty clock, aging/conception/succession, advances via the
//   map-level "Pass a Year" control / runYearPass, NOT this button. P20 relabel:
//   the old "Stay here a year" wording falsely implied a year-pass).
// - Country: "Liquidate Heirlooms" (only when wealth < 0).
// - Capital: "Request Audience" (only when canRequestAudience.ok) +
//            "Refresh Wardrobe" (always available; wealth warning is
//            informational, not gated per spec §7 wardrobe-during-bankruptcy).

type Props = {
  store: SeasonStore;
  location: LocationId;
  // P26: the approaching NPC id (from enterBallroom's return) is threaded to
  // the App so BallroomView can pre-select the approacher.
  onEnterBallroom?: ((approachingCharacterId: CharacterId | null) => void) | undefined;
  onEnterPromenade?: (() => void) | undefined;
};

export function LocationDetailsPanel({
  store,
  location,
  onEnterBallroom,
  onEnterPromenade,
}: Props) {
  const house = store((s) => s.houses.get(PLAYER_HOUSE_ID));
  const [toast, setToast] = useState<string | null>(null);
  const consecutiveTicks = house?.consecutiveTicksAtCurrentLocation ?? 0;
  const wealth = house?.wealth ?? 0;
  const reputation = house?.reputation ?? 0;
  const lastAudienceTick = house?.lastAudienceTick ?? null;
  const tick = store((s) => s.tick);
  const delta = getLocationDelta(location);
  // P12: read full state to derive promenade-affordance availability.
  const fullState = store();

  const showLiquidate = location === "Country" && wealth < 0;
  const showAudience = location === "Capital";
  const showWardrobe = location === "Capital";
  // P13: courier-research button — only at Capital, only when Later era is
  // live, only when not already earned, only when wealth >= cost. The
  // researchFastCouriers store action gates these conditions at the rule
  // layer too; the UI gate is the friendlier surface.
  const showCourierResearch =
    location === "Capital" && fullState.era === "Later" && house?.courierResearchEarned === false;
  const courierResearchAffordable = wealth >= COURIER_RESEARCH_WEALTH_COST;
  // P12 promenade-button gating. Surface tooltips for each blocked branch
  // so the player sees WHY the button is disabled.
  const showPromenade = location === "Capital" && onEnterPromenade !== undefined;
  const promenadeBlockedReason =
    house?.exiled === true
      ? "Your house is exiled."
      : hasActivePlayerElopement(fullState)
        ? "An elopement is in progress."
        : conversationOrchestrator.currentMode() !== null
          ? "A conversation is already in progress."
          : eligiblePromenadePartners(fullState).length === 0
            ? "No one of consequence is in Hyde Park today."
            : "";
  const promenadeDisabled = promenadeBlockedReason !== "";

  const canAudience =
    reputation >= 30 && (lastAudienceTick === null || tick - lastAudienceTick >= 30);

  return (
    <aside
      className="flex flex-col gap-3 rounded-lg border border-stone-300 bg-white p-4 shadow-sm"
      data-testid="location-details-panel"
    >
      <h2 className="text-lg font-semibold text-stone-800">{LOCATION_LABELS[location]}</h2>
      <p className="text-sm text-stone-600">{LOCATION_DESCRIPTIONS[location]}</p>

      <div className="text-xs text-stone-500 grid grid-cols-3 gap-2">
        <div>
          Wealth/tick:{" "}
          <span className={delta.wealth >= 0 ? "text-emerald-700" : "text-rose-700"}>
            {delta.wealth >= 0 ? "+" : ""}
            {delta.wealth}
          </span>
        </div>
        <div>
          Rep/tick:{" "}
          <span className={delta.reputation >= 0 ? "text-emerald-700" : "text-rose-700"}>
            {delta.reputation >= 0 ? "+" : ""}
            {delta.reputation}
          </span>
        </div>
        <div>
          Scandal/tick:{" "}
          <span className={delta.scandal <= 0 ? "text-emerald-700" : "text-rose-700"}>
            {delta.scandal >= 0 ? "+" : ""}
            {delta.scandal}
          </span>
        </div>
      </div>

      {location === "Country" && (
        <div className="text-xs text-stone-500" data-testid="rustic-progress">
          Consecutive years here: <span className="font-medium">{consecutiveTicks}</span> / 5
        </div>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => store.getState().advanceTick()}
          className="px-3 py-2 rounded bg-stone-700 text-white hover:bg-stone-800 text-sm"
          data-testid="location-details-stay"
          title="Advances the strategic clock by one tick (location income, scheme/courier resolution). Does NOT age the family — use “Pass a Year” for conception and succession."
        >
          Stay here a while
        </button>
        {showLiquidate && (
          <button
            type="button"
            onClick={() => store.getState().escapeBankruptcy()}
            className="px-3 py-2 rounded bg-amber-700 text-white hover:bg-amber-800 text-sm"
            data-testid="location-details-liquidate"
          >
            Liquidate Heirlooms (+50 wealth, +5 scandal)
          </button>
        )}
        {showAudience && (
          <button
            type="button"
            onClick={() => store.getState().requestAudience()}
            disabled={!canAudience}
            className="px-3 py-2 rounded bg-indigo-700 text-white hover:bg-indigo-800 disabled:bg-stone-200 disabled:text-stone-400 text-sm"
            data-testid="location-details-audience"
          >
            Request Audience with the Monarch
          </button>
        )}
        {showWardrobe && (
          <button
            type="button"
            onClick={() => store.getState().refreshWardrobe()}
            className="px-3 py-2 rounded bg-rose-700 text-white hover:bg-rose-800 text-sm"
            data-testid="location-details-wardrobe"
          >
            Refresh Wardrobe (−20 wealth)
          </button>
        )}
        {/* P13: Later-era one-shot courier research action. Halves the
            transit time of all new outbound couriers. In-flight couriers
            retain their absolute arrivalTick. Free action — no tick cost. */}
        {showCourierResearch && (
          <button
            type="button"
            disabled={!courierResearchAffordable}
            onClick={() => store.getState().researchFastCouriers()}
            className="px-3 py-2 rounded bg-sky-700 text-white hover:bg-sky-800 disabled:bg-stone-200 disabled:text-stone-400 text-sm"
            data-testid="location-details-courier-research"
          >
            Research Fast Couriers (−{COURIER_RESEARCH_WEALTH_COST} wealth, halves new transit)
          </button>
        )}
        {/* P4: Enter Ballroom action — only at Capital. Calls
            enterBallroom which validates "at Capital" again at the
            rule layer + publishes BallroomEntered. */}
        {location === "Capital" && onEnterBallroom !== undefined && (
          <button
            type="button"
            onClick={() => {
              const result = store.getState().enterBallroom();
              if (result.ok) onEnterBallroom(result.approachingCharacterId);
              // P21: surface the rejection (was swallowed). Realistic reachable
              // case is the SessionAlreadyOpen race.
              else setToast(`Cannot enter the ballroom: ${result.reason.kind}.`);
            }}
            className="px-3 py-2 rounded bg-purple-700 text-white hover:bg-purple-800 text-sm"
            data-testid="location-details-enter-ballroom"
          >
            Enter the Ballroom
          </button>
        )}
        {/* P12: Promenade action — only at Capital. Calls enterPromenade
            which validates location + cross-mode gates + picks the partner
            (1 player-RNG draw). On ok:true, App flips inPromenade → true
            and PromenadeView mounts. */}
        {showPromenade && (
          <button
            type="button"
            disabled={promenadeDisabled}
            title={promenadeBlockedReason}
            onClick={() => {
              const result = store.getState().enterPromenade();
              if (result.ok && onEnterPromenade !== undefined) onEnterPromenade();
            }}
            className="px-3 py-2 rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-stone-200 disabled:text-stone-400 text-sm"
            data-testid="location-details-enter-promenade"
          >
            Take a Promenade in Hyde Park (1 tick)
          </button>
        )}
      </div>
      {toast !== null && <ActionRejectionToast message={toast} onDismiss={() => setToast(null)} />}
    </aside>
  );
}

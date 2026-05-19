import {
  LOCATION_DESCRIPTIONS,
  LOCATION_LABELS,
  type LocationId,
} from "../../game/fixtures/locations";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { getLocationDelta } from "../../game/rules/locationEffects";
import type { SeasonStore } from "../../game/store";

// Right-side details panel. Shows the current location's name, description,
// per-tick deltas, and available actions. Conditional rendering per location:
// - All: "Stay here a year" (calls store.advanceTick directly).
// - Country: "Liquidate Heirlooms" (only when wealth < 0).
// - Capital: "Request Audience" (only when canRequestAudience.ok) +
//            "Refresh Wardrobe" (always available; wealth warning is
//            informational, not gated per spec §7 wardrobe-during-bankruptcy).

type Props = {
  store: SeasonStore;
  location: LocationId;
  onEnterBallroom?: (() => void) | undefined;
};

export function LocationDetailsPanel({ store, location, onEnterBallroom }: Props) {
  const house = store((s) => s.houses.get(PLAYER_HOUSE_ID));
  const consecutiveTicks = house?.consecutiveTicksAtCurrentLocation ?? 0;
  const wealth = house?.wealth ?? 0;
  const reputation = house?.reputation ?? 0;
  const lastAudienceTick = house?.lastAudienceTick ?? null;
  const tick = store((s) => s.tick);
  const delta = getLocationDelta(location);

  const showLiquidate = location === "Country" && wealth < 0;
  const showAudience = location === "Capital";
  const showWardrobe = location === "Capital";

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
        >
          Stay here a year
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
        {/* P4: Enter Ballroom action — only at Capital. Calls
            enterBallroom which validates "at Capital" again at the
            rule layer + publishes BallroomEntered. */}
        {location === "Capital" && onEnterBallroom !== undefined && (
          <button
            type="button"
            onClick={() => {
              const result = store.getState().enterBallroom();
              if (result.ok) onEnterBallroom();
            }}
            className="px-3 py-2 rounded bg-purple-700 text-white hover:bg-purple-800 text-sm"
            data-testid="location-details-enter-ballroom"
          >
            Enter the Ballroom
          </button>
        )}
      </div>
    </aside>
  );
}

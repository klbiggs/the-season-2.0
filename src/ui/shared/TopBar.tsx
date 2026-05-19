import { LOCATION_LABELS } from "../../game/fixtures/locations";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { SeasonStore } from "../../game/store";

// Campaign-meta header. Always-mounted persistent chrome above the map.
//
// Head-age lookup uses the two-step s.houses → s.characters pattern from
// the dev-shell <HeadAgeReadout />. Optional-chaining tolerates the
// transient between replaceState calls where one Map is updated but the
// next isn't (the pure-rules layer uses getCharacterOrThrow; the UI cannot
// afford a mid-render throw without an error boundary). Post-succession
// the lookup naturally returns the newly-promoted head's age.

type Props = {
  store: SeasonStore;
};

export function TopBar({ store }: Props) {
  const tick = store((s) => s.tick);
  const campaignName = store((s) => s.campaignName);
  const headAge = store((s) => {
    const house = s.houses.get(PLAYER_HOUSE_ID);
    if (house === undefined) return null;
    const head = s.characters.get(house.headOfHouseCharacterId);
    return head?.age ?? null;
  });
  const currentLocation = store((s) => s.houses.get(PLAYER_HOUSE_ID)?.currentLocation ?? null);
  return (
    <header className="w-full bg-stone-100 border-b border-stone-300 px-6 py-3 flex items-center gap-6">
      <h1 className="text-lg font-semibold text-stone-800 flex-1" data-testid="campaign-name">
        {campaignName}
      </h1>
      <div className="text-sm text-stone-600" data-testid="current-location-label">
        Location:{" "}
        <span className="font-medium text-stone-800">
          {currentLocation === null ? "—" : LOCATION_LABELS[currentLocation]}
        </span>
      </div>
      <div className="text-sm text-stone-600" data-testid="head-age-readout">
        Head age: <span className="font-medium text-stone-800">{headAge ?? "—"}</span>
      </div>
      <div className="text-sm text-stone-600" data-testid="tick-readout">
        Tick: <span className="font-medium text-stone-800">{tick}</span>
      </div>
    </header>
  );
}

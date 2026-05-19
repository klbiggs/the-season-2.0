// Dev-only UI shell for P0-P1. The entire `src/ui/dev/` directory is deleted
// when P3 ships the strategy map.

import { useEffect, useState } from "react";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { SeasonStore } from "../../game/store";
import { HeadAgeReadout } from "./HeadAgeReadout";
import { LoadButton } from "./LoadButton";
import { SaveButton } from "./SaveButton";
import { SeedPrompt } from "./SeedPrompt";
import { TickButton } from "./TickButton";
import { TickReadout } from "./TickReadout";
import { YearPassButton } from "./YearPassButton";

type Props = { store: SeasonStore };

export function DevApp({ store }: Props) {
  const tick = store((s) => s.tick);
  // Optional-chain form tolerates the transient between replaceState calls
  // where one Map is updated but the next isn't. The pure-rules layer uses
  // getCharacterOrThrow (throws on missing); the UI cannot afford a
  // mid-render throw without an error boundary.
  const headAge = store((s) => {
    const house = s.houses.get(PLAYER_HOUSE_ID);
    if (house === undefined) return null;
    const head = s.characters.get(house.headOfHouseCharacterId);
    return head?.age ?? null;
  });
  const [statusMessage, setStatusMessage] = useState<string>("");

  useEffect(() => {
    if (statusMessage === "") return;
    const timer = window.setTimeout(() => setStatusMessage(""), 2_000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8 bg-stone-50">
      <h1 className="text-2xl font-semibold text-stone-800">The Season — P1 dev scaffold</h1>
      <TickReadout tick={tick} />
      <HeadAgeReadout age={headAge} />
      <div className="flex flex-wrap gap-3 items-center justify-center">
        <TickButton store={store} />
        <YearPassButton store={store} />
        <SaveButton store={store} onStatus={setStatusMessage} />
        <LoadButton store={store} onStatus={setStatusMessage} />
        <SeedPrompt store={store} onStatus={setStatusMessage} />
      </div>
      <p aria-live="polite" className="text-sm text-stone-600 min-h-[1.25rem]" data-testid="status">
        {statusMessage}
      </p>
    </main>
  );
}

// Dev-only UI shell for P0. The entire `src/ui/dev/` directory is deleted
// when P3 ships the strategy map — see the P0 plan's UI scope.

import { useEffect, useState } from "react";
import type { SeasonStore } from "../../game/store";
import { LoadButton } from "./LoadButton";
import { SaveButton } from "./SaveButton";
import { SeedPrompt } from "./SeedPrompt";
import { TickButton } from "./TickButton";
import { TickReadout } from "./TickReadout";

type Props = { store: SeasonStore };

export function DevApp({ store }: Props) {
  const tick = store((s) => s.tick);
  const [statusMessage, setStatusMessage] = useState<string>("");

  useEffect(() => {
    if (statusMessage === "") return;
    const timer = window.setTimeout(() => setStatusMessage(""), 2_000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-8 bg-stone-50">
      <h1 className="text-2xl font-semibold text-stone-800">The Season — P0 dev scaffold</h1>
      <TickReadout tick={tick} />
      <div className="flex flex-wrap gap-3 items-center justify-center">
        <TickButton store={store} />
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

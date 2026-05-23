// Player shell. Mounts the persistent chrome (TopBar + SettingsMenu) and
// the main view (MapView at P3; BallroomView overlay at P4; elopement/
// ledger add overlays in later phases).

import { useEffect, useState } from "react";
import type { SeasonStore } from "./game/store";
import type { SaveLoadError } from "./persist/errors";
import { BallroomView } from "./ui/ballroom/BallroomView";
import { ElopementOverlay } from "./ui/elopement/ElopementOverlay";
import { MapView } from "./ui/map/MapView";
import { PromenadeView } from "./ui/promenade/PromenadeView";
import { CorruptSaveBanner } from "./ui/shared/CorruptSaveBanner";
import { SettingsMenu } from "./ui/shared/SettingsMenu";
import { TopBar } from "./ui/shared/TopBar";

type Props = {
  store: SeasonStore;
  // Launch-time seed, threaded from main.tsx. Used by <CorruptSaveBanner />'s
  // "Start New Game" handler — the store doesn't track a top-level campaign
  // seed; the original launch-time seed is the source of truth.
  seed: string;
};

export function App({ store, seed }: Props) {
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [loadError, setLoadError] = useState<SaveLoadError | null>(null);
  const [inBallroom, setInBallroom] = useState(false);
  const [inPromenade, setInPromenade] = useState(false);
  const elopement = store((s) => s.elopement);

  useEffect(() => {
    if (statusMessage === "") return;
    const timer = window.setTimeout(() => setStatusMessage(""), 2_000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  return (
    <main className="min-h-screen flex flex-col bg-stone-50">
      <div className="flex items-center gap-4 px-6 py-2 border-b border-stone-200 bg-white">
        <TopBar store={store} />
        <SettingsMenu store={store} onStatus={setStatusMessage} onLoadError={setLoadError} />
      </div>
      <CorruptSaveBanner
        error={loadError}
        store={store}
        seed={seed}
        onDismiss={() => setLoadError(null)}
      />
      <p
        aria-live="polite"
        className="text-sm text-stone-600 min-h-[1.25rem] px-6"
        data-testid="status"
      >
        {statusMessage}
      </p>
      {elopement !== null ? (
        <ElopementOverlay store={store} />
      ) : inBallroom ? (
        <BallroomView store={store} onExit={() => setInBallroom(false)} />
      ) : inPromenade ? (
        <PromenadeView store={store} onExit={() => setInPromenade(false)} />
      ) : (
        <MapView
          store={store}
          onEnterBallroom={() => setInBallroom(true)}
          onEnterPromenade={() => setInPromenade(true)}
        />
      )}
    </main>
  );
}

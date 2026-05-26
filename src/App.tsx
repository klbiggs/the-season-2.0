// Player shell. Mounts the persistent chrome (TopBar + SettingsMenu + the
// cross-view exile banner) and the main view (MapView at P3; BallroomView /
// PromenadeView / LedgerView overlays + the elopement overlay).

import { useEffect, useState } from "react";
import { PLAYER_HOUSE_ID } from "./game/rng.seeds";
import type { SeasonStore } from "./game/store";
import type { SaveLoadError } from "./persist/errors";
import { elopementBus } from "./runtime/events/elopement";
import { useBusEvent } from "./runtime/events/useBusEvent";
import { BallroomView } from "./ui/ballroom/BallroomView";
import { ElopementOverlay } from "./ui/elopement/ElopementOverlay";
import { LedgerView } from "./ui/ledger/LedgerView";
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
  const [inLedger, setInLedger] = useState(false);
  const elopement = store((s) => s.elopement);
  // P14: exile flag hoisted from MapView so the banner surfaces across every
  // view. Renders unconditionally above the view-routing block when true.
  const isExiled = store((s) => s.houses.get(PLAYER_HOUSE_ID)?.exiled === true);

  // P20: elopement Won/Lost outcome surface. The ElopementOverlay unmounts the
  // instant state.elopement → null, so the outcome must live on App's
  // persistent chrome (not the overlay). Subscribed here; dismissed by the
  // player. The diff publisher fires ElopementResolved AFTER the sprint
  // resolves (runtime/events/elopement.ts).
  const [elopementResult, setElopementResult] = useState<{
    outcome: "Won" | "Lost";
    marriageMinted: boolean;
    reputationDelta: number;
    scandalDelta: number;
  } | null>(null);
  useBusEvent(elopementBus, "ElopementResolved", (e) => {
    setElopementResult({
      outcome: e.outcome,
      marriageMinted: e.marriageMinted,
      reputationDelta: e.reputationDelta,
      scandalDelta: e.scandalDelta,
    });
  });

  useEffect(() => {
    if (statusMessage === "") return;
    const timer = window.setTimeout(() => setStatusMessage(""), 2_000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  return (
    <main className="min-h-screen flex flex-col bg-stone-50">
      <div className="flex items-center gap-4 px-6 py-2 border-b border-stone-200 bg-white">
        <TopBar store={store} onEnterLedger={() => setInLedger(true)} />
        <SettingsMenu store={store} onStatus={setStatusMessage} onLoadError={setLoadError} />
      </div>
      {isExiled && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-red-900 text-white px-6 py-3 font-bold text-center"
          data-testid="exile-banner"
        >
          House Exiled — Campaign Ended. Start a new game from the Settings menu.
        </div>
      )}
      {elopementResult !== null && (
        <div
          role="alert"
          aria-live="assertive"
          className={`flex items-center justify-between gap-4 px-6 py-3 font-medium ${
            elopementResult.outcome === "Won"
              ? "bg-emerald-700 text-emerald-50"
              : "bg-rose-800 text-rose-50"
          }`}
          data-testid="elopement-outcome-banner"
          data-outcome={elopementResult.outcome}
        >
          <span>
            {elopementResult.outcome === "Won"
              ? `Elopement successful! ${
                  elopementResult.marriageMinted
                    ? "A marriage is made."
                    : "No new marriage was minted (a party was already wed)."
                } The scandal halved your house's reputation (${elopementResult.reputationDelta}).`
              : `The elopement failed — the father overtook them. +${elopementResult.scandalDelta} scandal.`}
          </span>
          <button
            type="button"
            onClick={() => setElopementResult(null)}
            className="shrink-0 rounded border border-white/40 px-2 py-0.5 text-sm hover:bg-white/10"
            data-testid="elopement-outcome-dismiss"
          >
            Dismiss
          </button>
        </div>
      )}
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
      ) : inLedger ? (
        <LedgerView store={store} onExit={() => setInLedger(false)} />
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

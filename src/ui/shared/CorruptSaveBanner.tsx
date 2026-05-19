import { type SeasonStore, createInitialState } from "../../game/store";
import type { SaveLoadError } from "../../persist/errors";

// Player-shell corrupt-save banner. Identical aria/data-testid contract to
// the deleted dev-shell banner (testIds carry forward verbatim so the
// Playwright corrupt-save block keeps working).
//
// "Start New Game" calls replaceState with a fresh createInitialState using
// the launch-time seed threaded from main.tsx. Does NOT delete the corrupt
// IndexedDB record — a re-Load can re-surface the banner.

type Props = {
  error: SaveLoadError | null;
  store: SeasonStore;
  seed: string;
  onDismiss: () => void;
};

export function CorruptSaveBanner({ error, store, seed, onDismiss }: Props) {
  if (error === null) return null;
  const onStartNewGame = () => {
    store.getState().replaceState(createInitialState(seed));
    onDismiss();
  };
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="w-full max-w-2xl mx-auto p-4 rounded border border-red-300 bg-red-50 text-red-900 flex items-center gap-3"
      data-testid="corrupt-save-banner"
    >
      <span className="flex-1">{error.userMessage}</span>
      <button
        type="button"
        onClick={onStartNewGame}
        className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
        data-testid="corrupt-save-start-new"
      >
        Start New Game
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="px-2 py-1 text-red-700 hover:text-red-900"
        data-testid="corrupt-save-dismiss"
      >
        ×
      </button>
    </div>
  );
}

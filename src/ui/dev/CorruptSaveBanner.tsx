import type { SeasonStore } from "../../game/store";
import { createInitialState } from "../../game/store";
import type { SaveLoadError } from "../../persist/errors";

// Renders a sticky alert banner when a load attempt produces a typed
// SaveLoadError. "Start New Game" calls replaceState with a fresh
// createInitialState, using the seed threaded down from main.tsx → DevApp
// → here (the store doesn't track a top-level campaign seed; the original
// launch-time seed is the source of truth).
//
// Note: "Start New Game" does NOT delete the corrupt IndexedDB record.
// A re-Load will re-surface the banner. Auto-delete needs explicit consent
// UI; P3+ may add that affordance. For P2 (dev-only), this is acceptable.
//
// Styling is plain Tailwind, matching the rest of src/ui/dev/. Real-shell
// banner successor (P3+) may use shadcn's <Alert>.
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

import { useState } from "react";
import { DEFAULT_SEED } from "../../game/rng.seeds";
import { type SeasonStore, createInitialState } from "../../game/store";

type Props = {
  store: SeasonStore;
  onStatus: (message: string) => void;
};

export function SeedPrompt({ store, onStatus }: Props) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState(DEFAULT_SEED);

  const apply = () => {
    store.getState().replaceState(createInitialState(seed));
    onStatus(`Reset with seed "${seed}".`);
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded bg-stone-200 text-stone-800 hover:bg-stone-300"
        data-testid="seed-prompt-open"
      >
        Reseed
      </button>
    );
  }

  return (
    <div className="flex gap-2 items-center" data-testid="seed-prompt">
      <input
        type="text"
        value={seed}
        onChange={(e) => setSeed(e.target.value)}
        className="px-2 py-1 border border-stone-300 rounded"
        data-testid="seed-prompt-input"
      />
      <button
        type="button"
        onClick={apply}
        className="px-3 py-1 rounded bg-stone-800 text-stone-50"
        data-testid="seed-prompt-apply"
      >
        Apply
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="px-3 py-1 rounded bg-stone-200 text-stone-800"
      >
        Cancel
      </button>
    </div>
  );
}

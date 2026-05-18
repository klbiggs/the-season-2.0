import { useState } from "react";
import { type SeasonStore, selectGameState } from "../../game/store";
import { DEV_SLOT, save } from "../../persist/dexie";

type Props = {
  store: SeasonStore;
  onStatus: (message: string) => void;
};

export function SaveButton({ store, onStatus }: Props) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      await save(DEV_SLOT, selectGameState(store.getState()));
      onStatus("Saved.");
    } catch (err) {
      onStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="px-4 py-2 rounded bg-stone-200 text-stone-800 hover:bg-stone-300 disabled:opacity-50"
      data-testid="save-button"
    >
      Save
    </button>
  );
}

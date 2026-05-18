import { useState } from "react";
import type { SeasonStore } from "../../game/store";
import { DEV_SLOT, load } from "../../persist/dexie";
import { fromSaveV1 } from "../../persist/schema";

type Props = {
  store: SeasonStore;
  onStatus: (message: string) => void;
};

export function LoadButton({ store, onStatus }: Props) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    setBusy(true);
    try {
      const saved = await load(DEV_SLOT);
      if (saved === undefined) {
        onStatus("No save in slot 'dev'.");
        return;
      }
      store.getState().replaceState(fromSaveV1(saved));
      onStatus("Loaded.");
    } catch (err) {
      onStatus(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
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
      data-testid="load-button"
    >
      Load
    </button>
  );
}

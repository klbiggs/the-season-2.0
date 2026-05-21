import { useState } from "react";
import { type SeasonStore, selectGameState } from "../../game/store";
import { DEV_SLOT, load, save } from "../../persist/dexie";
import { SaveLoadError } from "../../persist/errors";
import { fromSaveV9 } from "../../persist/schema";

// Settings menu dropdown. Houses Save / Load / Pass Year affordances that
// were free-floating in the dev shell. Year-pass becomes an in-menu action
// rather than a top-level button.
//
// Save/Load errors are caught and surfaced via onLoadError (for typed
// SaveLoadError variants) or onStatus (for unrecognized failures).

type Props = {
  store: SeasonStore;
  onStatus: (message: string) => void;
  onLoadError: (err: SaveLoadError | null) => void;
};

export function SettingsMenu({ store, onStatus, onLoadError }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    setBusy(true);
    try {
      await save(DEV_SLOT, selectGameState(store.getState()));
      onStatus("Saved.");
    } catch (err) {
      onStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const onLoad = async () => {
    setBusy(true);
    try {
      const saved = await load(DEV_SLOT);
      if (saved === undefined) {
        onStatus("No save in slot 'dev'.");
        return;
      }
      store.getState().replaceState(fromSaveV9(saved));
      onLoadError(null);
      onStatus("Loaded.");
    } catch (err) {
      if (err instanceof SaveLoadError) {
        onLoadError(err);
      } else {
        onStatus(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const onPassYear = () => {
    store.getState().runYearPass();
    onStatus("Year passed.");
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="px-3 py-1 rounded bg-stone-200 hover:bg-stone-300 text-stone-800 text-sm"
        onClick={() => setOpen(!open)}
        data-testid="settings-menu-trigger"
      >
        ☰ Settings
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 rounded border border-stone-300 bg-white shadow-md text-sm">
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="block w-full px-3 py-2 text-left hover:bg-stone-100 disabled:opacity-50"
            data-testid="settings-menu-save"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onLoad}
            disabled={busy}
            className="block w-full px-3 py-2 text-left hover:bg-stone-100 disabled:opacity-50"
            data-testid="settings-menu-load"
          >
            Load
          </button>
          <button
            type="button"
            onClick={onPassYear}
            disabled={busy}
            className="block w-full px-3 py-2 text-left hover:bg-stone-100 disabled:opacity-50"
            data-testid="settings-menu-pass-year"
          >
            Pass Year
          </button>
        </div>
      )}
    </div>
  );
}

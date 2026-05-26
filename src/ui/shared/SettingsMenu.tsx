import { useState } from "react";
import { type SeasonStore, selectGameState } from "../../game/store";
import { DEV_SLOT, load, resetSave, save } from "../../persist/dexie";
import { SaveLoadError } from "../../persist/errors";
import { fromSaveV1 } from "../../persist/schema";
import { seedLoreCorpus, setActiveSlot } from "../../runtime/semanticIndex";

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
      store.getState().replaceState(fromSaveV1(saved));
      // P17: re-point the vector-index slot + backfill lore (idempotent; inert
      // unless semantic memory is enabled).
      setActiveSlot(DEV_SLOT);
      void seedLoreCorpus(DEV_SLOT);
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

  // Dev-only destructive reset: a two-click inline confirm (no blocking
  // window.confirm). Deletes the IndexedDB save, then reloads so the app
  // re-bootstraps a fresh campaign (main.tsx boots from createStore, not a
  // load). This is the browser-side replacement for the never-shipped
  // `reset-save` script (Node can't reach browser IndexedDB — P19 D3).
  const [confirmReset, setConfirmReset] = useState(false);
  const onResetSave = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setBusy(true);
    try {
      await resetSave();
      window.location.reload();
    } catch (err) {
      onStatus(`Reset failed: ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
      setConfirmReset(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="px-3 py-1 rounded bg-stone-200 hover:bg-stone-300 text-stone-800 text-sm"
        onClick={() => {
          setOpen(!open);
          setConfirmReset(false); // disarm the reset confirm on every open/close
        }}
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
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={onResetSave}
              disabled={busy}
              className="block w-full border-t border-stone-200 px-3 py-2 text-left text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              data-testid="settings-menu-reset-save"
            >
              {confirmReset ? "Reset Save — confirm?" : "Reset Save (dev)"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

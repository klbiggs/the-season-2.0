// BYOK key entry panel. Password-masked input; on save, store in
// KeyContext (in-memory, never persisted). Validates shape with
// isValidKeyShape (`/^AIza/`) before accepting.

import { useState } from "react";
import { isValidKeyShape } from "../../llm/client";
import { useApiKey } from "./KeyContext";

export function KeyEntryPanel() {
  const { key, setKey, clearKey } = useApiKey();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const onSave = () => {
    if (!isValidKeyShape(draft)) {
      setError("Key must start with 'AIza' (Google AI Studio key format).");
      return;
    }
    setError("");
    setKey(draft);
    setDraft("");
  };

  return (
    <div
      className="flex flex-col gap-2 rounded border border-stone-300 bg-white p-3"
      data-testid="key-entry-panel"
    >
      <h3 className="text-sm font-semibold text-stone-800">Gemini API key (BYOK)</h3>
      <p className="text-xs text-stone-500">
        Stored in-memory only. Refresh = clear. Never written to disk.
      </p>
      {key === null ? (
        <>
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="AIza…"
            className="rounded border border-stone-300 px-2 py-1 text-sm"
            data-testid="key-entry-input"
          />
          {error !== "" && (
            <p className="text-xs text-rose-700" data-testid="key-entry-error">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onSave}
            className="rounded bg-stone-700 px-3 py-1 text-sm text-white hover:bg-stone-800"
            data-testid="key-entry-save"
          >
            Save key
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-stone-600" data-testid="key-entry-set">
            Key set ({key.slice(0, 8)}…). Conversation enabled.
          </p>
          <button
            type="button"
            onClick={clearKey}
            className="self-start rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-100"
            data-testid="key-entry-clear"
          >
            Clear key
          </button>
        </>
      )}
    </div>
  );
}

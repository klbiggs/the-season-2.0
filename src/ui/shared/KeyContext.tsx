// React context for the BYOK Gemini API key. Lifetime is the page session
// only — NEVER persisted to disk (no sessionStorage, no localStorage, no
// IndexedDB, no Zustand store). Page refresh = key cleared = user re-enters.
//
// Per CLAUDE.md "LLM integration specifics" + plan "CLAUDE.md additions #4
// BYOK key storage rule".

import { type ReactNode, createContext, useCallback, useContext, useState } from "react";
import { personaCacheRegistry } from "../../llm/cache";

type KeyContextValue = {
  key: string | null;
  setKey: (k: string) => void;
  clearKey: () => void;
};

const KeyContext = createContext<KeyContextValue>({
  key: null,
  setKey: () => {
    // no-op: context not provided
  },
  clearKey: () => {
    // no-op: context not provided
  },
});

export function KeyProvider({ children }: { children: ReactNode }) {
  const [key, setKeyState] = useState<string | null>(null);

  // Setting/rotating the key clears the persona cache registry — the old
  // cache names belong to the old key's project; the new key cannot
  // reach them.
  const setKey = useCallback((k: string) => {
    setKeyState(k);
    personaCacheRegistry.clear();
  }, []);

  const clearKey = useCallback(() => {
    setKeyState(null);
    personaCacheRegistry.clear();
  }, []);

  return <KeyContext.Provider value={{ key, setKey, clearKey }}>{children}</KeyContext.Provider>;
}

export function useApiKey(): KeyContextValue {
  return useContext(KeyContext);
}

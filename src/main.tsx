import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { DEFAULT_SEED } from "./game/rng.seeds";
import { createStore } from "./game/store";
import { _putRawForTests } from "./persist/dexie";
import { DevApp } from "./ui/dev/DevApp";

// Bootstrap order (pinned per plan): store is constructed synchronously at
// module load with the default seed. <LoadButton /> and <SeedPrompt /> swap
// the entire state atomically via replaceState — no "deferred construction
// behind prompt" path.
const store = createStore({ seed: DEFAULT_SEED });

// P2: expose the test-only IndexedDB write helper on window in dev mode so
// Playwright's corrupt-save spec can seed pathological records (e.g.,
// {version: 99}) without bypassing the regular save() Zod path. Gated by
// import.meta.env.DEV so production bundles don't carry the helper.
if (import.meta.env.DEV) {
  (window as unknown as { __putRawForTests: typeof _putRawForTests }).__putRawForTests =
    _putRawForTests;
}

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <DevApp store={store} seed={DEFAULT_SEED} />
  </StrictMode>,
);

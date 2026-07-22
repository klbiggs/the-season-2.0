import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DEFAULT_SEED } from "./game/rng.seeds";
import { createStore } from "./game/store";
import { DEV_SLOT, _putRawForTests } from "./persist/dexie";
import { enableFlavorContent } from "./runtime/flavorOrchestrator";
import {
  enableSemanticMemory,
  reembedSlotIfStale,
  seedLoreCorpus,
  setActiveSlot,
} from "./runtime/semanticIndex";
import "./index.css";

// Bootstrap order (pinned per plan): store is constructed synchronously at
// module load with the default seed. Save/Load swaps the entire state
// atomically via replaceState — no "deferred construction behind prompt".
const store = createStore({ seed: DEFAULT_SEED });

// P17: activate semantic memory (the ONLY production caller that flips the
// activation flag — tests/replay never call this, so the indexing subscribers
// stay inert). Bind the active slot and seed the lore corpus once (idempotent).
// This is the load-bearing seed site: the clean first-launch path is the
// createStore above, NOT a replaceState, so wiring lore only to the
// replaceState callers (SettingsMenu / CorruptSaveBanner) would miss it.
enableSemanticMemory();
setActiveSlot(DEV_SLOT);
void reembedSlotIfStale(DEV_SLOT).then(() => seedLoreCorpus(DEV_SLOT));

// P18: activate flavor-content generation (the ONLY production caller that
// flips the flag — tests/replay never call it, so the flavor subscribers +
// ensureFlavor stay inert). The store already bound its accessor via
// bindFlavorStore in createStore. Unlike P17's lore seed, flavor has no
// per-slot bootstrap init, so CorruptSaveBanner/SettingsMenu need no wiring.
enableFlavorContent();

// P2: expose the test-only IndexedDB write helper on window in dev mode so
// Playwright's corrupt-save spec can seed pathological records (e.g.,
// {version: 99}) without bypassing the regular save() Zod path. Gated by
// import.meta.env.DEV so production bundles don't carry it.
//
// P20: also expose the live store so the core-loop e2e can inject a precondition
// (high affection for a propose target; an aged head + heir for succession) via
// replaceState — the SAME sink the load path feeds (fromSaveV1 → replaceState),
// so it faithfully stands in for a loaded high-affection save without brittle
// hand-built SaveV1 blobs. DEV-only, like __putRawForTests.
if (import.meta.env.DEV) {
  const w = window as unknown as {
    __putRawForTests: typeof _putRawForTests;
    __store: typeof store;
  };
  w.__putRawForTests = _putRawForTests;
  w.__store = store;
}

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <App store={store} seed={DEFAULT_SEED} />
  </StrictMode>,
);

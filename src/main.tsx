import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DEFAULT_SEED } from "./game/rng.seeds";
import { createStore, selectGameState } from "./game/store";
import { _putRawForTests } from "./persist/dexie";
import { toSaveV7 } from "./persist/schema";
import "./index.css";

// Bootstrap order (pinned per plan): store is constructed synchronously at
// module load with the default seed. Save/Load swaps the entire state
// atomically via replaceState — no "deferred construction behind prompt".
const store = createStore({ seed: DEFAULT_SEED });

// P2: expose the test-only IndexedDB write helper on window in dev mode so
// Playwright's corrupt-save spec can seed pathological records (e.g.,
// {version: 99}) without bypassing the regular save() Zod path.
// P3-P5: additionally expose __buildSaveV7ForTests so Playwright happy-path
// specs can construct valid SaveV6 records (with branded HouseId tuples,
// 5 P3 House fields, P5 grievances array, era, schemes registry) without
// importing schemas in page-evaluate scope. Both gated by import.meta.env.DEV
// so production bundles don't carry them.
if (import.meta.env.DEV) {
  const w = window as unknown as {
    __putRawForTests: typeof _putRawForTests;
    __buildSaveV7ForTests: (overrides?: {
      wealth?: number;
      reputation?: number;
      currentLocation?: string;
      lastAudienceTick?: number | null;
    }) => unknown;
  };
  w.__putRawForTests = _putRawForTests;
  w.__buildSaveV7ForTests = (overrides = {}) => {
    const state = selectGameState(store.getState());
    // Apply House-level overrides to the player house, then serialize.
    const houses = new Map(state.houses);
    const playerKey = [...houses.keys()][0];
    if (playerKey !== undefined) {
      const player = houses.get(playerKey);
      if (player !== undefined) {
        houses.set(playerKey, {
          ...player,
          ...(overrides.wealth !== undefined ? { wealth: overrides.wealth } : {}),
          ...(overrides.reputation !== undefined ? { reputation: overrides.reputation } : {}),
          ...(overrides.currentLocation !== undefined
            ? { currentLocation: overrides.currentLocation as never }
            : {}),
          ...(overrides.lastAudienceTick !== undefined
            ? { lastAudienceTick: overrides.lastAudienceTick }
            : {}),
        });
      }
    }
    return toSaveV7({ ...state, houses });
  };
}

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <App store={store} seed={DEFAULT_SEED} />
  </StrictMode>,
);

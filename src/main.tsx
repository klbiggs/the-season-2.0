import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { DEFAULT_SEED } from "./game/rng.seeds";
import { createStore } from "./game/store";
import { DevApp } from "./ui/dev/DevApp";

// Bootstrap order (pinned per plan): store is constructed synchronously at
// module load with the default seed. <LoadButton /> and <SeedPrompt /> swap
// the entire state atomically via replaceState — no "deferred construction
// behind prompt" path.
const store = createStore({ seed: DEFAULT_SEED });

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Root element #root not found");

createRoot(rootElement).render(
  <StrictMode>
    <DevApp store={store} />
  </StrictMode>,
);

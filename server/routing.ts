// Model routing. Resolved decision #5: first-meeting only.
//   - empty (houseId, targetCharId) history → Pro
//   - non-empty history → Flash
//
// Moved from src/llm/routing.ts at P7.5; the server owns model selection
// now (kept rules-agnostic by reading only conversation history).

import { MODEL_DEFAULT, MODEL_FIRST_MEETING } from "../src/game/constants";
import type { Exchange, Model } from "../src/llm/types";

export function routeModel(history: ReadonlyArray<Exchange>): Model {
  return history.length === 0 ? MODEL_FIRST_MEETING : MODEL_DEFAULT;
}

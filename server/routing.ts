// Model routing.
//   - empty (houseId, targetCharId) history → Pro (first-meeting, decision #5)
//   - P26 (G3): a non-null keyMoment (proposal/scheme/duel/audience) → Pro
//   - otherwise → Flash
//
// Moved from src/llm/routing.ts at P7.5; the server owns model selection
// now (kept rules-agnostic by reading only conversation history + the
// client-computed keyMoment flag).

import { MODEL_DEFAULT, MODEL_FIRST_MEETING } from "../src/game/constants";
import type { Exchange, Model } from "../src/llm/types";

export function routeModel(
  history: ReadonlyArray<Exchange>,
  keyMoment: "proposal" | "scheme" | "duel" | "audience" | null = null,
): Model {
  return history.length === 0 || keyMoment !== null ? MODEL_FIRST_MEETING : MODEL_DEFAULT;
}

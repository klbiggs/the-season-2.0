// Model routing. Resolved decision #5: first-meeting only.
//   - empty (houseId, targetCharId) history → Pro
//   - non-empty history → Flash
//
// Pure function — takes the history slice the player is engaging, returns
// the model identifier. After heir promotion (§7), routeModel sees the
// inherited history (the pair key persists across succession) and stays on
// Flash. The caller passes the already-resolved slice; routeModel reads
// neither state nor RNG.
//
// Plan: plans/phases/04-ballroom-llm.md "src/llm/routing.ts" +
// Resolved decisions (§10) #5.

import { MODEL_DEFAULT, MODEL_FIRST_MEETING } from "../game/constants";
import type { Exchange, Model } from "./types";

export function routeModel(history: ReadonlyArray<Exchange>): Model {
  return history.length === 0 ? MODEL_FIRST_MEETING : MODEL_DEFAULT;
}

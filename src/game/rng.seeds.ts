// Pinned seeds for determinism tests. Kept in one place so the negative-control
// seed and the replay seeds can never drift apart.

import type { HouseId } from "./rng";

export const PLAYER_HOUSE_ID = "player" as HouseId;

export const DEFAULT_SEED = "the-season-default";

export const REPLAY_SEEDS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;

export const NEGATIVE_CONTROL_SEED = "negative-control";

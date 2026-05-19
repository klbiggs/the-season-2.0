// Pinned seeds for determinism tests. Kept in one place so the negative-control
// seed and the replay seeds can never drift apart.
//
// P3 (B1 fix): PLAYER_HOUSE_ID moved to rng.ts (the game-rng element); rules
// layer imports it from there. This file re-exports for test consumers that
// expect it alongside the other seeds. Re-export does NOT launder the
// boundary — production rules MUST import directly from "../rng".

export { PLAYER_HOUSE_ID } from "./rng";

export const DEFAULT_SEED = "the-season-default";

export const REPLAY_SEEDS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;

export const NEGATIVE_CONTROL_SEED = "negative-control";

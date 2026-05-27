// Pinned seeds for determinism tests. Kept in one place so the negative-control
// seed and the replay seeds can never drift apart.
//
// P3 (B1 fix): PLAYER_HOUSE_ID moved to rng.ts (the game-rng element); rules
// layer imports it from there. This file re-exports for test consumers that
// expect it alongside the other seeds. Re-export does NOT launder the
// boundary — production rules MUST import directly from "../rng".

export { PLAYER_HOUSE_ID, INDEPENDENT_HOUSE_ID } from "./rng";

// P14: brand-type re-exports for UI consumers. ESLint rule (b) blocks
// `ui → game-rng` value imports (the deterministic-LLM-boundary lesson, spec
// §8), but UI components legitimately need the branded ID *types* for prop
// shapes and store-action arguments. Type-only re-exports are erased at
// compile time — no runtime artifact crosses the boundary, so the determinism
// guard stays intact. Rules-layer code still imports these directly from
// "./rng" per the module-header comment above; UI routes through this barrel.
export type {
  CharacterId,
  HouseId,
  WhisperId,
  TraitId,
  StaffId,
  SchemeId,
  GrievanceId,
  DuelId,
  ArtifactInstanceId,
  ArtifactDefinitionId,
  ForgeryId,
  ThiefAttemptId,
  PromenadeSessionId,
  BallSessionId,
  GlobalEventId,
  FlavorContentId,
  BloodFeudId,
  InheritedSecretId,
  PatronessId,
  MarriageId,
  CourierPayloadId,
  SiblingRivalActorId,
  FactionId,
  FactionPairKey,
  BetrothalId,
} from "./rng";

export const DEFAULT_SEED = "the-season-default";

export const REPLAY_SEEDS = ["alpha", "beta", "gamma", "delta", "epsilon"] as const;

export const NEGATIVE_CONTROL_SEED = "negative-control";

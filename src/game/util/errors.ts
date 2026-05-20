// Pure-rule programmer-error classes. Centralized to avoid per-rule-file error
// sprawl. EmptyArrayError and RngNotRegisteredError stay in rng.ts because
// they're intrinsic to that module's contract.

import type { CharacterId, HouseId, MarriageId, SchemeId } from "../rng";

export class CharacterNotFoundError extends Error {
  constructor(id: CharacterId) {
    super(`Character not found: ${id}`);
    this.name = "CharacterNotFoundError";
  }
}

export class HouseNotFoundError extends Error {
  constructor(id: HouseId) {
    super(`House not found: ${id}`);
    this.name = "HouseNotFoundError";
  }
}

export class MarriageNotFoundError extends Error {
  constructor(id: MarriageId) {
    super(`Marriage not found: ${id}`);
    this.name = "MarriageNotFoundError";
  }
}

export class UnknownLocationPairError extends Error {
  constructor(a: string, b: string) {
    super(`Unknown location pair: ${a} ↔ ${b}`);
    this.name = "UnknownLocationPairError";
  }
}

// P5: scheme lookup error. Used by getSchemeOrThrow in lookups.ts for the
// schemes registry on GameState. Mirrors HouseNotFoundError / etc.
export class SchemeNotFoundError extends Error {
  constructor(id: SchemeId) {
    super(`Scheme not found: ${id}`);
    this.name = "SchemeNotFoundError";
  }
}

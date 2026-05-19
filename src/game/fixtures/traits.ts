import type { TraitId } from "../rng";

// 32 named traits per spec §3 trait-registry references. Names are placeholders
// at P1 — finalized at P4 when conversation bonuses tune which trait is a
// bonus for which mood. Each entry at P1 is `{ id, label }` only.
export const TRAITS: ReadonlyArray<{ id: TraitId; label: string }> = [
  { id: "Cunning" as TraitId, label: "Cunning" },
  { id: "Observant" as TraitId, label: "Observant" },
  { id: "Charming" as TraitId, label: "Charming" },
  { id: "Witty" as TraitId, label: "Witty" },
  { id: "Empathetic" as TraitId, label: "Empathetic" },
  { id: "Intellectual" as TraitId, label: "Intellectual" },
  { id: "Sophisticated" as TraitId, label: "Sophisticated" },
  { id: "Polyglot" as TraitId, label: "Polyglot" },
  { id: "Rustic" as TraitId, label: "Rustic" },
  { id: "Vain" as TraitId, label: "Vain" },
  { id: "Frivolous" as TraitId, label: "Frivolous" },
  { id: "Romantic" as TraitId, label: "Romantic" },
  { id: "Jaded" as TraitId, label: "Jaded" },
  { id: "Melancholic" as TraitId, label: "Melancholic" },
  { id: "Dull" as TraitId, label: "Dull" },
  { id: "Greedy" as TraitId, label: "Greedy" },
  { id: "Devout" as TraitId, label: "Devout" },
  { id: "Pious" as TraitId, label: "Pious" },
  { id: "Brash" as TraitId, label: "Brash" },
  { id: "Reserved" as TraitId, label: "Reserved" },
  { id: "Ambitious" as TraitId, label: "Ambitious" },
  { id: "ImpoverishedNobility" as TraitId, label: "Impoverished Nobility" },
  { id: "Generous" as TraitId, label: "Generous" },
  { id: "Suspicious" as TraitId, label: "Suspicious" },
  { id: "Loyal" as TraitId, label: "Loyal" },
  { id: "Treacherous" as TraitId, label: "Treacherous" },
  { id: "Bold" as TraitId, label: "Bold" },
  { id: "Cautious" as TraitId, label: "Cautious" },
  { id: "Eloquent" as TraitId, label: "Eloquent" },
  { id: "Reclusive" as TraitId, label: "Reclusive" },
  { id: "Hedonistic" as TraitId, label: "Hedonistic" },
  { id: "Ascetic" as TraitId, label: "Ascetic" },
];

// Derived id-only array for the noveltyPool source in inheritTraits. Explicit
// `readonly TraitId[]` annotation does the type widening since Array.map
// returns mutable T[]; do NOT add `as const` (would produce a tuple type that
// breaks the `noveltyPool: readonly TraitId[]` covariance).
export const TRAITS_ALL: readonly TraitId[] = TRAITS.map((t) => t.id);

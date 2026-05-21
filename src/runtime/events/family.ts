// Family-domain bus events. Carries P7 marriage, tutor, maturation, and
// archetype-reclassification lifecycle. Mirrors the P5/P6 domain-partition
// pattern.
//
// CONTRACT (per the P3 bus-publish discipline): events fire from store-action
// wrappers AFTER `set()` returns. NEVER from inside the orchestrator's phase
// chain (which must stay pure). Diff-helper publishers walk before/after
// state pairs and emit the appropriate variant per transition.
//
// Note: `PlayerExileBlocked` events stay on `whisperBus` per existing cross-
// cutting convention; familyBus does NOT carry exile gate events.
//
// Plan: plans/phases/07-family-succession.md "Events module".

import type { Archetype } from "../../game/fixtures/archetypes";
import type { Role } from "../../game/fixtures/roles";
import type { CharacterId, MarriageId, TraitId } from "../../game/rng";
import { EventBus } from "./bus";

export type FamilyEvent =
  | {
      kind: "ProposalAccepted";
      proposerId: CharacterId;
      targetId: CharacterId;
      marriageId: MarriageId;
      tick: number;
    }
  | {
      kind: "ProposalRejected";
      proposerId: CharacterId;
      targetId: CharacterId;
      scandalDelta: number;
      tick: number;
    }
  | {
      kind: "MarriageDissolved";
      marriageId: MarriageId;
      // The dead spouse (or null at v1 if the dissolution wasn't death-driven —
      // currently always death-driven, but the field is nullable for forward-
      // compat with future divorce / annulment flows).
      deceasedSpouseId: CharacterId | null;
      survivingSpouseId: CharacterId | null;
      tick: number;
    }
  | {
      kind: "TutorAssigned";
      childId: CharacterId;
      tutorId: CharacterId;
      reassignmentCount: number;
      tick: number;
    }
  | {
      kind: "TutorTraitGranted";
      childId: CharacterId;
      traitId: TraitId;
      tick: number;
    }
  | {
      kind: "ChildMatured";
      childId: CharacterId;
      newRole: Role;
      newArchetype: Archetype;
      tick: number;
    }
  | {
      kind: "TemptationUnlocked";
      characterId: CharacterId;
      tick: number;
    }
  | {
      kind: "ArchetypeReclassified";
      characterId: CharacterId;
      from: Archetype;
      to: Archetype;
      trigger: "Succession" | "Maturation";
      tick: number;
    };

export const familyBus = new EventBus<FamilyEvent>();

// Module-level empty key set so tick-advance callers don't allocate per-call.
const EMPTY_KEYS: ReadonlySet<string> = new Set();

// ── Diff publishers ───────────────────────────────────────────────────────
// Each walks (before, after) GameState pairs and publishes the appropriate
// FamilyEvent variant per transition. Pure: no state mutation, no RNG.

// Walks state.marriages for `dissolved: false → true` transitions and emits
// MarriageDissolved. Predicate is STRICT false→true (an already-dissolved
// marriage that gets rewritten does NOT re-publish; a brand-new marriage
// with dissolved=true from inception cannot exist).
//
// Wrapper-owned skip keys: `"dissolve:" + marriageId` lets a wrapper that
// direct-publishes its own MarriageDissolved (none at P7) suppress the diff.
export function publishMarriageTransitions(
  before: import("../../game/entities").GameState,
  after: import("../../game/entities").GameState,
  wrapperPublishedKeys: ReadonlySet<string> = EMPTY_KEYS,
): void {
  for (const [mid, afterM] of after.marriages) {
    const beforeM = before.marriages.get(mid);
    if (beforeM === undefined) continue;
    if (beforeM.dissolved) continue;
    if (!afterM.dissolved) continue;
    if (wrapperPublishedKeys.has(`dissolve:${mid}`)) continue;
    // Identify the deceased spouse (NOT alive in `after`) and surviving spouse.
    const aAlive = after.characters.get(afterM.spouseAId)?.alive === true;
    const bAlive = after.characters.get(afterM.spouseBId)?.alive === true;
    const deceasedSpouseId = !aAlive ? afterM.spouseAId : !bAlive ? afterM.spouseBId : null;
    const survivingSpouseId =
      !aAlive && bAlive ? afterM.spouseBId : !bAlive && aAlive ? afterM.spouseAId : null;
    familyBus.publish({
      kind: "MarriageDissolved",
      marriageId: mid,
      deceasedSpouseId,
      survivingSpouseId,
      tick: after.tick,
    });
  }
}

// Walks state.characters for `temptationHookUnlocked: false → true`
// transitions and emits TemptationUnlocked. One-way latch — once true, it
// can't flip back, so the predicate is unambiguous.
export function publishTemptationLatchTransitions(
  before: import("../../game/entities").GameState,
  after: import("../../game/entities").GameState,
): void {
  for (const [id, afterC] of after.characters) {
    const beforeC = before.characters.get(id);
    if (beforeC === undefined) continue;
    if (beforeC.temptationHookUnlocked) continue;
    if (!afterC.temptationHookUnlocked) continue;
    familyBus.publish({
      kind: "TemptationUnlocked",
      characterId: id,
      tick: after.tick,
    });
  }
}

// Walks state.characters for child-maturation transitions and emits
// ChildMatured + ArchetypeReclassified (trigger: "Maturation"). Detection
// keys on (a) role change away from "Dependent" + age === ADULTHOOD plus
// (b) archetype change at the same character. Fired from the runYearPass
// wrapper.
export function publishChildMaturationTransitions(
  before: import("../../game/entities").GameState,
  after: import("../../game/entities").GameState,
): void {
  for (const [id, afterC] of after.characters) {
    const beforeC = before.characters.get(id);
    if (beforeC === undefined) continue;
    // Maturation signal: was Dependent, now NOT Dependent + age >= adulthood.
    if (beforeC.role !== "Dependent") continue;
    if (afterC.role === "Dependent") continue;
    familyBus.publish({
      kind: "ChildMatured",
      childId: id,
      newRole: afterC.role,
      newArchetype: afterC.archetype,
      tick: after.tick,
    });
    if (beforeC.archetype !== afterC.archetype) {
      familyBus.publish({
        kind: "ArchetypeReclassified",
        characterId: id,
        from: beforeC.archetype,
        to: afterC.archetype,
        trigger: "Maturation",
        tick: after.tick,
      });
    }
  }
}

// Walks state.characters for non-maturation archetype changes (i.e., those
// driven by succession's widened recompute, not by the dependent → spinster/
// bohemian/exile maturation flip). Fired from the runYearPass wrapper AFTER
// publishChildMaturationTransitions so the two publishers' coverage doesn't
// double-emit on the same character.
export function publishArchetypeReclassificationsFromSuccession(
  before: import("../../game/entities").GameState,
  after: import("../../game/entities").GameState,
): void {
  for (const [id, afterC] of after.characters) {
    const beforeC = before.characters.get(id);
    if (beforeC === undefined) continue;
    if (beforeC.archetype === afterC.archetype) continue;
    // Skip maturation cases (already emitted by publishChildMaturationTransitions).
    if (beforeC.role === "Dependent" && afterC.role !== "Dependent") continue;
    familyBus.publish({
      kind: "ArchetypeReclassified",
      characterId: id,
      from: beforeC.archetype,
      to: afterC.archetype,
      trigger: "Succession",
      tick: after.tick,
    });
  }
}

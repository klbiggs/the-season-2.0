// Shared marriage-mint core (P23). Extracted from the duplicated inline mints
// in applyProposalPure (proposal.ts) and mintMarriageAndCommit (elopement.ts);
// also used by the betrothal honor step and the society-marriage step.
//
// Convention: `initiatorId` keeps its role (HeadOfHouse / Heir / player child);
// `targetId` flips Spinster/Dependent → Spouse (others — e.g. widows — keep
// their role). The helper updates ONLY state.characters + state.marriages;
// callers layer their own house / elopement / rng / log mutations on top of the
// returned nextState.
//
// Dull-exposure detection (spec §3 line 468) is applied by default (matches the
// proposal mint); the elopement mint opts OUT (applyDullExposure: false) to
// preserve its pre-P23 behavior. Symmetric: if the initiator carries Dull the
// target's exposure tick is set; if the target carries Dull the initiator's is
// set; mutual Dull sets both.
//
// Plan: plans/phases/23-marriage-family-depth.md item B "Marriage-mint helper".

import { HAPPINESS_INITIAL } from "../constants";
import type { Character, GameState, MarriageRecord } from "../entities";
import { makeMarriageId } from "../fixtures/marriageIdFactory";
import type { CharacterId, MarriageId, TraitId } from "../rng";

export function mintMarriage(
  state: GameState,
  initiatorId: CharacterId,
  targetId: CharacterId,
  opts: { viaElopement: boolean; applyDullExposure?: boolean },
): { nextState: GameState; marriageId: MarriageId } {
  const initiator = state.characters.get(initiatorId);
  const target = state.characters.get(targetId);
  if (initiator === undefined || target === undefined) {
    // Programmer error — callers gate aliveness/existence before minting.
    throw new Error(`mintMarriage: missing character ${initiatorId} or ${targetId}`);
  }

  const marriageId = makeMarriageId(state, initiatorId, targetId);
  const [lex0, lex1]: [CharacterId, CharacterId] =
    initiatorId < targetId ? [initiatorId, targetId] : [targetId, initiatorId];
  const record: MarriageRecord = {
    id: marriageId,
    spouseAId: lex0,
    spouseBId: lex1,
    marriedAtTick: state.tick,
    dissolved: false,
    dissolvedAtTick: null,
    viaElopement: opts.viaElopement,
    viaAbandonment: false,
  };
  const newMarriages = new Map(state.marriages);
  newMarriages.set(marriageId, record);

  const newChars = new Map(state.characters);
  // Target flips Spinster/Dependent → Spouse; widows / others keep their role.
  const targetRole =
    target.role === "Spinster" || target.role === "Dependent" ? "Spouse" : target.role;
  const targetUpdated: Character = { ...target, role: targetRole, marriageId };
  const initiatorUpdated: Character = { ...initiator, marriageId };

  if (opts.applyDullExposure !== false) {
    const initiatorDull = initiator.traits.includes("Dull" as TraitId);
    const targetDull = target.traits.includes("Dull" as TraitId);
    if (initiatorDull) targetUpdated.dullSpouseExposureStartTick = state.tick;
    if (targetDull) initiatorUpdated.dullSpouseExposureStartTick = state.tick;
    // Defensive happiness floor for previously-single fresh-state characters.
    if (targetUpdated.happiness === 0) targetUpdated.happiness = HAPPINESS_INITIAL;
    if (initiatorUpdated.happiness === 0) initiatorUpdated.happiness = HAPPINESS_INITIAL;
  }

  newChars.set(targetId, targetUpdated);
  newChars.set(initiatorId, initiatorUpdated);

  return {
    nextState: { ...state, characters: newChars, marriages: newMarriages },
    marriageId,
  };
}

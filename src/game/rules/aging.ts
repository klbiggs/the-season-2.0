// Year-pass aging step. Increments age for living characters in lex
// characterId order; marks death when age >= deathAge after the increment.
// No PRNG draws — death is deterministic from the rolled deathAge.
//
// `>=` (not `===`) is robust against future migrations or trait-modifier paths
// that could momentarily produce age > deathAge.
//
// P4 + P5: conversation-history + affection-map orphan-prune is extracted
// into pruneOrphanedConversationKeys (below) so both year-pass deaths (from
// applyAgingStep) and tick-phase deaths (from P5's Assassination resolver)
// share a single source of truth for the cascade.

import { ELOPEMENT_LOSS_SCANDAL_DELTA } from "../constants";
import { parsePairKey } from "../conversation/types";
import type {
  ArtifactInstance,
  Betrothal,
  Character,
  ElopementSprintState,
  GameState,
  House,
  RivalActorState,
  ThiefAttempt,
} from "../entities";
import { classifyArchetype } from "../fixtures/archetypes";
import { RIVAL_HOUSE_IDS_SET } from "../fixtures/rivals";
import type { Role } from "../fixtures/roles";
import { PLAYER_HOUSE_ID } from "../rng";
import type {
  ArtifactInstanceId,
  BetrothalId,
  CharacterId,
  HouseId,
  ThiefAttemptId,
  TraitId,
} from "../rng";
import { clamp } from "../util/clamp";
import { recordPlayerHeadNaturalDeath } from "./dynastyLegacies";

// P23: re-widow role recompute (mirrors maturation.computeMaturationRole minus
// the Exile/marriageId branches — the survivor is being made unwed here).
function recomputeWidowRole(c: Character): Role {
  if (c.gender === "Female") return "Spinster";
  if (
    c.gender === "Male" &&
    (c.traits.includes("Frivolous" as TraitId) ||
      c.traits.includes("Romantic" as TraitId) ||
      c.traits.includes("Jaded" as TraitId))
  ) {
    return "Bohemian";
  }
  return "Dependent";
}

// === VERBATIM MIGRATION of the heir-promotion safety block from
// applyAgingStep's top-of-function comment (aging.ts:8-14 pre-P5). The
// invariant moves with the body; the original 7-line comment is preserved
// word-for-word so future maintainers reading the helper see the same
// rationale that drove the original P4 design: ===
//
// P4: extended with conversation-history + affection-map orphan-prune. When
// an NPC dies (alive: true → false in this step), entries in
// state.conversationHistory and state.affectionMap keyed on that NPC's
// character ID are removed. Heir-promotion safety: the prune filters by
// parsePairKey(key).characterId (the TARGET half), NOT by houseId — so
// when the PLAYER head dies, conversation history and affection are
// preserved (heir inherits both via the pair-key's stable houseId half).
//
// === END VERBATIM MIGRATION. P5 additions below (NOT in the original): ===
//
// Pure rule; never mutates inputs. Future "simplifications" of the filter
// shape break heir succession — this comment block is load-bearing.
//
// P5: ALSO called from src/game/rules/schemes.ts on Assassination completion
// (the first tick-phase death path). The helper is identical between the two
// callers; the only difference is whether `newlyDeadCharIds` arrives from the
// year-pass aging loop or from a single Assassination kill.
export function pruneOrphanedConversationKeys(
  state: GameState,
  newlyDeadCharIds: ReadonlySet<CharacterId>,
): GameState {
  if (newlyDeadCharIds.size === 0) return state;
  const histFiltered = new Map(state.conversationHistory);
  for (const key of histFiltered.keys()) {
    if (newlyDeadCharIds.has(parsePairKey(key).characterId)) histFiltered.delete(key);
  }
  const affFiltered = new Map(state.affectionMap);
  for (const key of affFiltered.keys()) {
    if (newlyDeadCharIds.has(parsePairKey(key).characterId)) affFiltered.delete(key);
  }
  // P6: dismiss whispers about newly dead subjects (Regency-flavor — "de
  // mortuis nil nisi bonum"). Already-Weaponized whispers persist past
  // subject death (a published Scandal Sheet doesn't unprint). Already-
  // Dismissed whispers stay dismissed (no double-flip).
  let whispersChanged = false;
  const newWhispers = new Map(state.whispers);
  for (const [id, w] of newWhispers) {
    if (
      newlyDeadCharIds.has(w.subjectCharacterId) &&
      w.status !== "Weaponized" &&
      w.status !== "Dismissed"
    ) {
      newWhispers.set(id, { ...w, status: "Dismissed" });
      whispersChanged = true;
    }
  }

  // ── P7 BRANCH 1: tutor-assignment prune ──
  // Every child whose assignedTutorCharacterId references a dead tutor has
  // the field nulled. tutorBonusTraitGranted is NOT cleared (a previously-
  // granted bonus persists past tutor death). If maturation hasn't fired
  // yet, the pending-choice slot will see tutorAlive=false at maturation and
  // skip the bonus.
  let charactersChanged = false;
  let newChars = state.characters;
  for (const [id, c] of state.characters) {
    if (c.assignedTutorCharacterId !== null && newlyDeadCharIds.has(c.assignedTutorCharacterId)) {
      if (!charactersChanged) {
        newChars = new Map(state.characters);
        charactersChanged = true;
      }
      newChars.set(id, { ...c, assignedTutorCharacterId: null });
    }
  }

  // ── P7 BRANCH 2: Dull-spouse exposure prune ──
  // When a Dull spouse dies, the surviving character's exposure window closes
  // (happiness drain stops). Reads from newChars (branch-1 accumulator) so a
  // character whose tutor died AND whose Dull spouse died in the same year-
  // pass gets BOTH fields cleared.
  for (const [id, c] of newChars) {
    if (c.dullSpouseExposureStartTick === null) continue;
    if (c.marriageId === null) continue;
    const marriage = state.marriages.get(c.marriageId);
    if (marriage === undefined || marriage.dissolved) continue;
    const spouseId = marriage.spouseAId === id ? marriage.spouseBId : marriage.spouseAId;
    if (!newlyDeadCharIds.has(spouseId)) continue;
    if (!charactersChanged) {
      newChars = new Map(state.characters);
      charactersChanged = true;
    }
    const existing = newChars.get(id) ?? c;
    newChars.set(id, { ...existing, dullSpouseExposureStartTick: null });
  }

  // ── P7 BRANCH 3: marriage dissolution on either-spouse death ──
  // Pre-P7, succession step 4 dissolved marriages only when the dead character
  // was a HEAD. Non-head spouse deaths left marriage.dissolved=false
  // indefinitely. P7 closes that gap by dissolving every marriage whose either
  // spouse has died in this newlyDeadCharIds set. succession's explicit
  // dissolution becomes a redundant no-op (safe to leave as defensive).
  let marriagesChanged = false;
  let newMarriages = state.marriages;
  for (const [mid, m] of state.marriages) {
    if (m.dissolved) continue;
    if (newlyDeadCharIds.has(m.spouseAId) || newlyDeadCharIds.has(m.spouseBId)) {
      if (!marriagesChanged) {
        newMarriages = new Map(state.marriages);
        marriagesChanged = true;
      }
      newMarriages.set(mid, { ...m, dissolved: true, dissolvedAtTick: state.tick });
    }
  }

  // ── P8 BRANCH 4: rival-house associated-character pruning ──
  // When a rival-associated character dies, drop them from the rival's
  // RivalActorState.associatedCharacterIds array. Lazy-clone the rivalActors
  // Map on first match so multi-death year-passes accumulate correctly.
  let newRivalActors: Map<HouseId, RivalActorState> | null = null;
  for (const deadId of newlyDeadCharIds) {
    const deadChar = state.characters.get(deadId);
    if (deadChar === undefined) continue;
    if (!RIVAL_HOUSE_IDS_SET.has(deadChar.houseId)) continue;
    const rivalActor = (newRivalActors ?? state.rivalActors).get(deadChar.houseId);
    if (rivalActor === undefined) continue;
    if (!rivalActor.associatedCharacterIds.includes(deadId)) continue;
    if (newRivalActors === null) {
      newRivalActors = new Map(state.rivalActors);
    }
    newRivalActors.set(deadChar.houseId, {
      ...rivalActor,
      associatedCharacterIds: rivalActor.associatedCharacterIds.filter((id) => id !== deadId),
    });
  }

  // ── P9 BRANCH 5: elopement sprint cleanup on dead sprint character ──
  // When the eloping character or target dies, terminate the active sprint
  // as a de-facto Lost outcome: +50 scandal on player house (clamped),
  // state.elopement → null. P9 is the FIRST phase to route a state.houses
  // mutation through pruneOrphanedConversationKeys (widened helper
  // responsibility — see CLAUDE.md pin "modal-state cleanup on death").
  //
  // The +50 scandal extrapolates spec §3 line 379 ("loss" → +50 scandal) to
  // the death-cascade case; the alternative (0 scandal) was rejected as a
  // perverse incentive at v1.5+ when the Q4 tick-advance gate may be relaxed.
  // At v1 this branch is unreachable end-to-end via runYearPass because the
  // Q4 ElopementInProgress gate at the wrapper top blocks year-pass execution
  // while state.elopement !== null. The branch ships for defense-in-depth and
  // because the helper's contract is "every death cascade goes through here."
  let newHouses: Map<HouseId, House> | null = null;
  let newElopement: ElopementSprintState | null | undefined = undefined;
  if (state.elopement !== null) {
    const sprint = state.elopement;
    if (
      newlyDeadCharIds.has(sprint.elopingCharacterId) ||
      newlyDeadCharIds.has(sprint.targetCharacterId)
    ) {
      const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
      if (playerHouse !== undefined) {
        newHouses = new Map(state.houses);
        newHouses.set(PLAYER_HOUSE_ID, {
          ...playerHouse,
          scandal: clamp(playerHouse.scandal + ELOPEMENT_LOSS_SCANDAL_DELTA, 0, 100),
        });
      }
      newElopement = null;
    }
  }

  // ── P10 BRANCH 6: forger death — no-op walk (documented for symmetry) ──
  // Forgeries PERSIST past forger death (mirrors the P6 "Weaponized whispers
  // persist past subject death" precedent — "you can't unprint the news";
  // once forged the artifact stays forged). NO mutation. The branch is
  // documented for future-proofing: a v1.5 "forger death surfaces the
  // forgery" rule would land here.

  // ── P10 BRANCH 7: equipped-artifact-owner death ──
  // Walk dead characters' equippedArtifactIds (after the branch-1/2 mutation
  // pass for the character record itself). For each instance: REMOVE from the
  // dead character's equippedArtifactIds AND flip ownerCharacterId to a
  // deterministic fallback (house head if alive, else lex-first living
  // family member, else stranded at dead.id for future P15 dynasty-collapse
  // logic). The instance persists in state.artifactInstances (never delete).
  let newArtifactInstances: Map<ArtifactInstanceId, ArtifactInstance> | null = null;
  // (chars already cloned at branch 1/2 if needed; reuse newChars accumulator).
  for (const deadId of newlyDeadCharIds) {
    const deadChar = (charactersChanged ? newChars : state.characters).get(deadId);
    if (!deadChar) continue;
    if (deadChar.equippedArtifactIds.length === 0) {
      // Still check if the dead character OWNS any artifacts (not equipped).
      // Walk artifactInstances; if any has ownerCharacterId === deadId, flip
      // the owner per the fallback chain.
      for (const inst of state.artifactInstances.values()) {
        if (inst.ownerCharacterId !== deadId) continue;
        const newOwner = pickArtifactInheritor(
          state,
          deadChar,
          charactersChanged ? newChars : state.characters,
        );
        if (newOwner === deadId) continue; // stranded
        if (newArtifactInstances === null) {
          newArtifactInstances = new Map(state.artifactInstances);
        }
        newArtifactInstances.set(inst.id, { ...inst, ownerCharacterId: newOwner });
      }
      continue;
    }
    // Compute the new owner for inherited artifacts (and reset dead's equipped).
    const newOwner = pickArtifactInheritor(
      state,
      deadChar,
      charactersChanged ? newChars : state.characters,
    );
    if (!charactersChanged) {
      newChars = new Map(state.characters);
      charactersChanged = true;
    }
    const currentDead = newChars.get(deadId);
    if (currentDead) {
      newChars.set(deadId, { ...currentDead, equippedArtifactIds: [] });
    }
    // Walk all instances owned by deadChar (equipped + unequipped) and update.
    for (const inst of state.artifactInstances.values()) {
      if (inst.ownerCharacterId !== deadId) continue;
      if (newOwner === deadId) continue; // stranded — no change
      if (newArtifactInstances === null) {
        newArtifactInstances = new Map(state.artifactInstances);
      }
      newArtifactInstances.set(inst.id, { ...inst, ownerCharacterId: newOwner });
    }
  }

  // ── P10 BRANCH 8: in-flight thief attempts vs dead owner ──
  // When a dead character was the owner of an in-flight ThiefAttempt,
  // auto-thwart it (target permanently unavailable — no one to steal from).
  let newThiefAttempts: Map<ThiefAttemptId, ThiefAttempt> | null = null;
  for (const attempt of state.thiefAttempts.values()) {
    if (attempt.thwarted !== null) continue;
    if (!newlyDeadCharIds.has(attempt.ownerCharacterId)) continue;
    if (newThiefAttempts === null) {
      newThiefAttempts = new Map(state.thiefAttempts);
    }
    newThiefAttempts.set(attempt.id, { ...attempt, thwarted: true, resolvedAtTick: state.tick });
  }

  // ── P11 BRANCH 9: sibling-rival actor cleanup on dead sibling-character ──
  // When a promoted sibling-rival dies, remove their entry from the player
  // house's siblingRivals array. Lazy-clone the (already-cloned-or-not) houses
  // accumulator; composes with branch 5 via `newHouses ??= ...` precedent.
  {
    const playerHouseView = (newHouses ?? state.houses).get(PLAYER_HOUSE_ID);
    if (playerHouseView !== undefined && playerHouseView.siblingRivals.length > 0) {
      const survivors = playerHouseView.siblingRivals.filter(
        (sr) => !newlyDeadCharIds.has(sr.characterId),
      );
      if (survivors.length !== playerHouseView.siblingRivals.length) {
        if (newHouses === null) newHouses = new Map(state.houses);
        newHouses.set(PLAYER_HOUSE_ID, { ...playerHouseView, siblingRivals: survivors });
      }
    }
  }

  // ── P11 BRANCH 10: blood-feud auto-resolve on rival house die-out ──
  // When ALL associated-characters of a rival house die (cumulative deaths),
  // auto-resolve every Active blood-feud against that house with
  // resolutionKind: "GenerationalDecay". The rival no longer has associates
  // for the affection-penalty to bite, so the feud has nothing left to actuate.
  // Reads associatedCharacterIds from the POST-BRANCH-4 state (newRivalActors).
  {
    const rivalsView = newRivalActors ?? state.rivalActors;
    const playerHouseView = (newHouses ?? state.houses).get(PLAYER_HOUSE_ID);
    if (playerHouseView !== undefined) {
      for (const deadId of newlyDeadCharIds) {
        const deadChar = state.characters.get(deadId);
        if (deadChar === undefined) continue;
        if (!RIVAL_HOUSE_IDS_SET.has(deadChar.houseId)) continue;
        const rivalActor = rivalsView.get(deadChar.houseId);
        if (rivalActor === undefined) continue;
        // Filter alive associates against state.characters (deaths flipped pre-helper).
        const aliveAssociates = rivalActor.associatedCharacterIds.filter((cid) => {
          const c = state.characters.get(cid);
          return c?.alive === true;
        });
        if (aliveAssociates.length !== 0) continue;
        // Rival house dies-out. Flip every active feud against this rival to Resolved.
        const currentPlayerHouse =
          newHouses !== null
            ? (newHouses.get(PLAYER_HOUSE_ID) ?? playerHouseView)
            : playerHouseView;
        const hasAnyOpenFeud = currentPlayerHouse.bloodFeuds.some(
          (bf) => bf.offendingHouseId === deadChar.houseId && !bf.resolved,
        );
        if (!hasAnyOpenFeud) continue;
        if (newHouses === null) newHouses = new Map(state.houses);
        newHouses.set(PLAYER_HOUSE_ID, {
          ...currentPlayerHouse,
          bloodFeuds: currentPlayerHouse.bloodFeuds.map((bf) =>
            bf.offendingHouseId === deadChar.houseId && !bf.resolved
              ? {
                  ...bf,
                  resolved: true,
                  resolvedAtTick: state.tick,
                  resolutionKind: "GenerationalDecay" as const,
                }
              : bf,
          ),
        });
      }
    }
  }

  // ── P23 BRANCH 11: re-widowing role flip ──
  // For each marriage dissolving THIS pass (exactly one spouse newly dead), the
  // SURVIVING spouse — if role "Spouse" — re-enters the marriage market: null
  // their marriageId (cleanly unwed for the classifier's marriageId===null
  // branches), recompute role (Spinster/Bohemian/Dependent), reclassify
  // archetype. Reads/writes the branch-1/2 newChars accumulator. The
  // Spouse→non-Spouse + marriageId→null signature is what publishArchetype-
  // ReclassificationsFromSuccession keys on to label "RoleFlip" (NOT
  // "Succession" — a widow must not trigger a succession scandal column).
  for (const [, m] of state.marriages) {
    if (m.dissolved) continue; // only marriages active before this pass
    const aDead = newlyDeadCharIds.has(m.spouseAId);
    const bDead = newlyDeadCharIds.has(m.spouseBId);
    if (aDead === bDead) continue; // both dead or neither → no lone survivor
    const survivorId = aDead ? m.spouseBId : m.spouseAId;
    const survivor = (charactersChanged ? newChars : state.characters).get(survivorId);
    if (survivor === undefined || !survivor.alive || survivor.role !== "Spouse") continue;
    const newRole = recomputeWidowRole(survivor);
    const widowed: Character = { ...survivor, marriageId: null, role: newRole };
    const reclassified: Character = { ...widowed, archetype: classifyArchetype(widowed) };
    if (!charactersChanged) {
      newChars = new Map(state.characters);
      charactersChanged = true;
    }
    newChars.set(survivorId, reclassified);
  }

  // ── P23 BRANCH 12: betrothal auto-break on party death ──
  // A Pending betrothal naming a newly-dead party flips to Broken (no scandal —
  // death is not a jilt). Lazy-clone the betrothals Map.
  let newBetrothals: Map<BetrothalId, Betrothal> | null = null;
  for (const [bid, b] of state.betrothals) {
    if (b.status !== "Pending") continue;
    if (!newlyDeadCharIds.has(b.partyAId) && !newlyDeadCharIds.has(b.partyBId)) continue;
    if (newBetrothals === null) newBetrothals = new Map(state.betrothals);
    newBetrothals.set(bid, { ...b, status: "Broken", resolvedAtTick: state.tick });
  }

  return {
    ...state,
    conversationHistory: histFiltered,
    affectionMap: affFiltered,
    ...(whispersChanged ? { whispers: newWhispers } : {}),
    ...(charactersChanged ? { characters: newChars } : {}),
    ...(marriagesChanged ? { marriages: newMarriages } : {}),
    ...(newBetrothals !== null ? { betrothals: newBetrothals } : {}),
    ...(newRivalActors !== null ? { rivalActors: newRivalActors } : {}),
    ...(newHouses !== null ? { houses: newHouses } : {}),
    ...(newElopement !== undefined ? { elopement: newElopement } : {}),
    ...(newArtifactInstances !== null ? { artifactInstances: newArtifactInstances } : {}),
    ...(newThiefAttempts !== null ? { thiefAttempts: newThiefAttempts } : {}),
  };
}

// P10 Branch 7 helper. Returns:
//   1. house head if alive
//   2. else lex-first living family member of the same house (excluding dead)
//   3. else dead.id (stranded — documented terminal case)
function pickArtifactInheritor(
  state: GameState,
  deadChar: { id: CharacterId; houseId: HouseId },
  liveChars: ReadonlyMap<CharacterId, { id: CharacterId; alive: boolean; houseId: HouseId }>,
): CharacterId {
  const house = state.houses.get(deadChar.houseId);
  if (house) {
    const head = liveChars.get(house.headOfHouseCharacterId);
    if (head?.alive && head.id !== deadChar.id) return head.id;
  }
  const candidates: CharacterId[] = [];
  for (const ch of liveChars.values()) {
    if (ch.houseId !== deadChar.houseId) continue;
    if (!ch.alive) continue;
    if (ch.id === deadChar.id) continue;
    candidates.push(ch.id);
  }
  candidates.sort((a, b) => a.localeCompare(b));
  return candidates[0] ?? deadChar.id;
}

export function applyAgingStep(state: GameState): GameState {
  const sortedCharIds = [...state.characters.keys()].sort();
  const characters = new Map(state.characters);
  // P5: narrowed to ReadonlySet<CharacterId> (was Set<string>). state.characters
  // is Map<CharacterId, Character>, so its .keys() yields CharacterId values
  // already — the narrowed Set typechecks without `as CharacterId` casts.
  const newlyDead = new Set<CharacterId>();
  for (const charId of sortedCharIds) {
    const char = characters.get(charId);
    if (char === undefined || !char.alive) continue;
    const nextAge = char.age + 1;
    const dies = nextAge >= char.deathAge;
    const updated: Character = {
      ...char,
      age: nextAge,
      alive: !dies,
      diedAtTick: dies ? state.tick : char.diedAtTick,
    };
    characters.set(charId, updated);
    if (dies) newlyDead.add(charId);
  }

  // Delegate orphan-prune to the shared helper. Passing { ...state, characters }
  // forwards the already-aged characters Map; the helper owns the
  // conversationHistory/affectionMap synthesis and returns the full new state.
  // P15: record the natural-death streak increment on the POST-prune state so
  // the counter write is not clobbered by the helper's own houses clone (the
  // prune branches spread ...house, preserving the counter through the clone).
  const pruned = pruneOrphanedConversationKeys({ ...state, characters }, newlyDead);
  return recordPlayerHeadNaturalDeath(pruned, newlyDead);
}

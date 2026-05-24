// P14: Family Tree tab. Text-first roster of the player house (ordered by
// birth), with the P11 sibling-rival sub-section, P7 tutor affordances, and a
// toggle into the spatial Social Web sub-view (Q9 "coexist" resolution). All
// mutations route through existing store actions.

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ADULTHOOD_AGE_IN_YEARS,
  SIBLING_RIVAL_ACTION_COOLDOWN_TICKS,
  SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST,
  SIBLING_RIVAL_RECONCILIATION_WEALTH_COST,
} from "../../../game/constants";
import type { Character } from "../../../game/entities";
import { type CharacterId, PLAYER_HOUSE_ID, type TraitId } from "../../../game/rng.seeds";
import type { SeasonStore } from "../../../game/store";
import { SocialWebView } from "../../socialWeb/SocialWebView";

type Props = {
  store: SeasonStore;
};

const MAX_INLINE_TRAITS = 6;

function CharacterRow({ c }: { c: Character }) {
  const traits = c.traits.slice(0, MAX_INLINE_TRAITS);
  const overflow = c.traits.length - traits.length;
  return (
    <li
      data-testid={`family-row-${c.id}`}
      className={`flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm ${c.alive ? "" : "opacity-60"}`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-200 text-xs font-semibold text-stone-700">
        {c.name.charAt(0)}
      </span>
      <span className="w-40 font-medium text-stone-800">
        {c.name}
        {c.alive ? "" : " †"}
      </span>
      <span className="w-12 text-stone-500">{c.age}y</span>
      <span className="w-24 text-stone-500">{c.role}</span>
      <span className="w-24 text-stone-500">{c.archetype}</span>
      <span className="w-20 text-stone-500">{c.mood}</span>
      {c.equippedArtifactIds.length > 0 && (
        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
          {c.equippedArtifactIds.length} equipped
        </span>
      )}
      <span className="flex flex-1 flex-wrap justify-end gap-1">
        {traits.map((t) => (
          <span key={t} className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">
            {t}
          </span>
        ))}
        {overflow > 0 && <span className="text-xs text-stone-400">+{overflow} more</span>}
      </span>
    </li>
  );
}

export function FamilyTreeTab({ store }: Props) {
  const { characters, houses, pendingTutorTraitChoices, tick } = store(
    useShallow((s) => ({
      characters: s.characters,
      houses: s.houses,
      pendingTutorTraitChoices: s.pendingTutorTraitChoices,
      tick: s.tick,
    })),
  );
  const reconcileSibling = store((s) => s.reconcileSibling);
  const assignTutor = store((s) => s.assignTutor);
  const chooseTutorBonusTrait = store((s) => s.chooseTutorBonusTrait);

  const [showWeb, setShowWeb] = useState(false);

  const playerHouse = houses.get(PLAYER_HOUSE_ID);
  const modalBlocked = playerHouse?.exiled === true || store.getState().elopement !== null;

  const members = [...characters.values()]
    .filter((c) => c.houseId === PLAYER_HOUSE_ID)
    .sort((a, b) => a.birthTick - b.birthTick || a.id.localeCompare(b.id));

  const siblingRivals = (playerHouse?.siblingRivals ?? []).filter((sr) => !sr.reconciled);
  const canReconcile =
    !modalBlocked &&
    (playerHouse?.wealth ?? 0) >= SIBLING_RIVAL_RECONCILIATION_WEALTH_COST &&
    (playerHouse?.reputation ?? 0) >= SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST;

  const untutored = members.filter(
    (c) =>
      c.alive &&
      c.role === "Dependent" &&
      c.age < ADULTHOOD_AGE_IN_YEARS &&
      c.assignedTutorCharacterId === null,
  );
  const eligibleTutors = members.filter(
    (c) => c.alive && c.archetype === "Tutor" && c.age >= ADULTHOOD_AGE_IN_YEARS,
  );
  const pendingChoices = [...pendingTutorTraitChoices.entries()].filter(
    ([childId]) => characters.get(childId)?.houseId === PLAYER_HOUSE_ID,
  );

  const onReconcile = (siblingCharacterId: CharacterId) => {
    const r = reconcileSibling(siblingCharacterId);
    if (!r.ok) console.warn(`reconcileSibling rejected: ${r.reason.kind ?? "unknown"}`);
  };
  const onAssignTutor = (childId: CharacterId, tutorId: CharacterId) => {
    const r = assignTutor(childId, tutorId);
    if (!r.ok) console.warn(`assignTutor rejected: ${r.reason.kind}`);
  };
  const onChooseTrait = (childId: CharacterId, traitId: TraitId) => {
    const r = chooseTutorBonusTrait(childId, traitId);
    if (!r.ok) console.warn(`chooseTutorBonusTrait rejected: ${r.reason.kind}`);
  };

  return (
    <section data-testid="ledger-tab-family-tree" className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">Family Tree</h2>
        <button
          type="button"
          onClick={() => setShowWeb((v) => !v)}
          data-testid="social-web-toggle"
          aria-pressed={showWeb}
          className="rounded-full border border-stone-300 px-3 py-1 text-sm font-medium text-stone-700 hover:bg-stone-100"
        >
          {showWeb ? "View Family List" : "View Social Web"}
        </button>
      </div>

      {showWeb ? (
        <SocialWebView store={store} />
      ) : (
        <>
          <ul data-testid="family-list" className="space-y-1">
            {members.map((c) => (
              <CharacterRow key={c.id} c={c} />
            ))}
          </ul>

          {siblingRivals.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                Sibling Rivals
              </h3>
              <ul data-testid="sibling-rivals-list" className="space-y-1">
                {siblingRivals.map((sr) => {
                  const c = characters.get(sr.characterId);
                  const cooldown = Math.max(
                    0,
                    sr.lastActionTick + SIBLING_RIVAL_ACTION_COOLDOWN_TICKS - tick,
                  );
                  return (
                    <li
                      key={sr.id}
                      data-testid={`sibling-rival-row-${sr.characterId}`}
                      className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
                    >
                      <span className="w-40 font-medium text-stone-800">
                        {c?.name ?? sr.characterId}
                      </span>
                      <span className="w-28 text-stone-600">Hostility {sr.hostility}</span>
                      <span className="w-28 text-stone-500">
                        {cooldown === 0 ? "Ready" : `${cooldown}t cooldown`}
                      </span>
                      <span className="flex-1" />
                      <button
                        type="button"
                        disabled={!canReconcile}
                        onClick={() => onReconcile(sr.characterId)}
                        title={`Costs ${SIBLING_RIVAL_RECONCILIATION_WEALTH_COST}g + ${SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST} reputation.`}
                        className="rounded bg-stone-800 px-2 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reconcile
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {untutored.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                Assign Tutor
              </h3>
              <ul data-testid="assign-tutor-list" className="space-y-1">
                {untutored.map((child) => (
                  <li
                    key={child.id}
                    className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                  >
                    <span className="w-40 font-medium text-stone-800">{child.name}</span>
                    <select
                      data-testid={`assign-tutor-select-${child.id}`}
                      defaultValue=""
                      disabled={modalBlocked || eligibleTutors.length === 0}
                      onChange={(e) => {
                        if (e.target.value !== "")
                          onAssignTutor(child.id, e.target.value as CharacterId);
                      }}
                      className="rounded border border-stone-300 px-2 py-1 text-sm"
                    >
                      <option value="">
                        {eligibleTutors.length === 0 ? "No eligible tutors" : "Assign a tutor…"}
                      </option>
                      {eligibleTutors.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingChoices.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                Tutor Bonus Trait
              </h3>
              <ul data-testid="tutor-trait-choices" className="space-y-1">
                {pendingChoices.map(([childId, choice]) => (
                  <li
                    key={childId}
                    data-testid={`tutor-trait-choice-${childId}`}
                    className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                  >
                    <span className="w-40 font-medium text-stone-800">
                      {characters.get(childId)?.name ?? childId}
                    </span>
                    <span className="flex flex-1 gap-2">
                      {choice.acceptableTraitIds.map((t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={modalBlocked}
                          onClick={() => onChooseTrait(childId, t)}
                          className="rounded bg-stone-800 px-2 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

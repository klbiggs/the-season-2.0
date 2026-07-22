// P14: Family Tree tab. Text-first roster of the player house (ordered by
// birth), with the P11 sibling-rival sub-section, P7 tutor affordances, and a
// toggle into the spatial Social Web sub-view (Q9 "coexist" resolution). All
// mutations route through existing store actions.
//
// P22: the binary Family↔Web toggle became a 3-mode segmented control adding
// "The Ton" (SocietyView). CharacterRow gained a deterministic colored monogram
// and a "Who is this?" bio expander (the revealNpcBio gate was lifted so player
// kin can also generate a bio).

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ADULTHOOD_AGE_IN_YEARS,
  SCHEME_TUNING,
  SIBLING_RIVAL_ACTION_COOLDOWN_TICKS,
  SIBLING_RIVAL_RECONCILIATION_REPUTATION_COST,
  SIBLING_RIVAL_RECONCILIATION_WEALTH_COST,
} from "../../../game/constants";
import type { Character, House } from "../../../game/entities";
import { flavorStubFor } from "../../../game/fixtures/flavorStubs";
import {
  type CharacterId,
  type FlavorContentId,
  PLAYER_HOUSE_ID,
  type TraitId,
} from "../../../game/rng.seeds";
import { hasActivePlayerElopement } from "../../../game/rules/elopement";
import type { SeasonStore } from "../../../game/store";
import { monogramLetter, monogramStyle } from "../../shared/monogram";
import { SocialWebView } from "../../socialWeb/SocialWebView";
import { SocietyView } from "../../society/SocietyView";

type Props = {
  store: SeasonStore;
};

type FamilyMode = "family" | "web" | "society";

const MAX_INLINE_TRAITS = 6;

function CharacterRow({
  c,
  factionId,
  bio,
  onRevealBio,
}: {
  c: Character;
  factionId: House["factionId"] | undefined;
  bio: string;
  onRevealBio: () => void;
}) {
  const traits = c.traits.slice(0, MAX_INLINE_TRAITS);
  const overflow = c.traits.length - traits.length;
  const mono = monogramStyle(c.id, factionId);
  return (
    <li
      data-testid={`family-row-${c.id}`}
      className={`rounded-md border border-stone-200 px-3 py-2 text-sm ${c.alive ? "" : "opacity-60"}`}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
          style={{
            backgroundColor: mono.backgroundColor,
            color: "#1c1917",
            boxShadow: `0 0 0 2px ${mono.ringColor}`,
          }}
        >
          {monogramLetter(c.name)}
        </span>
        <span className="w-40 font-medium text-stone-800">
          {c.name}
          {c.alive ? "" : " †"}
        </span>
        <span className="w-12 text-stone-500">{c.age}y</span>
        <span className="w-24 text-stone-500">{c.role}</span>
        <span className="w-24 text-stone-500">{c.archetype}</span>
        <span className="w-20 text-stone-500">{c.mood}</span>
        <span className="w-16 text-stone-500" title="Happiness (0-100)">
          hap {c.happiness}
        </span>
        <span className="w-20 text-stone-500" title="Composure / max">
          comp {c.composure}/{c.maxComposure}
        </span>
        {c.temptationHookUnlocked && (
          <span
            data-testid={`tempted-${c.id}`}
            title="Temptation hook unlocked (Dull-spouse drain crossed threshold)"
            className="rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800"
          >
            tempted
          </span>
        )}
        {c.dullSpouseExposureStartTick !== null && (
          <span
            title="Dull-spouse exposure (happiness drains while exposed)"
            className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
          >
            dull-spouse since t{c.dullSpouseExposureStartTick}
          </span>
        )}
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
      </div>
      <details
        data-testid={`family-bio-${c.id}`}
        className="mt-1 text-xs text-stone-500"
        onToggle={(e) => {
          if (e.currentTarget.open) onRevealBio();
        }}
      >
        <summary className="cursor-pointer select-none text-stone-400 hover:text-stone-600">
          Who is this?
        </summary>
        <p className="mt-1 italic leading-relaxed text-stone-600">{bio}</p>
      </details>
    </li>
  );
}

export function FamilyTreeTab({ store }: Props) {
  const {
    characters,
    houses,
    pendingTutorTraitChoices,
    marriages,
    proposalsLog,
    tutorAssignmentsLog,
    flavorText,
    tick,
  } = store(
    useShallow((s) => ({
      characters: s.characters,
      houses: s.houses,
      pendingTutorTraitChoices: s.pendingTutorTraitChoices,
      marriages: s.marriages,
      proposalsLog: s.proposalsLog,
      tutorAssignmentsLog: s.tutorAssignmentsLog,
      flavorText: s.flavorText,
      tick: s.tick,
    })),
  );
  const reconcileSibling = store((s) => s.reconcileSibling);
  const assignTutor = store((s) => s.assignTutor);
  const chooseTutorBonusTrait = store((s) => s.chooseTutorBonusTrait);
  const revealNpcBio = store((s) => s.revealNpcBio);
  const abandonMarriage = store((s) => s.abandonMarriage);
  const startScheme = store((s) => s.startScheme);

  const [mode, setMode] = useState<FamilyMode>("family");

  const playerHouse = houses.get(PLAYER_HOUSE_ID);
  const playerFactionId = playerHouse?.factionId;
  const bioFor = (c: Character): string => {
    const id = `bio:${c.id}` as FlavorContentId;
    return flavorText.get(id)?.text ?? flavorStubFor(id, { character: c });
  };
  const modalBlocked = playerHouse?.exiled === true || hasActivePlayerElopement(store.getState());

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

  const inPlayerHouse = (id: CharacterId): boolean =>
    characters.get(id)?.houseId === PLAYER_HOUSE_ID;
  // Marriages with at least one player-house spouse, lex-sorted by id.
  const playerMarriages = [...marriages.values()]
    .filter((m) => inPlayerHouse(m.spouseAId) || inPlayerHouse(m.spouseBId))
    .sort((a, b) => a.id.localeCompare(b.id));
  // proposalsLog is keyed by TARGET; the player's proposals are filtered by
  // PROPOSER (byCharacterId) — the target is an Independent NPC. At v1 every
  // proposal is player-made (proposal.ts), so this is forward-compat for P8 rivals.
  const playerProposals = [...proposalsLog.entries()]
    .filter(([, e]) => inPlayerHouse(e.byCharacterId))
    .sort(([a], [b]) => a.localeCompare(b));
  // tutorAssignmentsLog is keyed by CHILD (player-house); key-deref filter.
  const playerTutorLog = [...tutorAssignmentsLog.entries()]
    .filter(([childId]) => inPlayerHouse(childId))
    .sort(([a], [b]) => a.localeCompare(b));

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

  // P25 R10: OfficerCommission — the SOLE entry point for the self-improvement
  // scheme (the ballroom picker excludes it). Eligible = alive adult player-house
  // members without the MilitaryOfficer trait.
  const OFFICER_TRAIT = "MilitaryOfficer" as TraitId;
  const commissionCost = SCHEME_TUNING.OfficerCommission.wealthCost;
  const commissionEligible = members.filter(
    (c) => c.alive && c.age >= ADULTHOOD_AGE_IN_YEARS && !c.traits.includes(OFFICER_TRAIT),
  );
  const canCommission = !modalBlocked && (playerHouse?.wealth ?? 0) >= commissionCost;
  const onPurchaseCommission = (memberId: CharacterId) => {
    const r = startScheme({
      kind: "OfficerCommission",
      targetCharacterId: memberId,
      skipSelfTargetGate: true,
      explicitAggressorCharacterId: memberId,
    });
    if (!r.ok) console.warn(`OfficerCommission rejected: ${r.reason.kind}`);
  };

  // P22: 3-mode segmented control. "family" = text roster; "web" = the player-
  // perspective Social Web; "society" = the Ton view (society + rivals).
  const MODES: ReadonlyArray<{ key: FamilyMode; label: string }> = [
    { key: "family", label: "Family" },
    { key: "web", label: "Social Web" },
    { key: "society", label: "The Ton" },
  ];

  return (
    <section data-testid="ledger-tab-family-tree" className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">Family Tree</h2>
        <div
          data-testid="family-mode-toggle"
          className="inline-flex overflow-hidden rounded-full border border-stone-300 text-sm font-medium"
        >
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              data-testid={`family-mode-${m.key}`}
              aria-pressed={mode === m.key}
              className={`px-3 py-1 ${
                mode === m.key ? "bg-stone-800 text-white" : "text-stone-700 hover:bg-stone-100"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === "web" ? (
        <SocialWebView store={store} />
      ) : mode === "society" ? (
        <SocietyView store={store} />
      ) : (
        <>
          <ul data-testid="family-list" className="space-y-1">
            {members.map((c) => (
              <CharacterRow
                key={c.id}
                c={c}
                factionId={playerFactionId}
                bio={bioFor(c)}
                onRevealBio={() => revealNpcBio(c.id)}
              />
            ))}
          </ul>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
              Marriages
            </h3>
            {playerMarriages.length === 0 ? (
              <p className="text-sm text-stone-500">No marriages yet.</p>
            ) : (
              <ul data-testid="family-marriages-list" className="space-y-1">
                {playerMarriages.map((m) => {
                  const a = characters.get(m.spouseAId)?.name ?? "—";
                  const b = characters.get(m.spouseBId)?.name ?? "—";
                  return (
                    <li
                      key={m.id}
                      data-testid={`marriage-row-${m.id}`}
                      className={`flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm ${
                        m.dissolved ? "opacity-60" : ""
                      }`}
                    >
                      <span className="flex-1 font-medium text-stone-800">
                        {a} <span className="text-stone-400">&amp;</span> {b}
                      </span>
                      <span className="w-20 text-stone-400">t{m.marriedAtTick}</span>
                      {m.viaElopement && (
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-800">
                          eloped
                        </span>
                      )}
                      {m.viaAbandonment && (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800">
                          abandoned
                        </span>
                      )}
                      {m.dissolved && (
                        <span className="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-600">
                          dissolved{m.dissolvedAtTick !== null ? ` t${m.dissolvedAtTick}` : ""}
                        </span>
                      )}
                      {!m.dissolved && (
                        <button
                          type="button"
                          data-testid={`marriage-abandon-${m.id}`}
                          disabled={modalBlocked}
                          title="Abandon this marriage (Divorce) — dissolves it at a scandal cost; frees both spouses to remarry."
                          onClick={() => {
                            if (
                              window.confirm(
                                "Abandon this marriage? This applies scandal and cannot be undone.",
                              )
                            ) {
                              abandonMarriage(m.id);
                            }
                          }}
                          className="rounded bg-rose-700 px-2 py-1 text-xs font-medium text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Abandon
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

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

          {commissionEligible.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                Officer Commissions
              </h3>
              <ul data-testid="officer-commission-list" className="space-y-1">
                {commissionEligible.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                  >
                    <span className="w-40 font-medium text-stone-800">{c.name}</span>
                    <button
                      type="button"
                      data-testid={`purchase-commission-${c.id}`}
                      disabled={!canCommission}
                      onClick={() => onPurchaseCommission(c.id)}
                      className="rounded border border-stone-300 px-2 py-1 text-sm disabled:opacity-40"
                      title={
                        canCommission
                          ? undefined
                          : `Requires ${commissionCost} wealth (and no active elopement/exile)`
                      }
                    >
                      Purchase a Commission ({commissionCost} wealth)
                    </button>
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

          {playerProposals.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                Recent Proposals
              </h3>
              <ul data-testid="proposals-log-list" className="space-y-1">
                {playerProposals.map(([targetId, entry]) => (
                  <li
                    key={targetId}
                    data-testid={`proposal-log-row-${targetId}`}
                    className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                  >
                    <span className="flex-1 font-medium text-stone-800">
                      {characters.get(targetId)?.name ?? targetId}
                    </span>
                    <span
                      className={`w-24 ${entry.outcome === "Accepted" ? "text-green-700" : "text-rose-700"}`}
                    >
                      {entry.outcome}
                    </span>
                    <span className="w-16 text-stone-400">t{entry.tick}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {playerTutorLog.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
                Tutor Assignments
              </h3>
              <ul data-testid="tutor-assignments-log-list" className="space-y-1">
                {playerTutorLog.map(([childId, entry]) => (
                  <li
                    key={childId}
                    data-testid={`tutor-log-row-${childId}`}
                    className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                  >
                    <span className="flex-1 font-medium text-stone-800">
                      {characters.get(childId)?.name ?? childId}
                    </span>
                    <span className="flex-1 text-stone-600">
                      {characters.get(entry.tutorCharacterId)?.name ?? entry.tutorCharacterId}
                    </span>
                    <span className="w-16 text-stone-400">t{entry.assignedAtTick}</span>
                    {entry.reassignmentCount > 0 && (
                      <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">
                        ×{entry.reassignmentCount}
                      </span>
                    )}
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

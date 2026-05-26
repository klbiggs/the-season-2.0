// P14: Grievances tab. Lists the player house's grievances (the house is the
// VICTIM; perpetrator referenced by perpetratorHouseId). Outstanding grievances
// expose "Demand Satisfaction" → duel; resolved grievances are read-only. The
// rule-layer demandSatisfaction action owns full validation — the UI greys the
// button when any gate would reject and surfaces the duel outcome inline.

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Duel, DuelOutcome, Grievance } from "../../../game/entities";
import { type GrievanceId, type HouseId, PLAYER_HOUSE_ID } from "../../../game/rng.seeds";
import type { SeasonStore } from "../../../game/store";
import { houseDisplayName } from "../houseName";

type Props = {
  store: SeasonStore;
};

const OUTCOME_PROSE: Readonly<Record<DuelOutcome, string>> = {
  ChallengerVictory: "You prevailed in the duel.",
  DefenderVictory: "You were bested in the duel.",
  Stalemate: "The duel ended in a stalemate.",
};

export function GrievancesTab({ store }: Props) {
  const { houses, characters, elopement, duels } = store(
    useShallow((s) => ({
      houses: s.houses,
      characters: s.characters,
      elopement: s.elopement,
      duels: s.duels,
    })),
  );
  const demandSatisfaction = store((s) => s.demandSatisfaction);
  const [result, setResult] = useState<string | null>(null);

  const playerHouse = houses.get(PLAYER_HOUSE_ID);
  const playerExiled = playerHouse?.exiled === true;
  const grievances = playerHouse?.grievances ?? [];
  const outstanding = grievances.filter((g) => g.resolved === false);
  const resolved = grievances.filter((g) => g.resolved === true);

  // Duels involving a player-house character (challenger OR defender), lex-sorted
  // by id. v1 only ever mints player-involved duels (demandSatisfaction is the
  // sole source); the filter is defensive but cheap.
  const playerInvolvedDuel = (d: Duel): boolean =>
    characters.get(d.challengerCharacterId)?.houseId === PLAYER_HOUSE_ID ||
    characters.get(d.defenderCharacterId)?.houseId === PLAYER_HOUSE_ID;
  const duelHistory = [...duels.values()]
    .filter(playerInvolvedDuel)
    .sort((a, b) => a.id.localeCompare(b.id));

  const canDemand = (g: Grievance): boolean => {
    if (g.defendantCharacterId === null) return false;
    if (playerExiled || elopement !== null) return false;
    const defender = characters.get(g.defendantCharacterId);
    if (defender === undefined || !defender.alive) return false;
    const defenderHouse = houses.get(defender.houseId);
    if (defenderHouse?.exiled === true) return false;
    return true;
  };

  const onDemand = (perpetratorHouseId: HouseId, grievanceId: GrievanceId) => {
    const outcome = demandSatisfaction(perpetratorHouseId, grievanceId);
    if (!outcome.ok) {
      setResult(`Cannot demand satisfaction: ${outcome.reason.kind}.`);
      return;
    }
    setResult(OUTCOME_PROSE[outcome.outcome]);
  };

  return (
    <section data-testid="ledger-tab-grievances" className="space-y-6">
      <h2 className="text-lg font-semibold text-stone-800">Grievances</h2>

      {result !== null && (
        <output
          aria-live="polite"
          data-testid="grievance-result"
          className="block rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-700"
        >
          {result}
        </output>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Outstanding</h3>
        {outstanding.length === 0 ? (
          <p className="text-sm text-stone-500">No outstanding grievances.</p>
        ) : (
          <ul data-testid="grievances-outstanding-list" className="space-y-2">
            {outstanding.map((g) => {
              const defender =
                g.defendantCharacterId !== null ? characters.get(g.defendantCharacterId) : null;
              const enabled = canDemand(g);
              return (
                <li
                  key={g.id}
                  data-testid={`grievance-row-${g.id}`}
                  className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                >
                  <span className="w-40 font-medium text-stone-800">
                    {houseDisplayName(g.perpetratorHouseId)}
                  </span>
                  <span className="w-24 text-stone-500">{g.source}</span>
                  <span className="w-16 text-stone-500">t{g.recordedAtTick}</span>
                  <span className="flex-1 text-stone-600">{defender?.name ?? "—"}</span>
                  <button
                    type="button"
                    disabled={!enabled}
                    title={
                      g.defendantCharacterId === null
                        ? "Legacy grievance — defendant unrecorded."
                        : "Demand satisfaction — resolves to a duel."
                    }
                    onClick={() => onDemand(g.perpetratorHouseId, g.id)}
                    className="rounded bg-stone-800 px-2 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Demand Satisfaction
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Resolved</h3>
        {resolved.length === 0 ? (
          <p className="text-sm text-stone-500">No resolved grievances.</p>
        ) : (
          <ul data-testid="grievances-resolved-list" className="space-y-1">
            {resolved.map((g) => (
              <li
                key={g.id}
                className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
              >
                <span className="w-40 font-medium text-stone-800">
                  {houseDisplayName(g.perpetratorHouseId)}
                </span>
                <span className="w-24 text-stone-500">{g.source}</span>
                <span className="w-16 text-stone-500">t{g.recordedAtTick}</span>
                <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                  Resolved
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Duels</h3>
        {duelHistory.length === 0 ? (
          <p className="text-sm text-stone-500">No duels fought.</p>
        ) : (
          <ul data-testid="grievances-duels-list" className="space-y-1">
            {duelHistory.map((d) => {
              const challenger = characters.get(d.challengerCharacterId)?.name ?? "—";
              const defender = characters.get(d.defenderCharacterId)?.name ?? "—";
              return (
                <li
                  key={d.id}
                  data-testid={`duel-row-${d.id}`}
                  className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                >
                  <span className="flex-1 font-medium text-stone-800">
                    {challenger} <span className="text-stone-400">vs</span> {defender}
                  </span>
                  <span className="w-20 text-stone-500">{d.status}</span>
                  <span className="w-32 text-stone-600">{d.outcome ?? "—"}</span>
                  <span className="w-20 text-stone-500">{d.loserCasualty}</span>
                  <span className="w-28 text-stone-400">
                    t{d.initiatedAtTick}
                    {d.resolvedAtTick !== null ? `→t${d.resolvedAtTick}` : ""}
                  </span>
                  <span className="w-16 text-stone-400">{d.exchangesElapsed}/12</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

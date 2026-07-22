// P14: Rivals tab. Per-rival action-loop state (hostility on the House entity,
// cooldown derived from RivalActorState.lastActionTick) plus the player house's
// Inherited Secrets ledger and active Blood Feuds (P11). All read-only.

import { useShallow } from "zustand/react/shallow";
import {
  BLOOD_FEUD_DECAY_TICKS_MAX,
  MAX_INHERITED_SECRETS,
  OLIVE_BRANCH_WEALTH_COST,
  RIVAL_ACTION_COOLDOWN_TICKS,
} from "../../../game/constants";
import { type HouseId, PLAYER_HOUSE_ID } from "../../../game/rng.seeds";
import { hasActivePlayerElopement } from "../../../game/rules/elopement";
import type { SeasonStore } from "../../../game/store";
import { houseDisplayName } from "../houseName";

type Props = {
  store: SeasonStore;
};

export function RivalsTab({ store }: Props) {
  const { rivalActors, houses, tick } = store(
    useShallow((s) => ({ rivalActors: s.rivalActors, houses: s.houses, tick: s.tick })),
  );

  const extendOliveBranch = store((s) => s.extendOliveBranch);
  const declareWar = store((s) => s.declareWar);

  const rivals = [...rivalActors.values()].sort((a, b) => a.houseId.localeCompare(b.houseId));
  const playerHouse = houses.get(PLAYER_HOUSE_ID);
  const modalBlocked = playerHouse?.exiled === true || hasActivePlayerElopement(store.getState());
  const canOliveBranch = !modalBlocked && (playerHouse?.wealth ?? 0) >= OLIVE_BRANCH_WEALTH_COST;
  const onOliveBranch = (rivalHouseId: HouseId) => {
    const r = extendOliveBranch(rivalHouseId);
    if (!r.ok) console.warn(`extendOliveBranch rejected: ${r.reason.kind}`);
  };
  const onDeclareWar = (rivalHouseId: HouseId) => {
    const r = declareWar(rivalHouseId);
    if (!r.ok) console.warn(`declareWar rejected: ${r.reason.kind}`);
  };
  const secrets = playerHouse?.inheritedSecrets ?? [];
  const feuds = playerHouse?.bloodFeuds ?? [];
  const visibleSecrets = secrets.slice(0, MAX_INHERITED_SECRETS);
  const collapsedSecretCount = Math.max(0, secrets.length - MAX_INHERITED_SECRETS);

  return (
    <section data-testid="ledger-tab-rivals" className="space-y-6">
      <h2 className="text-lg font-semibold text-stone-800">Rivals</h2>

      <ul data-testid="rivals-list" className="space-y-2">
        {rivals.map((r) => {
          const hostility = houses.get(r.houseId)?.hostility ?? 0;
          const cooldown =
            r.lastActionTick === null
              ? null
              : Math.max(0, r.lastActionTick + RIVAL_ACTION_COOLDOWN_TICKS - tick);
          return (
            <li
              key={r.houseId}
              data-testid={`rival-row-${r.houseId}`}
              className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
            >
              <span className="w-40 font-medium text-stone-800">{houseDisplayName(r.houseId)}</span>
              <span className="w-28 text-stone-600">Hostility {hostility}</span>
              <span className="w-24 text-stone-500">
                Last: {r.lastActionTick === null ? "—" : `t${r.lastActionTick}`}
              </span>
              <span className="w-28 text-stone-500">
                {cooldown === null || cooldown === 0 ? "Ready" : `${cooldown}t cooldown`}
              </span>
              <span className="w-24 text-stone-500">
                {r.associatedCharacterIds.length} associates
              </span>
              {/* P25 R4: inline diplomacy actions (olive branch / declare war). */}
              <span className="flex flex-1 justify-end gap-2">
                <button
                  type="button"
                  data-testid={`rival-olive-branch-${r.houseId}`}
                  disabled={!canOliveBranch}
                  onClick={() => onOliveBranch(r.houseId)}
                  className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-50 disabled:opacity-40"
                  title={`Olive Branch (−${OLIVE_BRANCH_WEALTH_COST} wealth, cools hostility)`}
                >
                  Olive Branch
                </button>
                <button
                  type="button"
                  data-testid={`rival-declare-war-${r.houseId}`}
                  disabled={modalBlocked}
                  onClick={() => onDeclareWar(r.houseId)}
                  className="rounded border border-rose-300 px-2 py-0.5 text-xs text-rose-800 hover:bg-rose-50 disabled:opacity-40"
                  title="Declare War (raises hostility + your scandal)"
                >
                  Declare War
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
          Inherited Secrets
        </h3>
        {visibleSecrets.length === 0 ? (
          <p className="text-sm text-stone-500">No inherited secrets.</p>
        ) : (
          <ul data-testid="inherited-secrets-list" className="space-y-1">
            {visibleSecrets.map((s) => {
              const surfaced = s.surfacedAgainstHouseId !== null;
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                >
                  <span className="flex-1 text-stone-700">{s.description}</span>
                  <span className="w-20 text-stone-500">Gen {s.originatingGenerationCount}</span>
                  {surfaced ? (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                      Surfaced vs {houseDisplayName(s.surfacedAgainstHouseId ?? PLAYER_HOUSE_ID)}
                    </span>
                  ) : (
                    <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                      Unsurfaced
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {collapsedSecretCount > 0 && (
          <p data-testid="inherited-secrets-collapsed" className="text-xs text-stone-400">
            +{collapsedSecretCount} collapsed into ancestor summary
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Blood Feuds</h3>
        {feuds.length === 0 ? (
          <p className="text-sm text-stone-500">No active blood feuds.</p>
        ) : (
          <ul data-testid="blood-feuds-list" className="space-y-1">
            {feuds.map((f) => {
              const triggeringSecret = secrets.find((s) => s.id === f.triggeringSecretId);
              const decayRemaining = Math.max(
                0,
                BLOOD_FEUD_DECAY_TICKS_MAX - (tick - f.incurredAtTick),
              );
              return (
                <li
                  key={f.id}
                  data-testid={`blood-feud-row-${f.id}`}
                  className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                >
                  <span className="w-40 font-medium text-stone-800">
                    {houseDisplayName(f.offendingHouseId)}
                  </span>
                  <span className="flex-1 truncate text-stone-600">
                    {triggeringSecret?.description ?? f.triggeringSecretId}
                  </span>
                  <span className="w-16 text-stone-500">t{f.incurredAtTick}</span>
                  {f.resolved ? (
                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                      {f.resolutionKind ?? "Resolved"}
                      {f.resolvedAtTick !== null ? ` t${f.resolvedAtTick}` : ""}
                    </span>
                  ) : (
                    <span className="w-28 text-right text-stone-500">
                      {decayRemaining}t to decay
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

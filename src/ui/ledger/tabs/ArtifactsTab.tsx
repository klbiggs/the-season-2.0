// P14: Artifacts tab — the P10 UI consumer. Player inventory (grouped by
// holder) with equip/unequip + wardrobe refresh; the forgery ledger (gated on
// a living Bohemian Rake) with a commission affordance; and thief-attempt
// banners with a thwart affordance. All mutations route through the existing
// P10/P3 store actions; rule-layer rejections surface via the shared toast.

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  THWART_WEALTH_COST,
  WARDROBE_REFRESH_INTERVAL_TICKS,
  WARDROBE_REFRESH_WEALTH_COST,
} from "../../../game/constants";
import type { ArtifactInstance, Character, GameState } from "../../../game/entities";
import { ARTIFACT_REGISTRY, resolveArtifactDefinition } from "../../../game/fixtures/artifacts";
import { flavorStubFor } from "../../../game/fixtures/flavorStubs";
import type {
  ArtifactDefinitionId,
  ArtifactInstanceId,
  CharacterId,
  FlavorContentId,
} from "../../../game/rng.seeds";
import { PLAYER_HOUSE_ID } from "../../../game/rng.seeds";
import { hasActivePlayerElopement } from "../../../game/rules/elopement";
import type { SeasonStore } from "../../../game/store";
import { ActionRejectionToast } from "../../map/ActionRejectionToast";

type Props = {
  store: SeasonStore;
};

const FORGEABLE_DEFS = [...ARTIFACT_REGISTRY.values()].filter((d) => d.forgeable);

export function ArtifactsTab({ store }: Props) {
  const {
    artifactInstances,
    forgeries,
    thiefAttempts,
    characters,
    houses,
    flavorText,
    proceduralArtifactDefinitions,
  } = store(
    useShallow((s) => ({
      artifactInstances: s.artifactInstances,
      forgeries: s.forgeries,
      thiefAttempts: s.thiefAttempts,
      characters: s.characters,
      houses: s.houses,
      flavorText: s.flavorText,
      proceduralArtifactDefinitions: s.proceduralArtifactDefinitions,
    })),
  );
  // P24b: definition lookups route through the resolver (fixture registry +
  // procedural defs). The resolver only reads proceduralArtifactDefinitions, so
  // a minimal synth-state suffices (the `?? fixture` half resolves the rest).
  const resolveDef = (definitionId: ArtifactDefinitionId) =>
    resolveArtifactDefinition(
      { proceduralArtifactDefinitions } as unknown as GameState,
      definitionId,
    );
  // Display name for a targeted instance (theft banners / history), falling back
  // to a generic label when the instance or definition is gone.
  const displayNameForInstance = (instId: ArtifactInstanceId): string => {
    const did = artifactInstances.get(instId)?.definitionId;
    return (did !== undefined ? resolveDef(did)?.displayName : undefined) ?? "an artifact";
  };
  const equipArtifact = store((s) => s.equipArtifact);
  const unequipArtifact = store((s) => s.unequipArtifact);
  const refreshWardrobe = store((s) => s.refreshWardrobe);
  const commissionForgery = store((s) => s.commissionForgery);
  const thwartTheft = store((s) => s.thwartTheft);
  const tick = store((s) => s.tick);

  const [toast, setToast] = useState<string | null>(null);
  const [forgeChoice, setForgeChoice] = useState<ArtifactDefinitionId | "">("");
  // P24b (E5): chosen forger among multiple living Rakes ("" → default to the
  // lex-smallest). Only surfaced when >1 Rake exists.
  const [forgerChoice, setForgerChoice] = useState<CharacterId | "">("");

  const playerHouse = houses.get(PLAYER_HOUSE_ID);
  const playerExiled = playerHouse?.exiled === true;
  const atCapital = playerHouse?.currentLocation === "Capital";
  const elopementActive = store((s) => hasActivePlayerElopement(s));
  const modalBlocked = playerExiled || elopementActive;

  // Inventory grouped by holder (lex-sorted within each group).
  const grouped = useMemo(() => {
    const out = new Map<CharacterId, ArtifactInstance[]>();
    const owned = [...artifactInstances.values()]
      .filter((a) => a.ownerHouseId === PLAYER_HOUSE_ID)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const inst of owned) {
      const list = out.get(inst.ownerCharacterId) ?? [];
      list.push(inst);
      out.set(inst.ownerCharacterId, list);
    }
    return out;
  }, [artifactInstances]);

  // P24b (E5): ALL living player-house Rakes (lex-sorted), so the player can
  // pick which one commissions when more than one exists.
  const livingRakes = useMemo(
    () =>
      [...characters.values()]
        .filter((c) => c.houseId === PLAYER_HOUSE_ID && c.alive && c.archetype === "BohemianRake")
        .sort((a, b) => a.id.localeCompare(b.id)),
    [characters],
  );
  const livingRake = livingRakes[0] ?? null;
  // Resolve the chosen forger; falls back to the lex-smallest Rake when the
  // picker is at its default or the prior choice has died/changed houses.
  const selectedForger =
    (forgerChoice !== "" ? livingRakes.find((r) => r.id === forgerChoice) : undefined) ??
    livingRake;

  const livingSpymaster = useMemo(
    () =>
      [...characters.values()].some(
        (c) => c.houseId === PLAYER_HOUSE_ID && c.alive && c.archetype === "Spymaster",
      ),
    [characters],
  );

  const isEquipped = (holder: Character, instanceId: ArtifactInstanceId): boolean =>
    holder.equippedArtifactIds.includes(instanceId);

  // Mirror the rule-layer max-one-per-family gate: equip is blocked when the
  // holder already equips a different instance of the same family.
  const familyConflict = (holder: Character, inst: ArtifactInstance): boolean => {
    const candidateFamily = resolveDef(inst.definitionId)?.family;
    if (candidateFamily === undefined) return false;
    for (const equippedId of holder.equippedArtifactIds) {
      if (equippedId === inst.id) continue;
      const equippedInst = artifactInstances.get(equippedId);
      if (equippedInst === undefined) continue;
      if (resolveDef(equippedInst.definitionId)?.family === candidateFamily) return true;
    }
    return false;
  };

  const onEquip = (holder: Character, instanceId: ArtifactInstanceId) => {
    const r = equipArtifact(holder.id, instanceId);
    if (!r.ok) setToast(`Cannot equip: ${r.reason.kind}.`);
  };
  const onUnequip = (holder: Character, instanceId: ArtifactInstanceId) => {
    const r = unequipArtifact(holder.id, instanceId);
    if (!r.ok) setToast(`Cannot unequip: ${r.reason.kind}.`);
  };
  const onRefresh = () => {
    const r = refreshWardrobe();
    if (!r.ok) setToast(`Cannot refresh wardrobe: ${r.reason.kind}.`);
  };
  const onCommission = () => {
    if (selectedForger === null || forgeChoice === "") return;
    const r = commissionForgery(selectedForger.id, forgeChoice);
    if (!r.ok) setToast(`Cannot commission forgery: ${r.reason.kind}.`);
    else setForgeChoice("");
  };
  const onThwart = (id: import("../../../game/rng.seeds").ThiefAttemptId) => {
    const r = thwartTheft(id);
    if (!r.ok) setToast(`Cannot thwart: ${r.reason.kind}.`);
    else setToast(r.outcome === "Thwarted" ? "Theft thwarted." : "The artifact was stolen.");
  };

  // P24b (E4): thwart affordance is player-house-only — non-player thefts
  // auto-resolve in the sweep and must not surface a banner (the rule layer
  // rejects NotPlayerOwnedTarget as defense-in-depth).
  const inFlightThefts = [...thiefAttempts.values()]
    .filter(
      (t) =>
        t.thwarted === null &&
        artifactInstances.get(t.targetedArtifactInstanceId)?.ownerHouseId === PLAYER_HOUSE_ID,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const resolvedThefts = [...thiefAttempts.values()]
    .filter((t) => t.thwarted !== null)
    .sort((a, b) => b.noticedAtTick - a.noticedAtTick);

  return (
    <section data-testid="ledger-tab-artifacts" className="space-y-6">
      <h2 className="text-lg font-semibold text-stone-800">Artifacts</h2>

      {inFlightThefts.length > 0 && (
        <div data-testid="thief-attempt-banners" className="space-y-2">
          {inFlightThefts.map((t) => (
            <div
              key={t.id}
              data-testid={`thief-attempt-${t.id}`}
              className="flex items-center gap-3 rounded-md border-2 border-red-500 bg-red-50 px-3 py-2 text-sm"
            >
              <span className="flex-1 font-medium text-red-800">
                Thief targeting {displayNameForInstance(t.targetedArtifactInstanceId)} (noticed t
                {t.noticedAtTick})
              </span>
              <button
                type="button"
                disabled={modalBlocked || !livingSpymaster}
                onClick={() => onThwart(t.id)}
                className="rounded bg-red-700 px-2 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Thwart Attempt ({THWART_WEALTH_COST}g)
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={modalBlocked || !atCapital}
          onClick={onRefresh}
          data-testid="refresh-wardrobe-btn"
          title={atCapital ? "" : "Must be at the Capital to refresh your wardrobe."}
          className="rounded bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refresh Wardrobe ({WARDROBE_REFRESH_WEALTH_COST}g)
        </button>
      </div>

      <div className="space-y-3" data-testid="artifact-inventory">
        {grouped.size === 0 ? (
          <p className="text-sm text-stone-500">No artifacts owned.</p>
        ) : (
          [...grouped.entries()].map(([ownerId, instances]) => {
            const holder = characters.get(ownerId);
            return (
              <div key={ownerId} className="space-y-1">
                <h3 className="text-sm font-medium text-stone-500">{holder?.name ?? ownerId}</h3>
                <ul className="space-y-1">
                  {instances.map((inst) => {
                    const def = resolveDef(inst.definitionId);
                    // P18: persisted backstory if generated, else the designer
                    // stub. The id is "artifact:<definitionId>".
                    const backstoryId = `artifact:${inst.definitionId}` as FlavorContentId;
                    const backstory =
                      flavorText.get(backstoryId)?.text ?? flavorStubFor(backstoryId);
                    const equipped = holder !== undefined && isEquipped(holder, inst.id);
                    const outOfSeason =
                      equipped && tick - inst.lastRefreshTick > WARDROBE_REFRESH_INTERVAL_TICKS;
                    const equipDisabled =
                      holder === undefined ||
                      modalBlocked ||
                      !holder.alive ||
                      familyConflict(holder, inst);
                    return (
                      <li
                        key={inst.id}
                        data-testid={`artifact-row-${inst.id}`}
                        className="flex flex-col gap-1 rounded-md border border-stone-200 px-3 py-2 text-sm"
                      >
                        <div className="flex w-full items-center gap-2">
                          <span className="w-44 font-medium text-stone-800">
                            {def?.displayName ?? inst.definitionId}
                          </span>
                          <span className="w-20 text-xs text-stone-500">{def?.family}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-medium ${equipped ? "bg-blue-100 text-blue-800" : "bg-stone-100 text-stone-500"}`}
                          >
                            {equipped ? "Equipped" : "Unequipped"}
                          </span>
                          {equipped && (
                            <span
                              data-testid={`wardrobe-badge-${inst.id}`}
                              className={`rounded px-1.5 py-0.5 text-xs font-medium ${outOfSeason ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}
                            >
                              {outOfSeason ? "Out of season" : "In season"}
                            </span>
                          )}
                          <span className="text-xs text-stone-500">
                            +{def?.reputationBonusWhileEquipped ?? 0} rep
                          </span>
                          <span className="text-xs text-stone-500">
                            {def?.scandalRiskWhileEquipped ?? 0} scandal-risk
                          </span>
                          {inst.forgedFlag && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                              Forged
                            </span>
                          )}
                          <span className="flex-1" />
                          {equipped ? (
                            <button
                              type="button"
                              disabled={holder === undefined || modalBlocked}
                              onClick={() => holder !== undefined && onUnequip(holder, inst.id)}
                              className="rounded bg-stone-200 px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Unequip
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={equipDisabled}
                              onClick={() => holder !== undefined && onEquip(holder, inst.id)}
                              title={
                                holder !== undefined && familyConflict(holder, inst)
                                  ? "Already wearing an artifact of this family."
                                  : ""
                              }
                              className="rounded bg-stone-800 px-2 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Equip
                            </button>
                          )}
                        </div>
                        <details
                          data-testid={`artifact-backstory-${inst.id}`}
                          className="text-xs text-stone-500"
                        >
                          <summary className="cursor-pointer select-none text-stone-400 hover:text-stone-600">
                            Backstory
                          </summary>
                          <p className="mt-1 italic leading-relaxed text-stone-600">{backstory}</p>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </div>

      <div className="space-y-2" data-testid="forgery-ledger">
        <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">Forgery</h3>
        {livingRake === null ? (
          <p className="text-sm text-stone-500">
            Forgery requires a living Bohemian Rake in the household.
          </p>
        ) : (
          <>
            <ul className="space-y-1">
              {[...forgeries.values()]
                .filter((f) => characters.get(f.forgerCharacterId)?.houseId === PLAYER_HOUSE_ID)
                .sort((a, b) => a.id.localeCompare(b.id))
                .map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
                  >
                    <span className="w-40 font-medium text-stone-800">
                      {characters.get(f.forgerCharacterId)?.name ?? f.forgerCharacterId}
                    </span>
                    <span className="w-20 text-stone-500">t{f.forgedAtTick}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${f.surfaced ? "bg-red-100 text-red-800" : "bg-stone-100 text-stone-600"}`}
                    >
                      {f.surfaced
                        ? `Surfaced${f.surfacedAtTick !== null ? ` t${f.surfacedAtTick}` : ""}`
                        : "Unsurfaced"}
                    </span>
                  </li>
                ))}
            </ul>
            <div className="flex items-center gap-2">
              {livingRakes.length > 1 && (
                <select
                  data-testid="forger-choice"
                  value={forgerChoice}
                  onChange={(e) => setForgerChoice(e.target.value as CharacterId | "")}
                  title="Which Bohemian Rake commissions the forgery"
                  className="rounded border border-stone-300 px-2 py-1 text-sm"
                >
                  <option value="">Forger: {livingRake?.name ?? "—"} (default)</option>
                  {livingRakes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
              <select
                data-testid="forge-choice"
                value={forgeChoice}
                onChange={(e) => setForgeChoice(e.target.value as ArtifactDefinitionId | "")}
                className="rounded border border-stone-300 px-2 py-1 text-sm"
              >
                <option value="">Choose an artifact to forge…</option>
                {FORGEABLE_DEFS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.displayName} ({d.family}) — {d.forgeWealthCost}g
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={modalBlocked || forgeChoice === ""}
                onClick={onCommission}
                data-testid="commission-forgery-btn"
                className="rounded bg-stone-800 px-2 py-1 text-xs font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Commission
              </button>
            </div>
          </>
        )}
      </div>

      {resolvedThefts.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
            Theft History
          </h3>
          <ul className="space-y-1">
            {resolvedThefts.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 text-sm"
              >
                <span className="flex-1 text-stone-600">
                  {displayNameForInstance(t.targetedArtifactInstanceId)} (t{t.noticedAtTick})
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${t.thwarted ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
                >
                  {t.thwarted ? "Thwarted" : "Stolen"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast !== null && <ActionRejectionToast message={toast} onDismiss={() => setToast(null)} />}
    </section>
  );
}

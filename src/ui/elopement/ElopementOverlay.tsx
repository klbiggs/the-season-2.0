// P9 elopement sprint overlay — mounts when state.elopement !== null.
// Replaces the Map view (overlay-suspends-Map per spec §3 line 46) until the
// sprint resolves. Three action buttons (Push, Fresh Horses, Surrender) plus
// a confirm-on-exit affordance that maps to Surrender.

import { useEffect, useRef, useState } from "react";
import {
  ELOPEMENT_FRESH_HORSES_MAX_USES,
  ELOPEMENT_FRESH_HORSES_WEALTH_COST,
  ELOPEMENT_PUSH_COMPOSURE_COST,
  ELOPEMENT_TRACK_LENGTH,
} from "../../game/constants";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { SeasonStore } from "../../game/store";

type Props = {
  store: SeasonStore;
};

export function ElopementOverlay({ store }: Props) {
  const sprint = store((s) => s.elopement);
  const characters = store((s) => s.characters);
  const houses = store((s) => s.houses);
  const focusRef = useRef<HTMLButtonElement | null>(null);
  const [confirmSurrender, setConfirmSurrender] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (sprint !== null) focusRef.current?.focus();
  }, [sprint]);

  // The overlay only mounts when sprint is non-null, but a defensive null-guard
  // covers the brief tick between mount and the next state read.
  if (sprint === null) return null;

  const eloping = characters.get(sprint.elopingCharacterId);
  const target = characters.get(sprint.targetCharacterId);
  const playerHouse = houses.get(PLAYER_HOUSE_ID);

  const elopingName = eloping?.name ?? "(unknown)";
  const targetName = target?.name ?? "(unknown)";
  const elopingComposure = eloping?.composure ?? 0;
  const playerWealth = playerHouse?.wealth ?? 0;
  const freshHorsesRemaining = ELOPEMENT_FRESH_HORSES_MAX_USES - sprint.freshHorsesUsedCount;
  const freshHorsesExhausted = freshHorsesRemaining <= 0;
  const freshHorsesUnaffordable = playerWealth < ELOPEMENT_FRESH_HORSES_WEALTH_COST;

  // Disclosure card visibility — either party already married (non-null,
  // non-dissolved marriageId). Q3 verdict's pre-sprint disclosure surface.
  const isMarried = (marriageId: typeof sprint.elopingCharacterId | null): boolean => {
    if (marriageId === null) return true; // sentinel — caller passes char.marriageId
    return false;
  };
  void isMarried; // suppress unused warning
  const elopingMarriageActive = (() => {
    if (eloping?.marriageId == null) return false;
    const m = store.getState().marriages.get(eloping.marriageId);
    return m !== undefined && !m.dissolved;
  })();
  const targetMarriageActive = (() => {
    if (target?.marriageId == null) return false;
    const m = store.getState().marriages.get(target.marriageId);
    return m !== undefined && !m.dissolved;
  })();
  const showDisclosureCard = elopingMarriageActive || targetMarriageActive;

  // Build the 7-tile track (indices 0..6 are tiles; the finish line is 7).
  // Spec §3 line 88: "Fixed 7-tile track; player starts at tile 2; father
  // starts at tile 0." Render N+1 tile-slots so both tile 0 and tile 7 fit.
  const trackSlots = Array.from({ length: ELOPEMENT_TRACK_LENGTH + 1 }, (_, i) => i);

  const onPush = () => {
    const result = store.getState().elopementPush();
    if (!result.ok) {
      setToast(`Push failed: ${result.reason.kind}`);
    }
  };
  const onFreshHorses = () => {
    const result = store.getState().elopementFreshHorses();
    if (!result.ok) {
      const r = result.reason;
      if (r.kind === "InsufficientWealth") {
        setToast(`Need ${r.need}w, have ${r.have}w`);
      } else if (r.kind === "FreshHorsesExhausted") {
        setToast("Fresh Horses exhausted (3/3 used).");
      } else {
        setToast(`Fresh Horses failed: ${r.kind}`);
      }
    }
  };
  const onSurrender = () => {
    if (!confirmSurrender) {
      setConfirmSurrender(true);
      return;
    }
    const result = store.getState().elopementSurrender();
    setConfirmSurrender(false);
    if (!result.ok) {
      setToast(`Surrender failed: ${result.reason.kind}`);
    }
  };

  return (
    <section
      className="flex flex-col p-6 gap-6 bg-stone-100 min-h-screen"
      data-testid="elopement-overlay"
      aria-label="Elopement sprint"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-serif font-bold text-stone-900">
          Elopement Sprint — {elopingName} & {targetName}
        </h1>
        <p className="text-sm text-stone-600">
          Outrun the father to tile 7. Push, take fresh horses, or surrender.
        </p>
      </header>

      {showDisclosureCard && (
        <div
          className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
          data-testid="elopement-disclosure-card"
        >
          {targetMarriageActive
            ? `${targetName} is already married`
            : `${elopingName} is already married`}
          {" — winning will NOT mint a new marriage record. The reputation cost still applies."}
        </div>
      )}

      <div className="flex flex-col gap-3" data-testid="elopement-track">
        <div className="flex justify-between text-xs text-stone-500 px-1">
          <span>Start</span>
          <span>Finish (tile {ELOPEMENT_TRACK_LENGTH})</span>
        </div>
        <div className="grid grid-cols-8 gap-1">
          {trackSlots.map((tileIndex) => {
            const isFinish = tileIndex === ELOPEMENT_TRACK_LENGTH;
            const playerHere = sprint.playerTilePosition === tileIndex;
            const fatherHere = sprint.fatherTilePosition === tileIndex;
            return (
              <div
                key={tileIndex}
                className={`flex flex-col items-center justify-center h-16 border ${
                  isFinish ? "bg-emerald-100 border-emerald-400" : "bg-white border-stone-300"
                }`}
                data-testid={`elopement-tile-${tileIndex}`}
              >
                <div className="flex gap-1">
                  {playerHere && (
                    <span
                      className="px-1 rounded bg-blue-600 text-white text-xs font-bold"
                      data-testid="elopement-player-token"
                    >
                      P
                    </span>
                  )}
                  {fatherHere && (
                    <span
                      className="px-1 rounded bg-red-700 text-white text-xs font-bold"
                      data-testid="elopement-father-token"
                    >
                      F
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-stone-400 mt-1">{tileIndex}</span>
              </div>
            );
          })}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-stone-700">
        <dt className="font-semibold">{elopingName}'s composure</dt>
        <dd data-testid="elopement-composure">{elopingComposure}</dd>
        <dt className="font-semibold">Fresh Horses remaining</dt>
        <dd data-testid="elopement-fresh-horses-remaining">
          {freshHorsesRemaining} / {ELOPEMENT_FRESH_HORSES_MAX_USES}
        </dd>
        <dt className="font-semibold">Wealth</dt>
        <dd>{playerWealth}</dd>
      </dl>

      <div className="flex gap-3">
        <button
          ref={focusRef}
          type="button"
          className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50"
          onClick={onPush}
          data-testid="elopement-push"
        >
          Push (−{ELOPEMENT_PUSH_COMPOSURE_COST} composure; both advance)
        </button>
        <button
          type="button"
          className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50"
          onClick={onFreshHorses}
          disabled={freshHorsesExhausted || freshHorsesUnaffordable}
          data-testid="elopement-fresh-horses"
        >
          Fresh Horses (+2 player, −{ELOPEMENT_FRESH_HORSES_WEALTH_COST}w)
        </button>
        <button
          type="button"
          className={`px-4 py-2 rounded text-sm font-semibold text-white ${
            confirmSurrender ? "bg-red-700 hover:bg-red-800" : "bg-stone-500 hover:bg-stone-600"
          }`}
          onClick={onSurrender}
          data-testid="elopement-surrender"
        >
          {confirmSurrender ? "Confirm Surrender (lose +50 scandal)" : "Surrender"}
        </button>
      </div>

      {toast !== null && (
        <output className="text-sm text-red-700" data-testid="elopement-toast">
          {toast}
        </output>
      )}
    </section>
  );
}

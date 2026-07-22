import { useMemo, useState } from "react";
import {
  END_EVENT_EARLY_WEALTH_COST,
  EXTEND_EVENT_TICKS,
  EXTEND_EVENT_WEALTH_COST,
} from "../../game/constants";
import { LOCATIONS, LOCATION_PIN_COORDS, type LocationId } from "../../game/fixtures/locations";
import { RIVAL_HOUSE_IDS_SET } from "../../game/fixtures/rivals";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import type { GlobalEventKind } from "../../game/rules/globalEvents";
import { canTravel } from "../../game/rules/travel";
import type { SeasonStore } from "../../game/store";
import { duelBus } from "../../runtime/events/duels";
import { locationBus } from "../../runtime/events/location";
import { useBusEvent } from "../../runtime/events/useBusEvent";
import { ActionRejectionToast } from "./ActionRejectionToast";
import { LocationDetailsPanel } from "./LocationDetailsPanel";
import { LocationPin } from "./LocationPin";
import { MapBackdrop } from "./MapBackdrop";
import { formatYearPassSummary, summarizeYearPass } from "./yearPassSummary";

// P25 R11: UI-local chip colors per global-event kind (P14 pin — rendering
// values live with their component, not in game/constants).
const EVENT_CHIP_COLOR: Record<GlobalEventKind, string> = {
  WarEffort: "bg-rose-700 text-rose-50",
  MarketCrash: "bg-amber-700 text-amber-50",
  MonarchsMood: "bg-violet-700 text-violet-50",
  RoyalFuneral: "bg-slate-700 text-slate-50",
  DucalWedding: "bg-pink-700 text-pink-50",
  PeasantRevolt: "bg-orange-800 text-orange-50",
};

type Props = {
  store: SeasonStore;
  onEnterBallroom?: (() => void) | undefined;
  // P12: promenade entry hook. MapView threads this down to
  // LocationDetailsPanel's "Take a Promenade in Hyde Park" button.
  onEnterPromenade?: (() => void) | undefined;
};

export function MapView({ store, onEnterBallroom, onEnterPromenade }: Props) {
  const state = store();
  const house = state.houses.get(PLAYER_HOUSE_ID);
  const currentLocation: LocationId = house?.currentLocation ?? "Capital";

  // Precompute canTravel for all 7 locations once per render. Threads
  // rejectionReason as a prop to each pin (avoids per-pin store selectors).
  const reachability = useMemo(() => {
    const out = new Map<
      LocationId,
      { reachable: boolean; reason?: ReturnType<typeof canTravel> }
    >();
    for (const loc of LOCATIONS) {
      const check = canTravel(state, PLAYER_HOUSE_ID, loc);
      out.set(loc, { reachable: check.ok, reason: check });
    }
    return out;
  }, [state]);

  const [toast, setToast] = useState<{ kind: string; message: string } | null>(null);
  // P20: dynasty-clock control. "Pass a Year" runs runYearPass (aging /
  // conception / succession) — distinct from the per-location tick advance.
  // The result is surfaced via a before/after diff (no bus event exists for
  // births/succession).
  const [yearSummary, setYearSummary] = useState<string | null>(null);
  // P25 R3: rival-initiated duel notifications. duelBus has no other subscriber,
  // so a rival killing a player character mid-tick would otherwise be silent.
  const [duelNotice, setDuelNotice] = useState<string | null>(null);
  const isExiled = house?.exiled === true;

  const onPassYear = () => {
    const before = store.getState();
    before.runYearPass();
    const after = store.getState();
    setYearSummary(formatYearPassSummary(summarizeYearPass(before, after)));
  };

  useBusEvent(locationBus, "TravelRejected", (event) => {
    const reason = event.reason;
    const message =
      reason.kind === "SameLocation"
        ? "You are already there."
        : "That route is blockaded during wartime.";
    setToast({ kind: reason.kind, message });
  });

  useBusEvent(locationBus, "RequestedAudience", (event) => {
    const outcome = event.outcome;
    switch (outcome.kind) {
      case "Denied":
        setToast({
          kind: outcome.reason.kind,
          message:
            outcome.reason.kind === "CooldownActive"
              ? `Audience cooldown: ${outcome.reason.ticksUntilAvailable} ticks remaining.`
              : outcome.reason.kind === "InsufficientReputation"
                ? `Reputation too low (${outcome.reason.reputation} / ${outcome.reason.required}).`
                : "You must be at the Capital to request an audience.",
        });
        return;
      case "FullSuccess":
        setToast({ kind: "FullSuccess", message: "The monarch is pleased — scandal forgiven." });
        return;
      case "Partial":
        setToast({ kind: "Partial", message: "A polite reception, with some cost." });
        return;
    }
  });

  useBusEvent(locationBus, "BankruptcyEscapeRejected", (event) => {
    const reason = event.reason;
    setToast({
      kind: reason.kind,
      message:
        reason.kind === "NotInsolvent"
          ? "You are not insolvent."
          : "You must be at the Country estate.",
    });
  });

  useBusEvent(locationBus, "WardrobeRefreshRejected", (event) => {
    setToast({
      kind: event.reason.kind,
      message: "You must be at the Capital to refresh your wardrobe.",
    });
  });

  // P25 R3: surface rival-initiated duels (challenger ∈ a rival house). The
  // DuelInitiated payload carries both ids; DuelResolved carries only duelId,
  // so we correlate via state.duels (never-deleted → the lookup is always safe).
  useBusEvent(duelBus, "DuelInitiated", (event) => {
    const st = store.getState();
    const challenger = st.characters.get(event.challengerCharacterId);
    if (challenger === undefined || !RIVAL_HOUSE_IDS_SET.has(challenger.houseId)) return;
    const defender = st.characters.get(event.defenderCharacterId);
    setDuelNotice(
      `${challenger.name} has demanded satisfaction of ${defender?.name ?? "your kin"}.`,
    );
  });
  useBusEvent(duelBus, "DuelResolved", (event) => {
    const st = store.getState();
    const duel = st.duels.get(event.duelId);
    if (duel === undefined) return;
    const challenger = st.characters.get(duel.challengerCharacterId);
    if (challenger === undefined || !RIVAL_HOUSE_IDS_SET.has(challenger.houseId)) return;
    const name = st.characters.get(duel.defenderCharacterId)?.name ?? "your kin";
    setDuelNotice(
      event.loserCasualty === "Killed"
        ? `${name} was killed in a duel with ${challenger.name}.`
        : event.loserCasualty === "Wounded"
          ? `${name} was wounded in a duel with ${challenger.name}.`
          : `The duel with ${challenger.name} ended in a stalemate.`,
    );
  });

  // P14: the exile terminal-state banner was HOISTED to App.tsx persistent
  // chrome so it surfaces across all four views (Map / Ballroom / Promenade /
  // Ledger), not just the map. MapView no longer renders it.

  // P13: active global events chip row. Renders right-aligned across the
  // map header. Lex-sort the events for stable visual order across renders.
  // Tick-countdown uses `endTick - state.tick + 1` (inclusive of current
  // tick — matches the apply-before-expire <= predicate at expireFinishedEvents).
  const activeEvents = [...state.globalEvents.values()].sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div className="flex flex-col" data-testid="map-view">
      <div className="flex items-center gap-3 px-6 py-2 border-b border-stone-200">
        <button
          type="button"
          onClick={onPassYear}
          disabled={isExiled}
          data-testid="pass-year-btn"
          title="Advance the dynasty clock one year: the family ages; couples conceive on cadence; an heir inherits on the head's death."
          className="rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Pass a Year
        </button>
        {yearSummary !== null && (
          <output
            aria-live="polite"
            className="text-sm text-stone-700"
            data-testid="year-pass-summary"
          >
            {yearSummary}
          </output>
        )}
      </div>
      {duelNotice !== null && (
        <div
          className="flex items-center justify-between gap-3 px-6 py-2 bg-rose-900 text-rose-50 text-sm"
          data-testid="duel-notice"
          role="alert"
        >
          <span>{duelNotice}</span>
          <button
            type="button"
            onClick={() => setDuelNotice(null)}
            className="rounded border border-rose-300/40 px-2 py-0.5 text-xs hover:bg-rose-800"
          >
            Dismiss
          </button>
        </div>
      )}
      {activeEvents.length > 0 && (
        <div
          className="flex flex-wrap justify-end gap-2 px-6 py-2 bg-stone-900"
          data-testid="active-events-banner"
        >
          {activeEvents.map((event) => {
            const ticksRemaining = event.endTick - state.tick + 1;
            // P25 R11: explicit 6-way kind→color map (was a 3-way ternary whose
            // else-arm rendered every new kind violet).
            const colorClass = EVENT_CHIP_COLOR[event.kind];
            const label =
              event.kind === "MonarchsMood"
                ? `${event.kind}: ${event.favoredCulture} favored (${ticksRemaining} ticks left)`
                : `${event.kind} (${ticksRemaining} ticks left)`;
            const canAfford = (house?.wealth ?? 0) >= EXTEND_EVENT_WEALTH_COST;
            return (
              <span
                key={event.id}
                className={`inline-flex items-center gap-2 px-3 py-1 rounded text-sm font-medium ${colorClass}`}
                data-testid={`event-chip-${event.kind}`}
              >
                {label}
                {/* P25 R14: extend / end-early free actions. */}
                <button
                  type="button"
                  data-testid={`event-extend-${event.kind}`}
                  disabled={isExiled || event.extendedOnce || !canAfford}
                  onClick={() => store.getState().extendGlobalEvent(event.id)}
                  className="rounded border border-white/40 px-1 text-xs hover:bg-white/10 disabled:opacity-40"
                  title={
                    event.extendedOnce
                      ? "Already extended"
                      : `Extend (−${EXTEND_EVENT_WEALTH_COST} wealth, +${EXTEND_EVENT_TICKS} ticks)`
                  }
                >
                  Extend
                </button>
                <button
                  type="button"
                  data-testid={`event-end-${event.kind}`}
                  disabled={isExiled || (house?.wealth ?? 0) < END_EVENT_EARLY_WEALTH_COST}
                  onClick={() => store.getState().endGlobalEventEarly(event.id)}
                  className="rounded border border-white/40 px-1 text-xs hover:bg-white/10 disabled:opacity-40"
                  title={`End early (−${END_EVENT_EARLY_WEALTH_COST} wealth; concludes after one more turn — in-progress effects still apply)`}
                >
                  End
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="flex gap-4 p-6">
        <div className="relative flex-1 aspect-[4/3] min-h-[400px]">
          <MapBackdrop />
          {LOCATIONS.map((loc) => {
            const r = reachability.get(loc);
            const reason = r?.reason;
            return (
              <LocationPin
                key={loc}
                location={loc}
                coords={LOCATION_PIN_COORDS[loc]}
                isCurrent={loc === currentLocation}
                isReachable={r?.reachable ?? false}
                rejectionReason={reason !== undefined && !reason.ok ? reason.reason : undefined}
                onTravel={(target) => store.getState().travel(target)}
              />
            );
          })}
        </div>
        <div className="w-80 space-y-4">
          <LocationDetailsPanel
            store={store}
            location={currentLocation}
            onEnterBallroom={onEnterBallroom}
            onEnterPromenade={onEnterPromenade}
          />
          {/* P14: the inline ledger panels (Active Schemes / Whispers / Staff /
            Spymaster) MOVED into the dedicated LedgerView (TopBar entry). The
            map sidebar is now location-focused. */}
        </div>
        {toast !== null && (
          <ActionRejectionToast message={toast.message} onDismiss={() => setToast(null)} />
        )}
      </div>
    </div>
  );
}

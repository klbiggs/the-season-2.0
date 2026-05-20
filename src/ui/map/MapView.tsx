import { useMemo, useState } from "react";
import { LOCATIONS, LOCATION_PIN_COORDS, type LocationId } from "../../game/fixtures/locations";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
import { canTravel } from "../../game/rules/travel";
import type { SeasonStore } from "../../game/store";
import { locationBus } from "../../runtime/events/location";
import { useBusEvent } from "../../runtime/events/useBusEvent";
import { ActionRejectionToast } from "./ActionRejectionToast";
import { ActiveSchemesPanel } from "../ledger/ActiveSchemesPanel";
import { LocationDetailsPanel } from "./LocationDetailsPanel";
import { LocationPin } from "./LocationPin";
import { MapBackdrop } from "./MapBackdrop";

type Props = {
  store: SeasonStore;
  onEnterBallroom?: (() => void) | undefined;
};

export function MapView({ store, onEnterBallroom }: Props) {
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

  return (
    <div className="flex gap-4 p-6" data-testid="map-view">
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
        />
        {/* P5: Active Schemes ledger panel — inline summary on the map
            sidebar. P14 ships the full tabbed ledger view. */}
        <ActiveSchemesPanel store={store} />
      </div>
      {toast !== null && (
        <ActionRejectionToast message={toast.message} onDismiss={() => setToast(null)} />
      )}
    </div>
  );
}

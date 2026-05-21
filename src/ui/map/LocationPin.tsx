import { LOCATION_LABELS, type LocationId } from "../../game/fixtures/locations";
import type { TravelRejection } from "../../game/rules/travel";

// Single absolute-positioned pin over the map backdrop. Disabled when
// !isReachable (either it's the current location or the rule layer
// rejected the travel attempt). Hover tooltip shows the rejection prose.

type Props = {
  location: LocationId;
  coords: { x: number; y: number };
  isCurrent: boolean;
  isReachable: boolean;
  rejectionReason?: TravelRejection | undefined;
  onTravel: (location: LocationId) => void;
};

function rejectionProse(reason: TravelRejection): string {
  switch (reason.kind) {
    case "SameLocation":
      return "You are already here.";
    case "EraBlockaded":
      return "The route is blockaded during wartime.";
    case "PlayerExiled":
      return "Your house is exiled — no travel possible.";
    case "ElopementInProgress":
      return "Elopement in progress — travel is suspended.";
  }
}

export function LocationPin({
  location,
  coords,
  isCurrent,
  isReachable,
  rejectionReason,
  onTravel,
}: Props) {
  const tooltip = isCurrent
    ? "Your current location."
    : rejectionReason !== undefined
      ? rejectionProse(rejectionReason)
      : `Travel to ${LOCATION_LABELS[location]}.`;
  return (
    <button
      type="button"
      onClick={() => onTravel(location)}
      disabled={!isReachable}
      title={tooltip}
      aria-label={`${LOCATION_LABELS[location]} — ${tooltip}`}
      style={{ left: `${coords.x}%`, top: `${coords.y}%` }}
      className={
        isCurrent
          ? "absolute -translate-x-1/2 -translate-y-1/2 px-3 py-1 rounded-full border-2 border-amber-700 bg-amber-100 text-amber-900 text-xs font-semibold shadow"
          : isReachable
            ? "absolute -translate-x-1/2 -translate-y-1/2 px-3 py-1 rounded-full border border-stone-400 bg-white hover:bg-stone-50 text-stone-700 text-xs"
            : "absolute -translate-x-1/2 -translate-y-1/2 px-3 py-1 rounded-full border border-stone-200 bg-stone-100 text-stone-400 text-xs cursor-not-allowed"
      }
      data-testid={`location-pin-${location}`}
    >
      {LOCATION_LABELS[location]}
    </button>
  );
}

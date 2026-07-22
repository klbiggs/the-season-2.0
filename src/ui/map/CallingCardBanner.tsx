// P26 calling-card notification banner. Renders when a Pending CallingCard
// exists (NPC-initiated conversation, Q14). Accept opens a Visit session (the
// parent App flips to VisitView via onAccepted); decline marks the card + costs
// a small affection penalty. No shared notification row exists in src/ui, so
// this is a new sibling banner (the ProposalOutcomeBanner / ActionRejectionToast
// precedent). Pending-only: an Accepted/Declined/Expired card drops out.

import { useState } from "react";
import type { SeasonStore } from "../../game/store";

type Props = {
  store: SeasonStore;
  // Called after acceptCallingCard succeeds so the App can route to VisitView.
  onAccepted: () => void;
};

export function CallingCardBanner({ store, onAccepted }: Props) {
  const callingCards = store((s) => s.callingCards);
  const characters = store((s) => s.characters);
  const [rejection, setRejection] = useState<string | null>(null);

  // The single most-recent Pending card (max 1 Pending is enforced by the phase,
  // but iterate defensively and pick the highest issue tick).
  const pending = [...callingCards.values()]
    .filter((c) => c.status === "Pending")
    .sort((a, b) => b.issuedAtTick - a.issuedAtTick)[0];

  if (pending === undefined) return null;

  const caller = characters.get(pending.callerCharacterId);
  const callerName = caller?.name ?? "A caller";

  const onAccept = () => {
    const result = store.getState().acceptCallingCard(pending.id);
    if (result.ok) {
      setRejection(null);
      onAccepted();
    } else {
      setRejection(describeRejection(result.reason.kind));
    }
  };

  const onDecline = () => {
    const result = store.getState().declineCallingCard(pending.id);
    if (!result.ok) setRejection(describeRejection(result.reason.kind));
    else setRejection(null);
  };

  return (
    <output
      aria-live="polite"
      className="flex items-center justify-between gap-4 bg-amber-100 px-6 py-3 font-medium text-amber-900"
      data-testid="calling-card-banner"
    >
      <span>
        {callerName} has left a card, requesting the pleasure of your conversation.
        {rejection !== null && <span className="ml-2 text-rose-700">{rejection}</span>}
      </span>
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={onAccept}
          className="rounded border border-amber-700/40 px-3 py-0.5 text-sm hover:bg-amber-200"
          data-testid="calling-card-accept"
        >
          Receive them
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="rounded border border-amber-700/40 px-3 py-0.5 text-sm hover:bg-amber-200"
          data-testid="calling-card-decline"
        >
          Not at home
        </button>
      </span>
    </output>
  );
}

function describeRejection(kind: string): string {
  switch (kind) {
    case "PlayerExiled":
      return "Your house is in exile.";
    case "ElopementInProgress":
      return "An elopement is underway.";
    case "SessionAlreadyOpen":
      return "You are already in conversation.";
    case "CallerDead":
      return "The caller is no longer available.";
    default:
      return "The card could not be answered.";
  }
}

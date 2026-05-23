// P12 Hyde Park Promenade view. 1-on-1 conversation with a deterministically-
// picked partner at the Capital location. Differences from BallroomView:
//  - 1 portrait card (the partner), NOT the 5-portrait ring
//  - 3 tactic buttons (no Flattery / SlyGossip)
//  - No StanceToggle (always implicitly Mingle)
//  - No ComposureBar (zero composure damage across all 3 actions)
//  - No SchemeButtons (promenade is conversation-only)
//  - "Conclude Promenade" button commits 1 tick on exit (commit-on-leave)
//
// Session entry happens via the LocationDetailsPanel "Take a Promenade in
// Hyde Park" button → store.enterPromenade() → App.tsx flips the view flag
// to mount this component. The partner id is communicated via the orchestrator's
// currentPromenadePartner() (NOT via props) so a load-mid-render still
// resolves to the orchestrator's source of truth.

import { useEffect, useState } from "react";
import { type ConversationFailure, makePairKey } from "../../game/conversation/types";
import { PLAYER_HOUSE_ID } from "../../game/rng";
import {
  characterEquipsMountFamily,
  playerHeadEquipsMountFamily,
} from "../../game/rules/promenade";
import type { SeasonStore } from "../../game/store";
import { conversationOrchestrator } from "../../runtime/conversationOrchestrator";
import { ChatLog } from "../ballroom/ChatLog";
import { ConversationFailureBanner } from "../ballroom/ConversationFailureBanner";
import { MessageInput } from "../ballroom/MessageInput";
import { ThinkingIndicator } from "../ballroom/ThinkingIndicator";
import { PromenadeTacticButtons } from "./PromenadeTacticButtons";

type PromenadeTactic = "WittyBanter" | "DeepEmpathy" | "ComplimentMount";

type Props = {
  store: SeasonStore;
  onExit: () => void;
};

export function PromenadeView({ store, onExit }: Props) {
  // Pull state needed for the partner read + mount-equip predicates.
  const characters = store((s) => s.characters);
  const conversationHistory = store((s) => s.conversationHistory);
  const artifactInstances = store((s) => s.artifactInstances);

  // Orchestrator-side state. Promenade partner lives there, not in React.
  const partnerCharacterId = conversationOrchestrator.currentPromenadePartner();
  const partner = partnerCharacterId !== null ? characters.get(partnerCharacterId) : undefined;

  // Mount-equip predicates — read on every render so a mid-session
  // equip/unequip (e.g., via the artifact ledger UI in a future phase)
  // dynamically updates the ComplimentMount gate.
  const playerMountEquipped = playerHeadEquipsMountFamily(store.getState());
  const partnerMountEquipped =
    partner !== undefined
      ? characterEquipsMountFamily({ artifactInstances } as never, partner.equippedArtifactIds)
      : false;

  // Session-local React state.
  const [pinnedTactic, setPinnedTactic] = useState<PromenadeTactic | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const [failure, setFailure] = useState<ConversationFailure | null>(null);

  // Defensive: if the orchestrator's session vanished mid-render (e.g., a
  // parallel exitPromenade or a load), bail to the map. Should not happen
  // in production but covers test edge cases.
  useEffect(() => {
    if (partnerCharacterId === null) {
      onExit();
    }
  }, [partnerCharacterId, onExit]);

  const pairKey =
    partnerCharacterId !== null ? makePairKey(PLAYER_HOUSE_ID, partnerCharacterId) : null;
  const exchanges = pairKey !== null ? (conversationHistory.get(pairKey) ?? []) : [];

  const sendDisabled = inFlight || partner === undefined || pinnedTactic === null;
  const disabledReason = inFlight
    ? "Awaiting response…"
    : partner === undefined
      ? "Partner unavailable."
      : pinnedTactic === null
        ? "Pick a tactic to send."
        : "";

  const onSend = async () => {
    if (pinnedTactic === null) return;
    setInFlight(true);
    setFailure(null);
    try {
      const result = await store.getState().sendPromenadeMessage({
        freeformMessage: draftMessage,
        pinnedTactic,
      });
      if (!result.ok) {
        setFailure(result.reason);
      } else {
        setDraftMessage("");
      }
    } finally {
      setInFlight(false);
    }
  };

  const onConclude = () => {
    store.getState().exitPromenade();
    onExit();
  };

  const onAbort = () => {
    store.getState().abortPromenadeRequest();
    setInFlight(false);
  };

  if (partner === undefined) {
    return (
      <section
        className="flex flex-col gap-4 p-6"
        aria-label="Promenade"
        data-testid="promenade-view"
      >
        <p className="text-sm text-stone-600">No partner is available for the promenade today.</p>
        <button
          type="button"
          onClick={onConclude}
          className="self-start rounded border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:bg-stone-50"
          data-testid="promenade-conclude"
        >
          Return to the map
        </button>
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-4 p-6"
      aria-label="Promenade in Hyde Park"
      data-testid="promenade-view"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-stone-800">A Walk in Hyde Park</h2>
        <button
          type="button"
          onClick={onConclude}
          className="rounded border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:bg-stone-50"
          data-testid="promenade-conclude"
        >
          Conclude Promenade (advances 1 tick)
        </button>
      </header>

      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-stone-300 bg-white p-4"
        data-testid="promenade-partner-card"
      >
        <p className="text-lg font-medium text-stone-800">{partner.name}</p>
        <p className="text-xs text-stone-500">
          Mood: {partner.mood} {partnerMountEquipped ? "· Riding" : ""}
        </p>
        {playerMountEquipped && (
          <p className="text-xs text-emerald-700" data-testid="promenade-player-mount-indicator">
            Your mount grants a per-action affection bonus while you mingle.
          </p>
        )}
      </div>

      <ConversationFailureBanner failure={failure} onDismiss={() => setFailure(null)} />

      <ChatLog exchanges={exchanges} npcName={partner.name} />

      <PromenadeTacticButtons
        pinned={pinnedTactic}
        disabled={inFlight}
        partnerEquipsMount={partnerMountEquipped}
        onPin={(t, prefill) => {
          setPinnedTactic(t);
          setDraftMessage(prefill);
        }}
      />

      {inFlight ? (
        <>
          <ThinkingIndicator />
          <button
            type="button"
            onClick={onAbort}
            className="self-end rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:bg-stone-50"
            data-testid="promenade-abort"
          >
            Cancel
          </button>
        </>
      ) : (
        <MessageInput
          value={draftMessage}
          disabled={sendDisabled}
          disabledReason={disabledReason}
          onChange={setDraftMessage}
          onSend={onSend}
        />
      )}
    </section>
  );
}

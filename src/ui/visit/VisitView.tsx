// P26 Visit view (NPC-initiated drawing-room call). A thin sibling of
// PromenadeView: same low-stakes conversation envelope (3 promenade tactics, no
// faux-pas, no composure bar), but the caller came to the player. Differences
// from PromenadeView are cosmetic (framing text) + the store actions it calls
// (sendVisitMessage / exitVisit / abortVisitRequest) and the orchestrator read
// (currentVisitCaller). No premature shared abstraction — PromenadeTacticButtons
// is reused, the view shells stay separate.
//
// Session entry happens via acceptCallingCard (from the CallingCardBanner) →
// App.tsx flips the view flag. The caller id is read from the orchestrator's
// currentVisitCaller() (NOT props) so a load-mid-render resolves to the
// orchestrator's source of truth.

import { useEffect, useState } from "react";
import { type ConversationFailure, makePairKey } from "../../game/conversation/types";
import { PLAYER_HOUSE_ID } from "../../game/rng.seeds";
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
import { PromenadeTacticButtons } from "../promenade/PromenadeTacticButtons";

type PromenadeTactic = "WittyBanter" | "DeepEmpathy" | "ComplimentMount";

type Props = {
  store: SeasonStore;
  onExit: () => void;
};

export function VisitView({ store, onExit }: Props) {
  const characters = store((s) => s.characters);
  const conversationHistory = store((s) => s.conversationHistory);
  const artifactInstances = store((s) => s.artifactInstances);

  const callerCharacterId = conversationOrchestrator.currentVisitCaller();
  const caller = callerCharacterId !== null ? characters.get(callerCharacterId) : undefined;

  const playerMountEquipped = playerHeadEquipsMountFamily(store.getState());
  const callerMountEquipped =
    caller !== undefined
      ? characterEquipsMountFamily({ artifactInstances } as never, caller.equippedArtifactIds)
      : false;

  const [pinnedTactic, setPinnedTactic] = useState<PromenadeTactic | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const [failure, setFailure] = useState<ConversationFailure | null>(null);

  useEffect(() => {
    if (callerCharacterId === null) {
      onExit();
    }
  }, [callerCharacterId, onExit]);

  const pairKey =
    callerCharacterId !== null ? makePairKey(PLAYER_HOUSE_ID, callerCharacterId) : null;
  const exchanges = pairKey !== null ? (conversationHistory.get(pairKey) ?? []) : [];

  const sendDisabled = inFlight || caller === undefined || pinnedTactic === null;
  const disabledReason = inFlight
    ? "Awaiting response…"
    : caller === undefined
      ? "The caller has departed."
      : pinnedTactic === null
        ? "Pick a tactic to send."
        : "";

  const onSend = async () => {
    if (pinnedTactic === null) return;
    setInFlight(true);
    setFailure(null);
    try {
      const result = await store.getState().sendVisitMessage({
        freeformMessage: draftMessage,
        pinnedTactic,
        // Visit has no stance toggle — always Mingle (enables the mount bonus).
        stance: "Mingle",
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
    store.getState().exitVisit();
    onExit();
  };

  const onAbort = () => {
    store.getState().abortVisitRequest();
    setInFlight(false);
  };

  if (caller === undefined) {
    return (
      <section className="flex flex-col gap-4 p-6" aria-label="Visit" data-testid="visit-view">
        <p className="text-sm text-stone-600">The caller has departed.</p>
        <button
          type="button"
          onClick={onConclude}
          className="self-start rounded border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:bg-stone-50"
          data-testid="visit-conclude"
        >
          Return to the map
        </button>
      </section>
    );
  }

  return (
    <section
      className="flex flex-col gap-4 p-6"
      aria-label="A drawing-room call"
      data-testid="visit-view"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-stone-800">{caller.name} Has Called</h2>
        <button
          type="button"
          onClick={onConclude}
          className="rounded border border-stone-300 px-3 py-1 text-sm text-stone-700 hover:bg-stone-50"
          data-testid="visit-conclude"
        >
          Conclude Visit (advances 1 tick)
        </button>
      </header>

      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-stone-300 bg-white p-4"
        data-testid="visit-caller-card"
      >
        <p className="text-lg font-medium text-stone-800">{caller.name}</p>
        <p className="text-xs text-stone-500">
          Mood: {caller.mood} {callerMountEquipped ? "· Riding" : ""}
        </p>
        {playerMountEquipped && (
          <p className="text-xs text-emerald-700" data-testid="visit-player-mount-indicator">
            Your mount grants a per-action affection bonus while you mingle.
          </p>
        )}
      </div>

      <ConversationFailureBanner failure={failure} onDismiss={() => setFailure(null)} />

      <ChatLog exchanges={exchanges} npcName={caller.name} />

      <PromenadeTacticButtons
        pinned={pinnedTactic}
        disabled={inFlight}
        partnerEquipsMount={callerMountEquipped}
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
            data-testid="visit-abort"
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

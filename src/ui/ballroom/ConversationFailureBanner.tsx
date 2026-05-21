// Renders a dismissable banner when a ConversationFailed event fires.
// User-readable prose per ConversationFailure.reason.

import type { ConversationFailure } from "../../game/conversation/types";

const REASON_PROSE: Readonly<Record<ConversationFailure["reason"], string>> = {
  timeout: "The conversation took too long. Try again.",
  network:
    "Network error: the local LLM proxy may not be running. Start it via 'pnpm dev:server' and retry.",
  schema: "The dialogue service returned an unexpected response.",
  cancelled: "Conversation cancelled.",
};

type Props = {
  failure: ConversationFailure | null;
  onDismiss: () => void;
};

export function ConversationFailureBanner({ failure, onDismiss }: Props) {
  if (failure === null) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded border border-rose-300 bg-rose-50 p-3"
      data-testid="conversation-failure-banner"
    >
      <p className="text-sm text-rose-800">{REASON_PROSE[failure.reason]}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-100"
        data-testid="conversation-failure-dismiss"
      >
        Dismiss
      </button>
    </div>
  );
}

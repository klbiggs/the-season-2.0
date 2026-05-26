// P20: shared proposal-outcome renderer. Maps a ProposalOutcome
// (src/game/rules/proposal.ts:58-66) to player-facing prose. Consumed by BOTH
// the ballroom propose control and the social-web propose action so the two
// surfaces render identical outcome copy.
//
// Determinism legibility (plan Implementation notes / proposal.ts:13-16): an
// Accepted or roll-rejected outcome consumed a tick + 1 PRNG draw; a predicate
// rejection consumed neither — so only the first two note "a season passes."
// The rejection switch is exhaustive over every ProposalRejection variant
// (P23 added TargetHouseInvalid / TargetBetrothedToAnother / RivalTooHostile /
// InsufficientWealthForDowry and removed CrossHouseMarriageNotSupported); the
// inlined `const _: never = reason` guard is the compile-time coverage
// safeguard (no shared assertNever helper exists in the repo).

import type { ProposalOutcome, ProposalRejection } from "../../game/rules/proposal";

type Props = {
  outcome: ProposalOutcome | null;
  // The target's display name, for accepted/declined copy. Optional — the
  // banner falls back to a neutral noun when absent.
  targetName?: string | undefined;
  onDismiss: () => void;
};

function rejectionProse(reason: ProposalRejection): string {
  switch (reason.kind) {
    case "TargetTooYoung":
      return "They are not yet of age to marry.";
    case "TargetExiled":
      return "Their house is in exile; no match can be made.";
    case "TargetDead":
      return "They are no longer living.";
    case "TargetAlreadyMarried":
      return "They are already married.";
    case "TargetIsPlayerHead":
      return "You cannot propose to yourself.";
    case "TargetIsSameHouse":
      return "You cannot marry within your own house.";
    case "TargetHouseInvalid":
      return "No match with their house is possible.";
    case "TargetBetrothedToAnother":
      return "They are already betrothed to another.";
    case "RivalTooHostile":
      return `That rival house is too hostile for an alliance (hostility ${reason.current}; must be ${reason.max} or below).`;
    case "InsufficientWealthForDowry":
      return `You cannot afford the alliance dowry (${reason.current} / ${reason.required} required).`;
    case "TargetNotFound":
      return "No such person could be found.";
    case "InsufficientAffection":
      return `Their affection is too low to accept (${reason.current} / ${reason.required} required).`;
    case "InsufficientReputation":
      return `Your house's reputation is too low to be considered (${reason.current} / ${reason.required} required).`;
    case "PlayerAlreadyMarried":
      return "You are already married.";
    case "PlayerHeadDead":
      return "Your head of house is no longer living.";
    case "PlayerExiled":
      return "Your house is in exile.";
    case "ElopementInProgress":
      return "An elopement is already underway.";
    default: {
      // Exhaustiveness guard: if a ProposalRejection variant is added without a
      // case above, `reason` is no longer `never` and this assignment fails to
      // typecheck. The default is unreachable for the closed union; returning
      // the (never-typed) value satisfies the string return + noUnusedLocals.
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function ProposalOutcomeBanner({ outcome, targetName, onDismiss }: Props) {
  if (outcome === null) return null;

  const who = targetName ?? "Your intended";
  let tone: "success" | "warn" | "error";
  let text: string;

  if (outcome.ok && outcome.accepted) {
    tone = "success";
    text =
      outcome.via === "Alliance"
        ? `${who} accepted your alliance — a marriage seals the bond, their house's hostility falls, and the dowry is paid. (A season passes.)`
        : `${who} accepted your proposal — a marriage is made. (A season passes.)`;
  } else if (outcome.ok) {
    tone = "warn";
    text = `${who} declined your proposal. (+${outcome.scandalDelta} scandal; a season passes.)`;
  } else {
    tone = "error";
    text = rejectionProse(outcome.reason);
  }

  const toneClass =
    tone === "success"
      ? "border-emerald-500 bg-emerald-50 text-emerald-900"
      : tone === "warn"
        ? "border-amber-500 bg-amber-50 text-amber-900"
        : "border-stone-400 bg-stone-50 text-stone-800";

  return (
    <output
      aria-live="polite"
      data-testid="proposal-outcome-banner"
      data-tone={tone}
      className={`flex items-start justify-between gap-3 rounded-md border-l-4 px-3 py-2 text-sm ${toneClass}`}
    >
      <span>{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded px-1.5 text-xs font-medium text-stone-500 hover:text-stone-800"
        data-testid="proposal-outcome-dismiss"
      >
        ✕
      </button>
    </output>
  );
}

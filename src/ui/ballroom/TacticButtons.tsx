// Four tactic buttons. Click pins the tactic AND prefills the message
// input with a designer-authored prompt. Pin acts as the explicit-intent
// override that wins over the model's classification.
//
// P12: BALLROOM_TACTICS narrows the iteration set to the 4 ballroom tactics —
// "ComplimentMount" was added to the TACTICS union but is promenade-only and
// MUST NOT surface here. The Tactic-keyed `Record<...>`s would otherwise
// require entries for ComplimentMount that the ballroom never uses.

import type { Tactic } from "../../game/constants";

// Ballroom-only tactic set (4 of 5 entries from TACTICS).
const BALLROOM_TACTICS = ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"] as const;
type BallroomTactic = (typeof BALLROOM_TACTICS)[number];

// Designer-authored prefill prompts per tactic. The player can edit before
// sending; the prefill is a launch-pad, not a constraint.
const TACTIC_PREFILLS: Readonly<Record<BallroomTactic, string>> = {
  Flattery: "I must say, you look radiant tonight.",
  WittyBanter: "I daresay even the orchestra envies your wit.",
  SlyGossip: "Have you heard what's being said about the Duke?",
  DeepEmpathy: "I noticed you seem somewhat withdrawn. Are you quite well?",
};

const TACTIC_LABELS: Readonly<Record<BallroomTactic, string>> = {
  Flattery: "Flattery",
  WittyBanter: "Witty Banter",
  SlyGossip: "Sly Gossip",
  DeepEmpathy: "Deep Empathy",
};

type Props = {
  pinned: Tactic | null;
  disabled: boolean;
  onPin: (t: Tactic, prefill: string) => void;
};

export function TacticButtons({ pinned, disabled, onPin }: Props) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      role="radiogroup"
      aria-label="Pin a tactic and prefill the message"
      data-testid="tactic-buttons"
    >
      {BALLROOM_TACTICS.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onPin(t, TACTIC_PREFILLS[t])}
          disabled={disabled}
          aria-pressed={pinned === t}
          className={`rounded border px-3 py-2 text-sm transition disabled:opacity-50 ${
            pinned === t
              ? "border-rose-600 bg-rose-600 text-white"
              : "border-stone-300 bg-white text-stone-800 hover:bg-stone-50"
          }`}
          data-testid={`tactic-${t}`}
        >
          {TACTIC_LABELS[t]}
        </button>
      ))}
    </div>
  );
}

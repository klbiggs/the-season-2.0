// Five tactic buttons. Click pins the tactic AND prefills the message input
// with a designer-authored prompt. Pin acts as the explicit-intent override
// that wins over the model's classification.
//
// P26 (H4): ComplimentMount is now a ballroom tactic (was promenade-only at
// P12). It surfaces here, but is enabled-but-tooltipped when the selected
// target owns no mount-family artifact — a mountless ComplimentMount is a
// ZeroYield (resolveCombat gates it), so the tooltip warns the player.

import type { Tactic } from "../../game/constants";

// Ballroom tactic set (all 5 entries from TACTICS as of P26).
const BALLROOM_TACTICS = [
  "Flattery",
  "WittyBanter",
  "SlyGossip",
  "DeepEmpathy",
  "ComplimentMount",
] as const;
type BallroomTactic = (typeof BALLROOM_TACTICS)[number];

// Designer-authored prefill prompts per tactic. The player can edit before
// sending; the prefill is a launch-pad, not a constraint.
const TACTIC_PREFILLS: Readonly<Record<BallroomTactic, string>> = {
  Flattery: "I must say, you look radiant tonight.",
  WittyBanter: "I daresay even the orchestra envies your wit.",
  SlyGossip: "Have you heard what's being said about the Duke?",
  DeepEmpathy: "I noticed you seem somewhat withdrawn. Are you quite well?",
  ComplimentMount: "That is a magnificent animal — I don't believe I've seen finer.",
};

const TACTIC_LABELS: Readonly<Record<BallroomTactic, string>> = {
  Flattery: "Flattery",
  WittyBanter: "Witty Banter",
  SlyGossip: "Sly Gossip",
  DeepEmpathy: "Deep Empathy",
  ComplimentMount: "Compliment Mount",
};

type Props = {
  pinned: Tactic | null;
  disabled: boolean;
  onPin: (t: Tactic, prefill: string) => void;
  // P26 (H4): whether the selected target owns a mount-family artifact. When
  // false, ComplimentMount is tooltipped (it would ZeroYield) but not disabled.
  targetEquipsMount: boolean;
};

export function TacticButtons({ pinned, disabled, onPin, targetEquipsMount }: Props) {
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-5"
      role="radiogroup"
      aria-label="Pin a tactic and prefill the message"
      data-testid="tactic-buttons"
    >
      {BALLROOM_TACTICS.map((t) => {
        const mountless = t === "ComplimentMount" && !targetEquipsMount;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onPin(t, TACTIC_PREFILLS[t])}
            disabled={disabled}
            aria-pressed={pinned === t}
            title={mountless ? "This character owns no mount to compliment." : undefined}
            className={`rounded border px-3 py-2 text-sm transition disabled:opacity-50 ${
              pinned === t
                ? "border-rose-600 bg-rose-600 text-white"
                : mountless
                  ? "border-stone-200 bg-stone-50 text-stone-400 hover:bg-stone-100"
                  : "border-stone-300 bg-white text-stone-800 hover:bg-stone-50"
            }`}
            data-testid={`tactic-${t}`}
          >
            {TACTIC_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}

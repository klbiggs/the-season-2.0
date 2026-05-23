// P12 Hyde Park Promenade tactic buttons. Three buttons:
// WittyBanter / DeepEmpathy / ComplimentMount. ComplimentMount is gated on
// the partner equipping a mount-family artifact (rendered disabled +
// tooltipped when unavailable).
//
// The promenade-tactic union is narrower than the ballroom's Tactic — the
// player ALWAYS pins one of these 3; there is no "freely classify"
// affordance (matches PromenadeMessageInput.pinnedTactic in store.ts).

type PromenadeTactic = "WittyBanter" | "DeepEmpathy" | "ComplimentMount";

const PROMENADE_TACTICS: ReadonlyArray<PromenadeTactic> = [
  "WittyBanter",
  "DeepEmpathy",
  "ComplimentMount",
];

// Designer-authored prefill prompts per tactic. Player can edit before
// sending; prefill is a launch-pad, not a constraint.
const PROMENADE_TACTIC_PREFILLS: Readonly<Record<PromenadeTactic, string>> = {
  WittyBanter: "Charming day for a turn about the park, is it not?",
  DeepEmpathy: "You seem somewhat preoccupied today. Is everything well?",
  ComplimentMount: "What a magnificent animal — you must allow me a closer look.",
};

const PROMENADE_TACTIC_LABELS: Readonly<Record<PromenadeTactic, string>> = {
  WittyBanter: "Witty Banter",
  DeepEmpathy: "Deep Empathy",
  ComplimentMount: "Compliment Mount",
};

type Props = {
  pinned: PromenadeTactic | null;
  disabled: boolean;
  partnerEquipsMount: boolean;
  onPin: (t: PromenadeTactic, prefill: string) => void;
};

export function PromenadeTacticButtons({ pinned, disabled, partnerEquipsMount, onPin }: Props) {
  return (
    <div
      className="grid grid-cols-3 gap-2"
      role="radiogroup"
      aria-label="Pin a promenade tactic and prefill the message"
      data-testid="promenade-tactic-buttons"
    >
      {PROMENADE_TACTICS.map((t) => {
        const tacticGated = t === "ComplimentMount" && !partnerEquipsMount;
        const tacticDisabled = disabled || tacticGated;
        const tooltipText = tacticGated ? "The partner is not currently riding." : "";
        return (
          <button
            key={t}
            type="button"
            onClick={() => onPin(t, PROMENADE_TACTIC_PREFILLS[t])}
            disabled={tacticDisabled}
            aria-pressed={pinned === t}
            title={tooltipText}
            className={`rounded border px-3 py-2 text-sm transition disabled:opacity-50 ${
              pinned === t
                ? "border-rose-600 bg-rose-600 text-white"
                : "border-stone-300 bg-white text-stone-800 hover:bg-stone-50"
            }`}
            data-testid={`promenade-tactic-${t}`}
          >
            {PROMENADE_TACTIC_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}

// Three mutually-exclusive stance buttons. Default Mingle.

import { STANCES, type Stance } from "../../game/constants";

const STANCE_LABELS: Readonly<Record<Stance, string>> = {
  Wallflower: "Wallflower (×0.5 affection)",
  Mingle: "Mingle (baseline)",
  TargetedPursuit: "Targeted Pursuit (×1.25 vs pinned)",
};

type Props = {
  stance: Stance;
  onChange: (s: Stance) => void;
};

export function StanceToggle({ stance, onChange }: Props) {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-label="Conversation stance"
      data-testid="stance-toggle"
    >
      {STANCES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          aria-pressed={stance === s}
          className={`rounded border px-3 py-1 text-xs transition ${
            stance === s
              ? "border-indigo-600 bg-indigo-600 text-white"
              : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
          }`}
          data-testid={`stance-${s}`}
        >
          {STANCE_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

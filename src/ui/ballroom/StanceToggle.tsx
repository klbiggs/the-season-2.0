// Three mutually-exclusive stance buttons. Default Mingle.
//
// P26 (H1): an optional `inertStances` set tooltips stances that have no effect
// in the current mode (the promenade only honors Mingle's mount bonus — the
// Wallflower/TargetedPursuit multipliers are ballroom-only). The buttons stay
// clickable (the stance is still recorded), just annotated.

import { STANCES, type Stance } from "../../game/constants";

const STANCE_LABELS: Readonly<Record<Stance, string>> = {
  Wallflower: "Wallflower (×0.5 affection)",
  Mingle: "Mingle (baseline)",
  TargetedPursuit: "Targeted Pursuit (×1.25 vs pinned)",
};

type Props = {
  stance: Stance;
  onChange: (s: Stance) => void;
  // Stances with no effect in the current mode — annotated as inert.
  inertStances?: ReadonlySet<Stance>;
};

export function StanceToggle({ stance, onChange, inertStances }: Props) {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="radiogroup"
      aria-label="Conversation stance"
      data-testid="stance-toggle"
    >
      {STANCES.map((s) => {
        const inert = inertStances?.has(s) === true;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={stance === s}
            title={inert ? "No effect in the promenade." : undefined}
            className={`rounded border px-3 py-1 text-xs transition ${
              stance === s
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
            }`}
            data-testid={`stance-${s}`}
          >
            {STANCE_LABELS[s]}
            {inert ? " ·" : ""}
          </button>
        );
      })}
    </div>
  );
}

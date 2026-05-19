// Session player composure indicator. Renders as a horizontal bar with
// numeric overlay. Drops to red when ≤ 25, amber when 25-50, emerald above.

type Props = {
  value: number;
  max: number;
};

export function ComposureBar({ value, max }: Props) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const colorClass = value <= 25 ? "bg-rose-600" : value <= 50 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div className="flex items-center gap-3" data-testid="composure-bar">
      <span className="text-xs font-semibold text-stone-600">Composure</span>
      <div
        className="relative h-3 flex-1 overflow-hidden rounded-full bg-stone-200"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        tabIndex={0}
      >
        <div className={`h-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-stone-600">
        {value}/{max}
      </span>
    </div>
  );
}

// Single-shot "thinking..." indicator during Sending → Resolving. No
// streaming (Resolved decision #15).

export function ThinkingIndicator() {
  return (
    <output
      className="flex items-center gap-2 rounded border border-stone-200 bg-stone-50 p-3"
      aria-live="polite"
      data-testid="thinking-indicator"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-stone-400" />
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-stone-400 [animation-delay:150ms]" />
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-stone-400 [animation-delay:300ms]" />
      <span className="text-xs text-stone-500">Awaiting response…</span>
    </output>
  );
}

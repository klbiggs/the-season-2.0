import { useEffect } from "react";

// Toast for action rejections/outcomes. Auto-dismisses after 3s. Single
// component covers all four player-elected action paths (Travel + Audience
// + Escape + Wardrobe) — name is "Action..." rather than "Travel..." to
// reflect actual scope.

type Props = {
  message: string;
  onDismiss: () => void;
};

export function ActionRejectionToast({ message, onDismiss }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);
  return (
    <output
      aria-live="polite"
      className="fixed bottom-6 right-6 max-w-md rounded-md bg-stone-800 px-4 py-3 text-sm text-white shadow-lg"
      data-testid="action-rejection-toast"
    >
      {message}
    </output>
  );
}

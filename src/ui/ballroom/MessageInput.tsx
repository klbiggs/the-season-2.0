// Text input + Send button. Disabled while a request is in flight OR the
// BYOK key is missing.

type Props = {
  value: string;
  disabled: boolean;
  disabledReason: string;
  onChange: (v: string) => void;
  onSend: () => void;
};

export function MessageInput({ value, disabled, disabledReason, onChange, onSend }: Props) {
  return (
    <div className="flex flex-col gap-1" data-testid="message-input">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={disabled ? disabledReason : "What do you say?"}
        rows={3}
        className="w-full rounded border border-stone-300 px-3 py-2 text-sm disabled:bg-stone-100"
        data-testid="message-input-textarea"
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || value.trim() === ""}
          className="rounded bg-indigo-700 px-4 py-2 text-sm text-white hover:bg-indigo-800 disabled:bg-stone-300 disabled:text-stone-500"
          data-testid="message-input-send"
        >
          Send
        </button>
      </div>
    </div>
  );
}

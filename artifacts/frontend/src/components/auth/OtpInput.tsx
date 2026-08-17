import { useRef } from "react";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const BORDER = "var(--auth-input-border)";
const INPUT_BG = "var(--auth-input-bg)";

export function OtpInput({
  value, onChange, disabled, error, ariaLabelledBy,
}: {
  value: string; onChange: (v: string) => void; disabled: boolean; error?: boolean; ariaLabelledBy?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const getDigit = (i: number) => value[i] ?? "";

  function focus(i: number) {
    (containerRef.current?.querySelectorAll("input")[i] as HTMLInputElement | undefined)?.focus();
  }

  function handleChange(i: number, raw: string) {
    const char = raw.replace(/\D/g, "").slice(-1);
    const arr = Array.from({ length: 6 }, (_, k) => getDigit(k));
    arr[i] = char;
    onChange(arr.join(""));
    if (char) focus(Math.min(i + 1, 5));
  }

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !getDigit(i) && i > 0) {
      const arr = Array.from({ length: 6 }, (_, k) => getDigit(k));
      arr[i - 1] = "";
      onChange(arr.join("").trimEnd());
      focus(i - 1);
    }
    if (e.key === "ArrowLeft"  && i > 0) focus(i - 1);
    if (e.key === "ArrowRight" && i < 5) focus(i + 1);
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(text);
    focus(Math.min(text.length, 5));
  }

  return (
    <div ref={containerRef} role="group" aria-labelledby={ariaLabelledBy} className="flex gap-2 sm:gap-3" onPaste={handlePaste}>
      {Array.from({ length: 6 }, (_, i) => {
        const filled = !!getDigit(i);
        return (
          <input
            key={i}
            type="text"
            aria-label={`Digit ${i + 1} of 6`}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={getDigit(i)}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKey(i, e)}
            onFocus={(e) => e.target.select()}
            disabled={disabled}
            className="flex-1 aspect-square max-w-[56px] text-center text-[22px] font-black rounded-xl border outline-none transition-all duration-150 focus:bg-cc-surface"
            style={{
              background: INPUT_BG,
              borderColor: error ? CORAL : filled ? PLUM : BORDER,
              boxShadow: filled && !error ? "0 0 0 3px color-mix(in srgb, var(--cc-plum) 10%, transparent)" : "none",
              color: "var(--cc-text)",
            }}
          />
        );
      })}
    </div>
  );
}

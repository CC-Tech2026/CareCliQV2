import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Put text on the clipboard. Falls back to a hidden text box for browsers
 * (or embedded views) where the clipboard API isn't allowed. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the old way.
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(box);
    return ok;
  } catch {
    return false;
  }
}

/**
 * A small copy icon to sit after a value (a phone number, an address, an NDIS
 * number). It turns into a tick for a moment once copied, and says so to
 * screen readers. Always visible, so it works on touch screens too.
 */
export function CopyButton({ value, label, className }: {
  value: string;
  /** What's being copied, for the button's name: "phone number". */
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };

  const text = state === "copied" ? `Copied ${label}` : state === "failed" ? `Couldn't copy ${label}` : `Copy ${label}`;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void copy(); }}
      aria-label={text}
      title={text}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md align-middle text-cc-muted transition-colors hover:bg-cc-soft hover:text-cc-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-plum/40",
        state === "copied" && "text-[color:var(--cc-green)] hover:text-[color:var(--cc-green)]",
        className,
      )}
    >
      {state === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      <span className="sr-only" aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : ""}</span>
    </button>
  );
}

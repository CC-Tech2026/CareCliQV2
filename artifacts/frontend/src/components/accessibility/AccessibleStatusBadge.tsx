import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  icon: LucideIcon;
  tone?: "success" | "warning" | "critical" | "info" | "neutral";
  className?: string;
  /** Accessible name when label is visually hidden on small screens */
  ariaLabel?: string;
};

const TONE_STYLES: Record<NonNullable<Props["tone"]>, { bg: string; text: string; border: string }> = {
  success: {
    bg: "var(--cc-status-success-bg)",
    text: "var(--cc-status-success)",
    border: "var(--cc-border)",
  },
  warning: {
    bg: "var(--cc-status-warning-bg)",
    text: "var(--cc-status-warning)",
    border: "var(--cc-border)",
  },
  critical: {
    bg: "var(--cc-status-critical-bg)",
    text: "var(--cc-status-critical)",
    border: "var(--cc-border)",
  },
  info: {
    bg: "var(--cc-status-info-bg)",
    text: "var(--cc-status-info)",
    border: "var(--cc-border)",
  },
  neutral: {
    bg: "var(--cc-bg)",
    text: "var(--cc-muted)",
    border: "var(--cc-border)",
  },
};

/** Status badge that always pairs icon + colour (colour-blind safe). */
export function AccessibleStatusBadge({
  label,
  icon: Icon,
  tone = "neutral",
  className,
  ariaLabel,
}: Props) {
  const style = TONE_STYLES[tone];
  return (
    <span
      className={cn(
        "inline-flex min-h-[1.75rem] items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold",
        className,
      )}
      style={{ background: style.bg, color: style.text, borderColor: style.border }}
      aria-label={ariaLabel ?? label}
    >
      <Icon size={14} className="shrink-0" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

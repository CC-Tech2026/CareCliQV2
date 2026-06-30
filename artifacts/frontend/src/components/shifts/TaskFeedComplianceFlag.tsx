import { cn } from "@/lib/utils";
import { Link } from "wouter";
import type { NoteComplianceFlag } from "@/lib/worker-compliance-engine";
import { MUTED, TEXT } from "@/lib/shift-utils";

type Props = {
  flag: NoteComplianceFlag;
  taskLabel?: string;
  className?: string;
};

export function TaskFeedComplianceFlag({ flag, taskLabel, className }: Props) {
  const isFail = flag.severity === "fail";
  const border = isFail ? "#FCA5A5" : "#FCD34D";
  const bg = isFail ? "#FEF2F2" : "#FFFBEB";
  const accent = isFail ? "#DC2626" : "#D97706";

  return (
    <div
      className={cn("rounded-lg border p-2", className)}
      style={{
        borderLeftWidth: 3,
        borderLeftColor: accent,
        borderColor: border,
        background: bg,
      }}
    >
      <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: accent }}>
        {isFail ? "Compliance flag" : "Needs attention"} · {taskLabel ?? flag.ruleName}
      </p>
      <p className="mt-0.5 text-[11px] font-semibold leading-snug" style={{ color: TEXT }}>
        {flag.message}
      </p>
      {flag.actionLabel && flag.actionHref && (
        <Link href={flag.actionHref}>
          <span className="mt-1 inline-block text-[11px] font-bold underline" style={{ color: accent }}>
            {flag.actionLabel}
          </span>
        </Link>
      )}
      <p className="mt-1 text-[10px] font-semibold" style={{ color: MUTED }}>
        {flag.ruleName}
      </p>
    </div>
  );
}

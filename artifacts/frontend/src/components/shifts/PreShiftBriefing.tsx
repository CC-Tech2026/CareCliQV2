import type { ReactNode } from "react";
import { ChevronDown, ClipboardList, Pill, ShieldAlert, Target, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkerShift } from "@/services/shiftService";
import { formatActiveGoalLabel } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  shift: WorkerShift;
  open?: boolean;
  onToggle?: () => void;
};

export function PreShiftBriefing({ shift, open = true, onToggle }: Props) {
  const { translate } = useAccessibility();
  const hasContent =
    shift.coordinator_notes ||
    shift.allergies ||
    (shift.health_alerts?.length ?? 0) > 0 ||
    (shift.active_goals?.length ?? 0) > 0;

  if (!hasContent) return null;

  return (
    <section className="overflow-hidden rounded-2xl border bg-[var(--cc-surface)] shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="touch-target flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={translate("shift.briefing")}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <ClipboardList size={16} style={{ color: PLUM }} aria-hidden />
          {translate("shift.briefing")}
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} aria-hidden />
      </button>

      {open && (
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: BORDER }}>
          {shift.coordinator_notes && (
            <BriefBlock icon={ClipboardList} title={translate("shift.briefing.coordinatorNote")} tone="amber">
              {shift.coordinator_notes}
            </BriefBlock>
          )}
          {shift.allergies && (
            <BriefBlock icon={Pill} title={translate("shift.briefing.allergies")} tone="rose">
              {shift.allergies}
            </BriefBlock>
          )}
          {shift.health_alerts && shift.health_alerts.length > 0 && (
            <BriefBlock icon={ShieldAlert} title={translate("shift.briefing.healthAlerts")} tone="yellow">
              <div style={{ whiteSpace: "pre-line" }}>
                {shift.health_alerts
                  .map((a) => a.title || a.detail || "")
                  .join("\n")}
              </div>
            </BriefBlock>
          )}
          {shift.active_goals && shift.active_goals.length > 0 && (
            <div className="rounded-xl px-3 py-3" style={{ background: SOFT }}>
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                <Target size={12} aria-hidden /> {translate("shift.briefing.activeGoals")}
              </p>
              <ul className="space-y-2">
                {shift.active_goals.map((goal, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm font-semibold text-safe" style={{ color: TEXT }}>
                    <Target size={14} className="mt-0.5 shrink-0" style={{ color: PLUM }} aria-hidden />
                    {formatActiveGoalLabel(goal)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function BriefBlock({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon: LucideIcon;
  title: string;
  tone: "amber" | "rose" | "yellow";
  children: ReactNode;
}) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    yellow: "border-yellow-200 bg-yellow-50 text-yellow-900",
  };
  return (
    <div className={cn("rounded-xl border px-3 py-3 text-sm font-medium leading-relaxed", tones[tone])}>
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider opacity-80">
        <Icon size={12} aria-hidden /> {title}
      </p>
      {children}
    </div>
  );
}

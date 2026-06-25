import { ChevronDown, ClipboardList, Pill, ShieldAlert, Target, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkerShift } from "@/services/shiftService";
import { formatActiveGoalLabel } from "@/services/shiftService";
import { MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import { ParticipantRiskAlerts } from "@/components/shifts/ParticipantRiskAlerts";

type Props = {
  shift: WorkerShift;
  open?: boolean;
  onToggle?: () => void;
};

export function PreShiftBriefing({ shift, open = true, onToggle }: Props) {
  const hasContent =
    shift.coordinator_notes ||
    shift.allergies ||
    (shift.health_alerts?.length ?? 0) > 0 ||
    (shift.active_goals?.length ?? 0) > 0;

  if (!hasContent) return null;

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: "#E2DEF2" }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <ClipboardList size={16} style={{ color: PLUM }} />
          Pre-Shift Briefing
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div className="space-y-2 border-t px-4 py-3" style={{ borderColor: "#E2DEF2" }}>
          {shift.coordinator_notes && (
            <BriefBlock icon={ClipboardList} title="Coordinator Note" tone="amber">
              {shift.coordinator_notes}
            </BriefBlock>
          )}
          {shift.allergies && (
            <BriefBlock icon={Pill} title="Allergies" tone="rose">
              {shift.allergies}
            </BriefBlock>
          )}
          {shift.health_alerts && shift.health_alerts.length > 0 && (
            <BriefBlock icon={ShieldAlert} title="Health Alerts" tone="yellow">
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
                <Target size={12} /> Active Goals
              </p>
              <ul className="space-y-2">
                {shift.active_goals.map((goal, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm font-semibold" style={{ color: TEXT }}>
                    <Target size={14} className="mt-0.5 shrink-0" style={{ color: PLUM }} />
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
  children: React.ReactNode;
}) {
  const bg =
    tone === "amber" ? "bg-amber-50 border-amber-100" :
    tone === "rose" ? "bg-rose-50 border-rose-100" :
    "bg-yellow-50 border-yellow-100";

  return (
    <div className={cn("rounded-xl border px-3 py-3", bg)}>
      <p className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
        <Icon size={12} /> {title}
      </p>
      <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
        {children}
      </p>
    </div>
  );
}

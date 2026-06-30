import { Link } from "wouter";
import { CalendarDays } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { BORDER, MUTED, PLUM, STATE_STYLES, TEXT, WIDGET_SCROLL, shiftInitials } from "@/lib/shift-utils";
import type { DashboardShiftSummary } from "@/services/dashboardService";

function statusBadge(shift: DashboardShiftSummary) {
  const visual = (shift.visual_state || "scheduled") as keyof typeof STATE_STYLES;
  const style = STATE_STYLES[visual] || STATE_STYLES.scheduled;
  return style.badge;
}

function statusLabel(shift: DashboardShiftSummary) {
  const visual = (shift.visual_state || "scheduled") as keyof typeof STATE_STYLES;
  return STATE_STYLES[visual]?.label || shift.status;
}

export function DashboardShiftsWidget({ shifts }: { shifts: DashboardShiftSummary[] }) {
  const { translate } = useAccessibility();

  return (
    <section className="rounded-2xl border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} style={{ color: PLUM }} />
          <h2 className="text-lg font-black" style={{ color: TEXT }}>
            {translate("dashboard.todaysShifts")}
          </h2>
        </div>
        <Link href="/my-shifts" className="text-sm font-bold hover:opacity-75" style={{ color: PLUM }}>
          {translate("dashboard.viewAll")}
        </Link>
      </div>
      <div className={`space-y-3 ${WIDGET_SCROLL}`}>
        {shifts.length === 0 && (
          <p className="rounded-xl bg-cc-soft px-4 py-3 text-sm font-medium" style={{ color: MUTED }}>
            {translate("dashboard.noShiftsToday")}
          </p>
        )}
        {shifts.map((shift) => (
          <Link key={shift.id} href={`/my-shifts/${shift.id}?focus=safety`}>
            <div className="flex items-center gap-3 rounded-xl border border-transparent p-3 transition hover:border-cc-plum/40 hover:bg-cc-soft">
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-black text-white"
                style={{ background: PLUM }}
              >
                {shiftInitials(shift.participant_name)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black" style={{ color: TEXT }}>
                  {shift.participant_name}
                </p>
                <p className="truncate text-xs font-medium" style={{ color: MUTED }}>
                  {shift.time_label || translate("shifts.timeNotSet")}
                </p>
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${statusBadge(shift)}`}>
                {statusLabel(shift)}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

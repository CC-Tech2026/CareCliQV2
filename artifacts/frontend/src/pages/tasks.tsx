import { Link } from "wouter";
import { useMemo } from "react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { ClipboardList, Loader2, CalendarDays } from "lucide-react";
import { ShiftTaskChecklist } from "@/components/shifts/ShiftTaskChecklist";
import { getWorkerShifts, type WorkerShift } from "@/services/shiftService";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

export default function Tasks() {
  const { translate } = useAccessibility();
  const { data, isLoading, error } = useOrgQuery(["worker", "shifts", "all"], {
    queryFn: () => getWorkerShifts("all"),
  });

  const activeShifts = useMemo(
    () =>
      (data?.shifts ?? []).filter(
        (s: WorkerShift) => s.visual_state === "clocked_in" || s.visual_state === "session_active",
      ),
    [data],
  );

  return (
    <div className="space-y-6 pb-10">
      <div>
        <p className="hidden" style={{ color: CORAL }}>
          {translate("common.supportWorker")}
        </p>
        <h1 className="text-xl font-black tracking-tight" style={{ color: TEXT }}>
          {translate("tasks.page.title")}
        </h1>
        <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
          {translate("tasks.page.subtitle")}
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: MUTED }}>
          <Loader2 className="h-4 w-4 animate-spin" /> {translate("tasks.page.loading")}
        </div>
      )}

      {error && <p className="text-sm font-bold text-red-600">{(error as Error).message}</p>}

      {!isLoading && activeShifts.length === 0 && (
        <section
          className="rounded-2xl border bg-cc-surface p-8 text-center shadow-sm"
          style={{ borderColor: BORDER }}
        >
          <ClipboardList size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
          <p className="text-base font-black" style={{ color: TEXT }}>{translate("tasks.page.empty")}</p>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
            {translate("tasks.page.emptyHint")}
          </p>
          <Link href="/my-shifts">
            <Button className="mt-4 rounded-full font-bold gap-2" style={{ background: "var(--cc-cta)" }}>
              <CalendarDays size={16} /> {translate("tasks.page.goToShifts")}
            </Button>
          </Link>
        </section>
      )}

      {activeShifts.map((shift) => (
        <section
          key={shift.id}
          className="rounded-2xl border bg-cc-surface p-5 shadow-sm space-y-4"
          style={{ borderColor: BORDER }}
        >
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
              {translate("tasks.page.activeShift")}
            </p>
            <h2 className="text-lg font-black" style={{ color: TEXT }}>
              {shift.participant_name || translate("tasks.page.participantFallback")}
            </h2>
          </div>
          <ShiftTaskChecklist
            shiftId={shift.id}
            tasks={shift.tasks ?? []}
            onTasksChange={() => undefined}
          />
        </section>
      ))}
    </div>
  );
}

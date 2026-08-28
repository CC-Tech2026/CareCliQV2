import { useAccessibility } from "@/contexts/AccessibilityContext";
import type { AvailableWorker } from "@/services/coordinatorService";

/** The one-line "why this worker ranks where they do" badge for a ranked
 * worker suggestion — shared between ShiftAssignmentModal's picker and
 * UnassignedShiftPanel's suggestion list so both read the same signal the
 * same way. Never a hard filter — this is purely explanatory. */
export function WorkerMatchBadge({ worker }: { worker: AvailableWorker | undefined }) {
  const { translate } = useAccessibility();
  if (!worker) return null;

  if (worker.availability_status === "unavailable") {
    const msg = worker.conflicts.find((c) => c.severity === "error")?.message ?? worker.skill_warnings[0]?.message;
    return msg ? <span className="text-[11px] font-semibold" style={{ color: "#DC2626" }}>{msg}</span> : null;
  }
  if (worker.availability_status === "warning") {
    const msg = [...worker.conflicts, ...worker.skill_warnings].find((c) => c.severity !== "error")?.message;
    return msg ? <span className="text-[11px] font-semibold" style={{ color: "#D97706" }}>{msg}</span> : null;
  }
  // Phase 2 (ranking) — the top reason the fit score picked this worker,
  // e.g. "Shares interests: gaming, football". Purely explanatory, shown
  // ahead of preferred_availability since it's the more specific signal.
  if (worker.match_reasons.length > 0) {
    return (
      <span className="text-[11px] font-semibold" style={{ color: "var(--cc-plum)" }}>
        {worker.match_reasons[0]}
      </span>
    );
  }
  if (worker.preferred_availability) {
    return (
      <span className="text-[11px] font-semibold" style={{ color: "#16A34A" }}>
        {translate("coordinator.shiftAssign.preferredAvailability")}
      </span>
    );
  }
  return null;
}

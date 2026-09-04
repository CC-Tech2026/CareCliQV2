import { useAccessibility } from "@/contexts/AccessibilityContext";
import type { AvailableWorker } from "@/services/coordinatorService";

/** The one-line "why this worker ranks where they do" badge for a ranked
 * worker suggestion — shared between ShiftAssignmentModal's picker and
 * UnassignedShiftPanel's suggestion list so both read the same signal the
 * same way. Never a hard filter — this is purely explanatory. */
export function WorkerMatchBadge({ worker }: { worker: AvailableWorker | undefined }) {
  const { translate } = useAccessibility();
  if (!worker) return null;

  const conflicts = worker.conflicts ?? [];
  const skillWarnings = worker.skill_warnings ?? [];

  // Phase 4 (do-not-repeat) — takes priority over every other signal: a
  // coordinator's own recorded "this pairing didn't work" is the single most
  // important thing to surface, ahead of availability or fit. Still just a
  // badge, never a block — see worker_match_scoring_service's has_do_not_repeat_flag.
  if (worker.excluded) {
    return (
      <span className="text-[11px] font-semibold" style={{ color: "#991B1B" }}>
        {(worker.match_reasons ?? [])[0] ?? "Previous pairing marked as not to repeat"}
      </span>
    );
  }
  if (worker.availability_status === "unavailable") {
    const msg = conflicts.find((c) => c.severity === "error")?.message ?? skillWarnings[0]?.message;
    return msg ? <span className="text-[11px] font-semibold" style={{ color: "#DC2626" }}>{msg}</span> : null;
  }
  if (worker.availability_status === "warning") {
    const msg = [...conflicts, ...skillWarnings].find((c) => c.severity !== "error")?.message;
    return msg ? <span className="text-[11px] font-semibold" style={{ color: "#D97706" }}>{msg}</span> : null;
  }
  // Phase 2 (ranking) — the top reason the fit score picked this worker,
  // e.g. "Shares interests: gaming, football". Purely explanatory, shown
  // ahead of preferred_availability since it's the more specific signal.
  // Defensive fallback: a backend running code from before match_reasons
  // existed would omit the field entirely rather than send an empty array.
  const topMatchReason = (worker.match_reasons ?? [])[0];
  if (topMatchReason) {
    return (
      <span className="text-[11px] font-semibold" style={{ color: "var(--cc-plum)" }}>
        {topMatchReason}
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

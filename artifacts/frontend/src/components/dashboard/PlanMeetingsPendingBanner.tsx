import { Link } from "wouter";
import { Sparkles, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getPendingPlanMeetings } from "@/services/coordinatorService";

// Low-intensity notification row — soft tint + left border, matching the Alert component's
// language (see components/ui/alert.tsx) without full-bleed solid pink (never a large fill).
export function PlanMeetingsPendingBanner() {
  const { data } = useQuery({
    queryKey: ["plan-meetings-pending"],
    queryFn: getPendingPlanMeetings,
    refetchInterval: 60_000,
  });

  const count = data?.count ?? 0;
  if (count === 0) return null;

  return (
    <Link href="/patients">
      <div
        className="flex items-center gap-3 rounded-lg border-l-4 px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity"
        style={{ background: "var(--cc-status-info-bg)", borderLeftColor: "var(--cc-status-info)" }}
      >
        <Sparkles size={16} className="shrink-0" style={{ color: "var(--cc-status-info)" }} />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-black leading-tight" style={{ color: "var(--cc-text)" }}>
            {count} plan meeting{count > 1 ? "s" : ""} awaiting AI review
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--cc-muted)" }}>
            Open a participant's Plan Meetings tab to review and apply suggestions.
          </p>
        </div>
        <ChevronRight size={14} className="shrink-0" style={{ color: "var(--cc-muted)" }} />
      </div>
    </Link>
  );
}

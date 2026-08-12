import { Link } from "wouter";
import { Sparkles, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getPendingPlanMeetings } from "@/services/coordinatorService";

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
        className="flex items-center gap-3 rounded-xl px-4 py-3 cursor-pointer hover:opacity-90 transition-opacity"
        style={{ background: "linear-gradient(135deg, #7C3AED 0%, #A855F7 100%)", color: "#fff" }}
      >
        <Sparkles size={16} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-black leading-tight">
            {count} plan meeting{count > 1 ? "s" : ""} awaiting AI review
          </p>
          <p className="text-[11px] opacity-80 mt-0.5">
            Open a participant's Plan Meetings tab to review and apply suggestions.
          </p>
        </div>
        <ChevronRight size={14} className="shrink-0 opacity-80" />
      </div>
    </Link>
  );
}

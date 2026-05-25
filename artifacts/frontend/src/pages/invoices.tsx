import { useMemo } from "react";
import { Link } from "wouter";
import { useGetSessions } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import { FileText, DollarSign, Clock3, AlertTriangle, ArrowRight } from "lucide-react";

const RATE_PER_MINUTE = 2;

function MetricTile({ label, value, description }: { label: string; value: number | string; description: string }) {
  return (
    <div className="rounded-3xl border border-[#E9E5F5] bg-white p-5 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6A9E] font-bold mb-3">{label}</p>
      <p className="text-3xl font-black text-[#1E1640]">{value}</p>
      <p className="mt-2 text-sm text-[#5B4D73]">{description}</p>
    </div>
  );
}

export default function Invoices() {
  const { data: sessions = [], isLoading } = useGetSessions({ limit: 100 });

  const analytics = useMemo(() => {
    const completed = sessions.filter((session) => session.status === "completed");
    const billed = completed.filter((session) => (session as any).is_ready_for_billing || session.status === "completed");
    const revenue = billed.reduce((sum, session) => {
      const duration = typeof (session as any).duration_minutes === "number" ? (session as any).duration_minutes : 60;
      return sum + duration * RATE_PER_MINUTE;
    }, 0);

    return {
      completedCount: completed.length,
      billableCount: billed.length,
      estimatedRevenue: revenue,
      billableSessions: billed,
    };
  }, [sessions]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-[#5533CC] font-bold">Coordinator finance</p>
          <h1 className="mt-2 text-3xl font-black text-[#1E1640]">Invoices & session billing</h1>
          <p className="mt-2 text-sm text-[#5B4D73] max-w-2xl">
            Review session revenue readiness and generate invoices for completed care delivery.
          </p>
        </div>
        <Button variant="secondary">Export summary</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricTile label="Completed sessions" value={isLoading ? "..." : analytics.completedCount} description="Sessions eligible for invoice review." />
        <MetricTile label="Ready for billing" value={isLoading ? "..." : analytics.billableCount} description="Sessions prepared for invoices." />
        <MetricTile label="Estimated revenue" value={isLoading ? "..." : `$${analytics.estimatedRevenue.toLocaleString()}`} description="Based on a standard rate per minute." />
      </div>

      <div className="rounded-[2rem] border border-[#E9E5F5] bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-4 px-6 py-5 border-b border-[#E9E5F5] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#1E1640]">Billable sessions</h2>
            <p className="text-sm text-[#7A6A9E]">Track completed sessions and prepare invoices for your support team.</p>
          </div>
          <Button className="inline-flex items-center gap-2">
            <FileText size={16} /> New invoice
          </Button>
        </div>

        <div className="divide-y divide-[#F5F3FC]">
          {isLoading ? (
            <div className="p-6 text-sm text-[#7A6A9E]">Loading sessions…</div>
          ) : analytics.billableSessions.length === 0 ? (
            <div className="p-6 text-sm text-[#7A6A9E]">No billable sessions found. Complete more sessions to unlock invoices.</div>
          ) : (
            analytics.billableSessions.map((session) => (
              <div key={session.id} className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_auto] items-center">
                <div>
                  <p className="text-sm font-bold text-[#1E1640]">{session.full_name || session.session_type || "Session"}</p>
                  <p className="text-sm text-[#7A6A9E]">{format(parseISO(session.session_date), "MMM d, yyyy · p")}</p>
                </div>
                <div className="flex flex-col items-start sm:items-end gap-2 text-sm text-[#5B4D73]">
                  <span>{typeof (session as any).duration_minutes === "number" ? `${(session as any).duration_minutes} mins` : "60 mins"}</span>
                  <span className="font-semibold text-[#1E1640]">${((typeof (session as any).duration_minutes === "number" ? (session as any).duration_minutes : 60) * RATE_PER_MINUTE).toFixed(0)}</span>
                  <Link href={`/sessions/${session.id}`} className="inline-flex items-center gap-1 font-semibold text-[#5533CC] hover:underline">
                    Review <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-[2rem] border border-[#FFE8EE] bg-[#FFF5F7] p-6">
        <div className="flex items-start gap-4">
          <div className="mt-1 rounded-2xl bg-[#FCE7F3] p-3 text-[#C41144]"><AlertTriangle size={18} /></div>
          <div>
            <p className="text-sm font-bold text-[#1E1640]">Billing reminder</p>
            <p className="text-sm text-[#6B7280]">Invoices are not yet generated from the app. Use this page to review completed sessions, then export or share the summary with your finance team.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

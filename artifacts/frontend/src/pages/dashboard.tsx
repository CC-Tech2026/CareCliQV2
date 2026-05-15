import { useState } from "react";
import { Link, useLocation } from "wouter";
import { format, parseISO, isAfter, subDays } from "date-fns";
import {
  useGetSessions,
  useGetParticipants,
  useGetComplianceOverview,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  ShieldCheck,
  Calendar,
  Users,
  FileText,
  CircleDot,
  ArrowRight,
} from "lucide-react";

// ── Palette Alignment (Matched Exactly with Brand Identity) ──────────────────
const PLUM = "#5533CC"; // Brand Purple
const CORAL = "#F03060"; // Brand Coral

const COLORS = {
  TEXT_MAIN: "#1A151E",
  TEXT_MUTED: "#7A6A9E",
  SUCCESS: "#10B981",
  WARNING: "#F59E0B",
  DANGER: "#EF4444",
};

// ── Shared Subcomponents ──────────────────────────────────────────────────────

function ComplianceStatus({ score, status }: { score?: number | null; status?: string }) {
  if (status === "draft" || (!score && !status)) {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold bg-[#F5F3FC] text-[#7A6A9E] uppercase tracking-wider border border-[#D8D0F0]/40 whitespace-nowrap">
        Draft
      </span>
    );
  }

  const config = score != null 
    ? score >= 85 
      ? { bg: "rgba(16, 185, 129, 0.1)", text: COLORS.SUCCESS, label: "Compliant" }
      : score >= 60 
      ? { bg: "rgba(245, 158, 11, 0.1)", text: COLORS.WARNING, label: "At Risk" }
      : { bg: "rgba(239, 68, 68, 0.1)", text: COLORS.DANGER, label: "Action Required" }
    : null;

  if (!config) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border border-current/10 whitespace-nowrap"
      style={{ background: config.bg, color: config.text }}
    >
      <ShieldCheck size={11} strokeWidth={2.5} />
      {config.label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  description,
  icon: Icon,
  loading,
}: {
  label: string;
  value: number | string;
  description: string;
  icon: any;
  loading?: boolean;
}) {
  return (
    <div className="bg-white/80 backdrop-blur-md rounded-3xl p-5 sm:p-6 border border-[#D8D0F0] shadow-[0_4px_20px_rgba(85,51,204,0.03)] transition-all duration-300 hover:shadow-[0_12px_24px_rgba(85,51,204,0.06)] hover:translate-y-[-2px]">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-2xl bg-[#F5F3FC] flex items-center justify-center" style={{ color: PLUM }}>
          <Icon size={18} strokeWidth={2.5} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-20 bg-[#F5F3FC] animate-pulse rounded-xl" />
      ) : (
        <p className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: COLORS.TEXT_MAIN }}>
          {value}
        </p>
      )}
      <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest mt-1.5" style={{ color: COLORS.TEXT_MUTED }}>
        {label}
      </p>
      <p className="text-[12px] sm:text-[13px] font-medium mt-1 opacity-70" style={{ color: COLORS.TEXT_MAIN }}>
        {description}
      </p>
    </div>
  );
}

// ── Core Dashboard Layout ─────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: sessions = [], isLoading: sLoad } = useGetSessions({ limit: 50 });
  const { data: participants = [], isLoading: pLoad } = useGetParticipants();
  const { data: rawOverview, isLoading: oLoad } = useGetComplianceOverview();

  const now = new Date();
  const thisWeek = sessions.filter(s => isAfter(parseISO(s.session_date), subDays(now, 7)));
  const pendingNotes = sessions.filter(s => !s.notes || (s.notes as string).length < 20);
  const activeSession = sessions.find(s => s.status === "in_progress");
  const complianceScore = (rawOverview as any)?.average_score ?? null;

  return (
    <div className="w-full relative min-h-full selection:bg-[#5533CC]/20">

      {/* ── Dynamic Backdrop Layer Matrix ───────────────────────────────────── */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes fluidMesh {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            .animate-fluid-bg {
              background: linear-gradient(-45deg, #F03060, #FF5E7E, #5533CC, #9B5DE5);
              background-size: 400% 400%;
              animation: fluidMesh 16s ease infinite;
            }
          `,
        }}
      />

      {/* Canvas Dynamic Ambient Elements */}
      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none fixed animate-fluid-bg" />
      <div
        className="absolute inset-0 z-0 opacity-[0.02] pointer-events-none fixed"
        style={{
          backgroundImage: `linear-gradient(to right, ${PLUM} 1px, transparent 1px), linear-gradient(to bottom, ${PLUM} 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto pb-12 relative z-10">

        {/* WELCOME BANNER SUMMARY HEADER */}
        <div className="max-w-xl">
          <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.2em] mb-1 whitespace-nowrap block" style={{ color: CORAL }}>
            {format(now, "EEEE, MMMM do")}
          </p>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight leading-none" style={{ color: PLUM }}>
            Welcome back, {user?.full_name?.split(" ")[0] || "Jane"}
          </h1>
          <p className="font-medium mt-2 text-sm sm:text-[15px]" style={{ color: COLORS.TEXT_MUTED }}>
            You have <span className="font-black" style={{ color: CORAL }}>{pendingNotes.length}</span> clinical notes awaiting completion.
          </p>
        </div>

        {/* CRITICAL ACTIONS / ACTIVE LIVE INSTANCE */}
        {activeSession && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-5 sm:p-6 rounded-[2rem] bg-white/90 backdrop-blur-md border border-solid border-[#F03060]/30 shadow-[0_8px_32px_-4px_rgba(240,48,96,0.08)] gap-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#F03060]/10 flex items-center justify-center shrink-0 animate-pulse">
                <CircleDot size={20} style={{ color: CORAL }} strokeWidth={2.5} />
              </div>
              <div>
                <p className="font-black text-sm sm:text-[15px] tracking-tight" style={{ color: COLORS.TEXT_MAIN }}>Active Container Running</p>
                <p className="text-[12px] sm:text-[13px] font-medium" style={{ color: COLORS.TEXT_MUTED }}>Started {format(parseISO(activeSession.session_date), "p")}</p>
              </div>
            </div>
            <Link href={`/sessions/${activeSession.id}/live`}>
              <button className="w-full sm:w-auto h-10 px-5 rounded-xl text-white text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all duration-200 hover:opacity-95 shadow-sm" style={{ background: CORAL }}>
                <span>Resume</span>
                <ArrowRight size={12} strokeWidth={3} />
              </button>
            </Link>
          </div>
        )}

        {/* METRICS GRID */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <MetricCard
            label="Participants"
            value={pLoad ? "..." : participants.length}
            description="Active files"
            icon={Users}
            loading={pLoad}
          />
          <MetricCard
            label="Sessions"
            value={sLoad ? "..." : thisWeek.length}
            description="This calendar week"
            icon={Calendar}
            loading={sLoad}
          />
          <MetricCard
            label="Pending Notes"
            value={sLoad ? "..." : pendingNotes.length}
            description="Awaiting context"
            icon={FileText}
            loading={sLoad}
          />
          <MetricCard
            label="Audit Score"
            value={oLoad ? "..." : complianceScore ? `${Math.round(complianceScore)}%` : "N/A"}
            description="QA aggregate rating"
            icon={ShieldCheck}
            loading={oLoad}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">

          {/* RECENT ACTIVITY CONTAINER */}
          <div className="lg:col-span-2 bg-white/90 backdrop-blur-md rounded-[2.5rem] border border-[#D8D0F0] shadow-[0_8px_32px_rgba(0,0,0,0.02)] overflow-hidden">
            <div className="p-6 sm:p-8 pb-3 sm:pb-4 flex items-center justify-between">
              <h2 className="text-lg sm:text-xl font-black tracking-tight" style={{ color: PLUM }}>Recent Activity</h2>
              <Link href="/sessions" className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest transition-colors hover:opacity-80" style={{ color: CORAL }}>
                View All
              </Link>
            </div>

            {/* Desktop Table View Structure */}
            <div className="hidden sm:block px-6 pb-6">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-separate border-spacing-y-2.5 table-fixed">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-widest" style={{ color: COLORS.TEXT_MUTED }}>
                      <th className="px-4 pb-1 w-[35%]">Date Stamp</th>
                      <th className="px-4 pb-1 w-[40%]">Session Protocol</th>
                      <th className="px-4 pb-1 text-right w-[25%]">Security Audit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.slice(0, 8).map((session) => (
                      <tr 
                        key={session.id} 
                        className="group cursor-pointer"
                        onClick={() => navigate(`/sessions/${session.id}`)}
                      >
                        <td className="bg-[#F5F3FC]/50 group-hover:bg-[#F5F3FC] px-4 py-3.5 rounded-l-2xl transition-all border-y border-l border-transparent group-hover:border-[#D8D0F0]/50 overflow-hidden text-ellipsis whitespace-nowrap">
                          <div className="text-[14px] font-black text-slate-900">
                            {format(parseISO(session.session_date), "MMM d, yyyy")}
                          </div>
                          <div className="text-[11px] font-bold uppercase tracking-wider opacity-60" style={{ color: COLORS.TEXT_MUTED }}>
                            {format(parseISO(session.session_date), "p")}
                          </div>
                        </td>
                        <td className="bg-[#F5F3FC]/50 group-hover:bg-[#F5F3FC] px-4 py-3.5 transition-all border-y border-transparent group-hover:border-[#D8D0F0]/50 overflow-hidden text-ellipsis whitespace-nowrap">
                          <div className="text-[14px] font-bold text-slate-800 capitalize overflow-hidden text-ellipsis">
                            {session.session_type?.replace("_", " ") || "General Session"}
                          </div>
                        </td>
                        <td className="bg-[#F5F3FC]/50 group-hover:bg-[#F5F3FC] px-4 py-3.5 rounded-r-2xl text-right transition-all border-y border-r border-transparent group-hover:border-[#D8D0F0]/50">
                          <div className="flex justify-end">
                            <ComplianceStatus score={session.compliance_score} status={session.status} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile Stacked Variant */}
            <div className="block sm:hidden px-6 pb-6 space-y-3">
              {sessions.slice(0, 6).map((session) => (
                <div 
                  key={session.id}
                  onClick={() => navigate(`/sessions/${session.id}`)}
                  className="bg-[#F5F3FC]/60 rounded-2xl p-4 border border-solid border-transparent active:border-[#D8D0F0] active:bg-[#F5F3FC] transition-all"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-[13px] font-black text-slate-900">
                      {format(parseISO(session.session_date), "MMM d, yyyy")}
                    </div>
                    <ComplianceStatus score={session.compliance_score} status={session.status} />
                  </div>
                  <div className="flex items-center justify-between text-[12px] font-medium">
                    <span className="text-slate-700 capitalize">
                      {session.session_type?.replace("_", " ") || "General Session"}
                    </span>
                    <span className="opacity-50 uppercase tracking-wide text-[10px] font-bold" style={{ color: COLORS.TEXT_MUTED }}>
                      {format(parseISO(session.session_date), "p")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SIDEBAR METRIC PANELS */}
          <div className="space-y-6">

            {/* QUALITY AUDIT REGULATORY WIDGET */}
            <div className="bg-white/90 backdrop-blur-md rounded-[2.5rem] p-6 sm:p-8 border border-[#D8D0F0] shadow-[0_8px_32px_rgba(0,0,0,0.02)]">
              <h3 className="text-[11px] font-black uppercase tracking-widest mb-4" style={{ color: COLORS.TEXT_MUTED }}>
                System Quality Index
              </h3>
              <div className="relative">
                 <div className="flex items-end gap-1 mb-2">
                   <span className="text-4xl sm:text-5xl font-black tracking-tighter" style={{ color: PLUM }}>
                     {complianceScore ? Math.round(complianceScore) : "—"}
                   </span>
                   <span className="text-md font-bold pb-1 sm:pb-1.5 opacity-40" style={{ color: COLORS.TEXT_MUTED }}>/100</span>
                 </div>
                 <div className="w-full h-3 bg-[#F5F3FC] rounded-full overflow-hidden mb-5 p-[2px] border border-[#D8D0F0]/40">
                   <div 
                     className="h-full rounded-full transition-all duration-1000 ease-out" 
                     style={{ 
                       width: `${complianceScore || 0}%`, 
                       background: (complianceScore || 0) > 80 
                         ? `linear-gradient(90deg, ${PLUM}, ${COLORS.SUCCESS})`
                         : `linear-gradient(90deg, ${CORAL}, ${COLORS.WARNING})`
                     }} 
                   />
                 </div>
                 <p className="text-[13px] font-medium leading-relaxed" style={{ color: COLORS.TEXT_MAIN }}>
                   {complianceScore && complianceScore > 80 
                      ? "Your end-to-end encrypted documentation protocols exceed target NDIS metrics safely."
                      : "Finalize trailing notes to restore target platform assurance rankings."}
                 </p>
                 <Link href="/compliance">
                   <button className="mt-6 w-full h-11 rounded-xl border border-[#D8D0F0] bg-white text-[11px] font-black uppercase tracking-widest text-[#5533CC] transition-all duration-200 hover:bg-[#F5F3FC] active:scale-[0.99]">
                     Review Entire Audit Log
                   </button>
                 </Link>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
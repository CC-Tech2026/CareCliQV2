import { Link, useLocation } from "wouter";
import { format, parseISO, isAfter, subDays } from "date-fns";
import {
  useGetSessions,
  useGetParticipants,
  useGetUnreadAlerts,
  useGetComplianceOverview,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Play,
  Plus,
  ShieldCheck,
  Calendar,
  Users,
  AlertTriangle,
  ChevronRight,
  FileText,
  CircleDot,
} from "lucide-react";

/**
 * MARKET READY DESIGN TOKENS
 * Refined for a professional, clinical-grade B2B SaaS environment.
 * Swapped playful accents for a more grounded, high-trust palette.
 */
const COLORS = {
  PRIMARY: "#6A407D", // Deep Plum
  ACCENT: "#FF8FA3",  // Coral
  TEXT_MAIN: "#1A151E",
  TEXT_MUTED: "#645D67",
  SUCCESS: "#10B981",
  WARNING: "#F59E0B",
  DANGER: "#EF4444",
  BG_PAGE: "#F9F8FA",
};

// ── Components ────────────────────────────────────────────────────────────────

function ComplianceStatus({ score, status }: { score?: number | null; status?: string }) {
  if (status === "draft" || (!score && !status)) {
    return (
      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 uppercase tracking-wider">
        Draft
      </span>
    );
  }

  const config = score != null 
    ? score >= 85 
      ? { bg: "#ECFDF5", text: COLORS.SUCCESS, label: "Compliant" }
      : score >= 60 
      ? { bg: "#FFFBEB", text: COLORS.WARNING, label: "At Risk" }
      : { bg: "#FEF2F2", text: COLORS.DANGER, label: "Action Required" }
    : null;

  if (!config) return null;

  return (
    <span
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
      style={{ background: config.bg, color: config.text }}
    >
      <ShieldCheck size={10} strokeWidth={3} />
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
    <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
          <Icon size={20} strokeWidth={2} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-20 bg-slate-50 animate-pulse rounded-lg" />
      ) : (
        <p className="text-3xl font-bold tracking-tight" style={{ color: COLORS.TEXT_MAIN }}>
          {value}
        </p>
      )}
      <p className="text-[11px] font-bold uppercase tracking-widest mt-1" style={{ color: COLORS.TEXT_MUTED }}>
        {label}
      </p>
      <p className="text-[12px] font-medium mt-1 opacity-60" style={{ color: COLORS.TEXT_MAIN }}>
        {description}
      </p>
    </div>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  // Data Fetching
  const { data: sessions = [], isLoading: sLoad } = useGetSessions({ limit: 50 });
  const { data: participants = [], isLoading: pLoad } = useGetParticipants();
  const { data: alerts = [] } = useGetUnreadAlerts();
  const { data: rawOverview, isLoading: oLoad } = useGetComplianceOverview();

  // Logic & Derived State
  const now = new Date();
  const thisWeek = sessions.filter(s => isAfter(parseISO(s.session_date), subDays(now, 7)));
  const pendingNotes = sessions.filter(s => !s.notes || (s.notes as string).length < 20);
  const activeSession = sessions.find(s => s.status === "in_progress");
  const complianceScore = (rawOverview as any)?.average_score ?? null;

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">

      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] mb-2" style={{ color: COLORS.PRIMARY }}>
            {format(now, "EEEE, MMMM do")}
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight" style={{ color: COLORS.TEXT_MAIN }}>
            Welcome back, {user?.full_name?.split(" ")[0]}
          </h1>
          <p className="text-slate-500 font-medium mt-2">
            You have {pendingNotes.length} clinical notes awaiting completion.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/patients">
            <button className="px-5 py-3 rounded-2xl text-sm font-bold bg-white border border-slate-200 shadow-sm hover:bg-slate-50 transition-all">
              Manage Participants
            </button>
          </Link>
          <Link href="/sessions/new">
            <button
              className="flex items-center gap-2 px-6 py-3 rounded-2xl text-white text-sm font-bold shadow-lg transition-transform hover:scale-[1.02] active:scale-95"
              style={{ background: COLORS.PRIMARY }}
            >
              <Play size={14} fill="white" /> New Session
            </button>
          </Link>
        </div>
      </div>

      {/* CRITICAL ACTIONS / ALERTS */}
      {activeSession && (
        <div className="flex items-center justify-between p-6 rounded-3xl bg-white border-2 shadow-sm border-plum-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-plum-50 flex items-center justify-center animate-pulse">
              <CircleDot size={24} style={{ color: COLORS.PRIMARY }} />
            </div>
            <div>
              <p className="font-bold text-slate-900">Session in Progress</p>
              <p className="text-sm text-slate-500">Started {format(parseISO(activeSession.session_date), "p")}</p>
            </div>
          </div>
          <Link href={`/sessions/${activeSession.id}/live`}>
            <button className="px-6 py-2.5 rounded-xl text-white text-sm font-bold transition-all hover:opacity-90" style={{ background: COLORS.ACCENT }}>
              Resume
            </button>
          </Link>
        </div>
      )}

      {/* METRICS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          label="Participants"
          value={pLoad ? "..." : participants.length}
          description="Active clinical files"
          icon={Users}
          loading={pLoad}
        />
        <MetricCard
          label="Sessions"
          value={sLoad ? "..." : thisWeek.length}
          description="Completed this week"
          icon={Calendar}
          loading={sLoad}
        />
        <MetricCard
          label="Notes"
          value={sLoad ? "..." : pendingNotes.length}
          description="Pending documentation"
          icon={FileText}
          loading={sLoad}
        />
        <MetricCard
          label="Audit Score"
          value={oLoad ? "..." : complianceScore ? `${Math.round(complianceScore)}%` : "N/A"}
          description="Quality assurance rating"
          icon={ShieldCheck}
          loading={oLoad}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* RECENT ACTIVITY TABLE */}
        <div className="lg:col-span-2 bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-8 flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: COLORS.TEXT_MAIN }}>Recent Activity</h2>
            <Link href="/sessions" className="text-xs font-bold uppercase tracking-widest hover:underline" style={{ color: COLORS.PRIMARY }}>
              View All
            </Link>
          </div>

          <div className="px-4 pb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-separate border-spacing-y-2">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <th className="px-4 pb-2">Date</th>
                    <th className="px-4 pb-2">Session Type</th>
                    <th className="px-4 pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.slice(0, 8).map((session) => (
                    <tr 
                      key={session.id} 
                      className="group cursor-pointer"
                      onClick={() => navigate(`/sessions/${session.id}`)}
                    >
                      <td className="bg-slate-50/50 group-hover:bg-slate-100 px-4 py-4 rounded-l-2xl transition-all">
                        <div className="text-sm font-bold text-slate-900">
                          {format(parseISO(session.session_date), "MMM d")}
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium">
                          {format(parseISO(session.session_date), "p")}
                        </div>
                      </td>
                      <td className="bg-slate-50/50 group-hover:bg-slate-100 px-4 py-4 transition-all">
                        <div className="text-sm font-medium text-slate-700 capitalize">
                          {session.session_type?.replace("_", " ") || "General Session"}
                        </div>
                      </td>
                      <td className="bg-slate-50/50 group-hover:bg-slate-100 px-4 py-4 rounded-r-2xl text-right transition-all">
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
        </div>

        {/* SIDEBAR WIDGETS */}
        <div className="space-y-6">
          <div className="bg-white rounded-[2rem] p-8 border border-slate-100 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-widest mb-6" style={{ color: COLORS.TEXT_MUTED }}>
              Quality Assurance
            </h3>
            <div className="relative pt-2">
               <div className="flex items-end gap-2 mb-2">
                 <span className="text-5xl font-black" style={{ color: COLORS.TEXT_MAIN }}>
                   {complianceScore ? Math.round(complianceScore) : "—"}
                 </span>
                 <span className="text-lg font-bold pb-2 text-slate-400">/100</span>
               </div>
               <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden mb-6">
                 <div 
                   className="h-full transition-all duration-700" 
                   style={{ 
                     width: `${complianceScore || 0}%`, 
                     backgroundColor: (complianceScore || 0) > 80 ? COLORS.SUCCESS : COLORS.WARNING 
                   }} 
                 />
               </div>
               <p className="text-sm text-slate-500 leading-relaxed font-medium">
                 {complianceScore && complianceScore > 80 
                    ? "Your clinical documentation exceeds standard compliance requirements."
                    : "Complete pending notes to improve your practice audit score."}
               </p>
               <Link href="/compliance">
                 <button className="mt-8 w-full py-3 rounded-xl border border-slate-200 text-xs font-bold uppercase tracking-widest hover:bg-slate-50 transition-all">
                   Full Audit Log
                 </button>
               </Link>
            </div>
          </div>

          <div className="bg-slate-900 rounded-[2rem] p-8 text-white shadow-xl relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-60">System Notification</h3>
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-1" />
                <p className="text-sm font-medium leading-relaxed">
                  {alerts.length > 0 
                    ? `You have ${alerts.length} unread administrative alerts.` 
                    : "All systems operational. No pending alerts."}
                </p>
              </div>
            </div>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16" />
          </div>
        </div>

      </div>
    </div>
  );
}
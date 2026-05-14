import { useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  format,
  isBefore,
  startOfDay,
  parseISO,
  startOfWeek,
  endOfWeek,
  isWithinInterval,
  formatDistanceToNow,
} from "date-fns";
import {
  useGetSessions,
  useGetParticipants,
  useGetDashboardStats,
} from "@workspace/api-client-react";
import type { Session, Participant, NDISGoal, ParticipantGoal } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  Eye,
  RotateCcw,
  ArrowRight,
  UploadCloud,
  ClipboardList,
  ShieldCheck,
  ChevronRight,
  Calendar,
  Loader2,
  UserPlus,
  AlertTriangle,
  FileBarChart2,
  Users,
  TrendingUp,
} from "lucide-react";

// Brand colours
const LIME = "#D9F103";
const PINK = "#FA879F";
const BLUE = "#5271FF";
const NAVY = "#0D0D55";

const TODAY_STR = format(new Date(), "yyyy-MM-dd");

function getHour() { return new Date().getHours(); }

function sessionDisplayTime(session: Session): string {
  if (session.created_at) {
    try { return format(new Date(session.created_at), "h:mm a"); } catch { /* */ }
  }
  return "--:--";
}

function getInitials(name: string): string {
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function avatarColor(name: string): { bg: string; text: string } {
  const colors = [
    { bg: "#EDE9FE", text: "#5B21B6" },
    { bg: "#FCE7F3", text: "#9D174D" },
    { bg: "#D1FAE5", text: "#065F46" },
    { bg: "#FEF3C7", text: "#92400E" },
    { bg: "#DBEAFE", text: "#1E40AF" },
    { bg: "#FFE4E6", text: "#9F1239" },
    { bg: "#F0FDF4", text: "#166534" },
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % colors.length;
  return colors[hash]!;
}

// ── Donut chart ──────────────────────────────────────────────────────────────
function DonutChart({ compliant, atRisk, nonCompliant }: { compliant: number; atRisk: number; nonCompliant: number }) {
  const total = compliant + atRisk + nonCompliant || 1;
  const pct = compliant / total;
  const size = 130;
  const r = 46;
  const cx = 65;
  const cy = 65;
  const circ = 2 * Math.PI * r;

  function arc(value: number, offset: number, color: string, key: string) {
    const frac = value / total;
    const dash = frac * circ;
    return (
      <circle key={key} cx={cx} cy={cy} r={r} fill="none"
        stroke={color} strokeWidth="13"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={-offset * circ}
        transform={`rotate(-90 ${cx} ${cy})`}
        strokeLinecap="butt"
      />
    );
  }

  return (
    <div className="relative inline-flex">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#FFF0F5" strokeWidth="13" />
        {arc(compliant, 0, LIME, "c")}
        {arc(atRisk, compliant / total, PINK, "a")}
        {arc(nonCompliant, (compliant + atRisk) / total, "#F87171", "n")}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-[#0D0D55]">
          {Math.round(pct * 100)}%
        </span>
        <span className="text-[10px] text-slate-500 font-medium">Compliant</span>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, icon, bg, textColor, sub, href,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  bg: string;
  textColor: string;
  sub?: string;
  href?: string;
}) {
  const content = (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-all cursor-pointer group">
      <div className="flex items-start justify-between mb-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: bg }}>
          {icon}
        </div>
      </div>
      <p className={cn("text-3xl font-bold leading-none", textColor)}>{value}</p>
      <p className="text-sm text-slate-500 mt-1 leading-tight">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      {href && (
        <p className="text-xs font-medium mt-3 flex items-center gap-1 group-hover:gap-1.5 transition-all" style={{ color: BLUE }}>
          View <ArrowRight size={11} />
        </p>
      )}
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

// ── Session row ───────────────────────────────────────────────────────────────
function ScheduleRow({
  session, name, isNext = false,
}: {
  session: Session;
  name: string;
  isNext?: boolean;
}) {
  const av = avatarColor(name);
  const timeStr = sessionDisplayTime(session);
  const isResume = session.status === "in_progress";

  const statusBadge = session.status === "completed"
    ? <Badge className="text-[11px] px-2.5 py-0.5 rounded-full border-0 bg-emerald-100 text-emerald-700 font-medium">✓ Completed</Badge>
    : session.status === "in_progress"
    ? <Badge className="text-[11px] px-2.5 py-0.5 rounded-full border-0 font-medium" style={{ background: `${BLUE}18`, color: "#2d45b0" }}>● In Progress</Badge>
    : isNext
    ? <Badge className="text-[11px] px-2.5 py-0.5 rounded-full border-0 font-medium" style={{ background: `${PINK}20`, color: "#9D174D" }}>▶ Next</Badge>
    : <Badge className="text-[11px] px-2.5 py-0.5 rounded-full border-0 bg-slate-100 text-slate-500 font-medium">+ Upcoming</Badge>;

  return (
    <div className="flex items-center gap-4 py-3.5 px-5 hover:bg-slate-50/60 transition-colors group">
      <span className="text-xs font-semibold text-slate-400 w-14 shrink-0 tabular-nums">{timeStr}</span>
      <div
        className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{ background: av.bg, color: av.text }}
      >
        {getInitials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#0D0D55] truncate">{name}</p>
        <p className="text-xs text-slate-400 truncate">{session.session_type}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {statusBadge}
        {session.status === "completed" ? (
          <Link href={`/sessions/${session.id}`}>
            <button className="h-7 w-7 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-[#0D0D55] hover:border-slate-300 opacity-0 group-hover:opacity-100 transition-all">
              <ChevronRight size={14} />
            </button>
          </Link>
        ) : (
          <Link href={`/sessions/${session.id}/live`}>
            <button className="h-7 w-7 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-[#0D0D55] hover:border-slate-300 opacity-0 group-hover:opacity-100 transition-all">
              <ChevronRight size={14} />
            </button>
          </Link>
        )}
      </div>
    </div>
  );
}

// ── Alert row ─────────────────────────────────────────────────────────────────
interface Alert {
  id: string;
  message: string;
  alert_type: string;
  severity?: string;
  created_at: string;
  participant_id?: string;
}

function AlertRow({ alert }: { alert: Alert }) {
  const colors: Record<string, { bg: string; text: string; dot: string }> = {
    high: { bg: "#FEF2F2", text: "#DC2626", dot: "#EF4444" },
    medium: { bg: "#FFFBEB", text: "#D97706", dot: "#F59E0B" },
    low: { bg: "#F0F9FF", text: "#0369A1", dot: "#38BDF8" },
  };
  const sev = alert.severity ?? "medium";
  const col = colors[sev] ?? colors.medium;

  return (
    <div className="flex items-start gap-3 py-3.5 px-5 hover:bg-slate-50/60 transition-colors">
      <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: col.bg }}>
        <AlertCircle size={15} style={{ color: col.text }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#0D0D55] leading-snug line-clamp-2">{alert.message}</p>
        <p className="text-xs text-slate-400 mt-0.5">
          {alert.created_at
            ? formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })
            : ""}
        </p>
      </div>
      <Badge
        className="text-[10px] px-2 py-0.5 rounded-full border-0 font-medium shrink-0 capitalize"
        style={{ background: col.bg, color: col.text }}
      >
        {sev}
      </Badge>
    </div>
  );
}

// ── Quick action button ───────────────────────────────────────────────────────
function QuickActionBtn({
  icon, label, href, bg, iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  bg: string;
  iconColor: string;
}) {
  return (
    <Link href={href}>
      <button className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-white hover:shadow-sm transition-all group">
        <div
          className="h-12 w-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-105"
          style={{ background: bg }}
        >
          <div style={{ color: iconColor }}>{icon}</div>
        </div>
        <span className="text-xs font-medium text-slate-600 text-center leading-tight">{label}</span>
      </button>
    </Link>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const { data: sessions = [], isLoading: sessionsLoading } = useGetSessions({ limit: 200 });
  const { data: participants = [] } = useGetParticipants();
  const { data: stats } = useGetDashboardStats();
  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["alerts"],
    queryFn: async () => {
      const res = await fetch("/api/alerts?limit=3");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const participantMap = useMemo<Record<string, Participant>>(() => {
    const m: Record<string, Participant> = {};
    for (const p of participants) m[p.id] = p;
    return m;
  }, [participants]);

  function participantName(session: Session): string {
    return (
      session.participants?.full_name ??
      participantMap[session.participant_id]?.full_name ??
      "Unknown Participant"
    );
  }

  const todaySessions = useMemo<Session[]>(() => {
    return [...sessions]
      .filter((s) => s.session_date === TODAY_STR)
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  }, [sessions]);

  const nextSession = useMemo<Session | null>(() => {
    const actionable = todaySessions.filter((s) => s.status === "draft" || s.status === "in_progress");
    return actionable[0] ?? null;
  }, [todaySessions]);

  const pastIncomplete = useMemo<Session[]>(() => {
    const todayStart = startOfDay(new Date());
    return sessions.filter((s) => {
      const d = parseISO(s.session_date);
      return isBefore(d, todayStart) && s.status !== "completed";
    });
  }, [sessions]);

  const weekInterval = {
    start: startOfWeek(new Date(), { weekStartsOn: 1 }),
    end: endOfWeek(new Date(), { weekStartsOn: 1 }),
  };
  const weekSessions = sessions.filter((s) =>
    isWithinInterval(parseISO(s.session_date), weekInterval),
  );
  const compliantCount = weekSessions.filter((s) => s.status === "completed" && (s.compliance_score ?? 0) >= 85).length;
  const atRiskCount = weekSessions.filter((s) => s.status === "completed" && (s.compliance_score ?? 0) >= 60 && (s.compliance_score ?? 0) < 85).length;
  const nonCompliantCount = weekSessions.filter((s) => s.status === "completed" && (s.compliance_score ?? 0) < 60).length;

  const readyCount = todaySessions.filter((s) => s.status === "completed" && (s.compliance_score ?? 0) >= 70).length;
  const needsAttentionCount = todaySessions.filter((s) => s.status !== "completed" || (s.compliance_score ?? 0) < 70).length;

  const hour = getHour();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = (user?.full_name || "").split(" ")[0] || "there";

  return (
    <div className="space-y-6 max-w-screen-xl mx-auto">
      {/* ── Page header row ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0D0D55]">
            {greeting}, {firstName}! 👋
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Here's what's happening today.</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <Link href="/participants/new">
            <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors shadow-sm"
              style={{ background: `${PINK}18`, color: PINK, border: `1px solid ${PINK}30` }}>
              <UserPlus size={15} />
              Create Participant
            </button>
          </Link>
          <Link href="/sessions/new">
            <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-[#0D0D55] hover:opacity-90 transition-opacity shadow-sm"
              style={{ background: "linear-gradient(90deg, #D9F103 0%, #c8de00 100%)" }}>
              <Play size={14} className="fill-current" />
              Start New Session
            </button>
          </Link>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Sessions today"
          value={todaySessions.length}
          icon={<Calendar size={20} style={{ color: PINK }} />}
          bg={`${PINK}18`}
          textColor="text-[#0D0D55]"
          href="/sessions"
        />
        <StatCard
          label="Ready to bill"
          value={readyCount}
          icon={<CheckCircle2 size={20} style={{ color: "#5a7000" }} />}
          bg={`${LIME}50`}
          textColor="text-[#0D0D55]"
          sub={readyCount > 0 ? "Compliant & complete" : ""}
          href="/sessions"
        />
        <StatCard
          label="Need attention"
          value={needsAttentionCount}
          icon={<AlertCircle size={20} style={{ color: PINK }} />}
          bg={`${PINK}14`}
          textColor={needsAttentionCount > 0 ? "text-[#c0415c]" : "text-[#0D0D55]"}
          href="/compliance"
        />
        <StatCard
          label="Incomplete (prior 7 days)"
          value={pastIncomplete.length}
          icon={<Clock size={20} style={{ color: "#EA580C" }} />}
          bg="#FFF7ED"
          textColor={pastIncomplete.length > 0 ? "text-orange-600" : "text-[#0D0D55]"}
          href="/sessions"
        />
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Left: Today's Schedule */}
        <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-[15px] text-[#0D0D55]">Today's Schedule</h2>
            <Link href="/sessions">
              <span className="text-xs font-medium flex items-center gap-1 hover:underline cursor-pointer" style={{ color: BLUE }}>
                View calendar <ArrowRight size={12} />
              </span>
            </Link>
          </div>

          {sessionsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : todaySessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-center px-6">
              <div className="h-12 w-12 rounded-2xl flex items-center justify-center" style={{ background: `${BLUE}18` }}>
                <Calendar size={22} style={{ color: BLUE }} />
              </div>
              <p className="font-semibold text-[#0D0D55]">No sessions today</p>
              <p className="text-sm text-slate-400">Start by creating a new session for a participant.</p>
              <Link href="/sessions/new">
                <button className="mt-1 px-4 py-2 rounded-xl bg-[#0D0D55] text-white text-sm font-semibold hover:bg-[#1a1a77] transition-colors">
                  New Session
                </button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {todaySessions.map((s) => (
                <ScheduleRow
                  key={s.id}
                  session={s}
                  name={participantName(s)}
                  isNext={nextSession?.id === s.id}
                />
              ))}
            </div>
          )}

          {todaySessions.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-50">
              <Link href="/sessions">
                <span className="text-xs font-medium cursor-pointer" style={{ color: BLUE }}>
                  View full schedule →
                </span>
              </Link>
            </div>
          )}
        </div>

        {/* Right: Compliance + Alerts */}
        <div className="lg:col-span-2 space-y-5">
          {/* Compliance overview */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-[15px] text-[#0D0D55]">Compliance Overview</h2>
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Calendar size={11} /> This week
              </span>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-5">
                <DonutChart compliant={compliantCount} atRisk={atRiskCount} nonCompliant={nonCompliantCount} />
                <div className="space-y-2.5 flex-1">
                  {[
                    { label: "Compliant", count: compliantCount, color: LIME },
                    { label: "Needs Attention", count: atRiskCount, color: PINK },
                    { label: "At Risk", count: nonCompliantCount, color: "#F87171" },
                    { label: "Not Assessed", count: weekSessions.filter(s => s.compliance_score === null || s.compliance_score === undefined).length, color: "#CBD5E1" },
                  ].map(({ label, count, color }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="text-sm text-slate-500 flex-1 text-xs">{label}</span>
                      <span className="text-sm font-bold text-[#0D0D55]">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Link href="/compliance">
                <button className="mt-4 w-full text-xs font-medium flex items-center justify-center gap-1 hover:underline" style={{ color: BLUE }}>
                  View compliance details <ArrowRight size={11} />
                </button>
              </Link>
            </div>
          </div>

          {/* Recent alerts */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-[15px] text-[#0D0D55]">Recent Alerts</h2>
              <Link href="/compliance">
                <span className="text-xs font-medium flex items-center gap-1 hover:underline cursor-pointer" style={{ color: BLUE }}>
                  View all <ArrowRight size={11} />
                </span>
              </Link>
            </div>
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-6">
                <CheckCircle2 size={24} className="text-emerald-400" />
                <p className="text-sm font-medium text-slate-500">No active alerts</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {(alerts as Alert[]).slice(0, 3).map((alert) => (
                  <AlertRow key={alert.id} alert={alert} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-[15px] text-[#0D0D55]">Quick Actions</h2>
        </div>
        <div className="flex items-center gap-2 px-4 py-4 flex-wrap">
          <QuickActionBtn
            href="/sessions/new"
            label="New Session"
            icon={<Calendar size={22} />}
            bg={`${LIME}45`}
            iconColor="#4d6000"
          />
          <QuickActionBtn
            href="/participants/new"
            label="Add Participant"
            icon={<UserPlus size={22} />}
            bg={`${PINK}20`}
            iconColor={PINK}
          />
          <QuickActionBtn
            href="/incidents/new"
            label="Report Incident"
            icon={<AlertTriangle size={22} />}
            bg="#FFF7ED"
            iconColor="#EA580C"
          />
          <QuickActionBtn
            href="/sessions"
            label="Upload Document"
            icon={<UploadCloud size={22} />}
            bg={`${BLUE}14`}
            iconColor={BLUE}
          />
          <QuickActionBtn
            href="/compliance"
            label="View Reports"
            icon={<FileBarChart2 size={22} />}
            bg={`${PINK}12`}
            iconColor={PINK}
          />
          <QuickActionBtn
            href="/patients"
            label="All Participants"
            icon={<Users size={22} />}
            bg={`${LIME}35`}
            iconColor="#4D5E00"
          />
        </div>
      </div>
    </div>
  );
}

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

// Palette (matches reference images)
const LIME = "#D9F103";          // unused now but kept to avoid dead-ref errors
const PINK = "#FA879F";          // unused now
const BLUE = "#5271FF";          // unused now
const NAVY = "#0D0D55";          // unused now
const ROSE = "#E2457A";          // unused now
const PERIWINKLE = "#7B8FD4";    // primary action colour
const BLUSH = "#F4C3D9";         // soft accent fill
const BLUSH_MID = "#C084A0";     // medium blush (text on blush bg)
const TEXT_DARK = "#37352F";     // primary text (warm near-black)
const TEXT_MID = "#718096";      // secondary text

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
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth="13" />
        {arc(compliant, 0, "#22C55E", "c")}
        {arc(atRisk, compliant / total, "#F59E0B", "a")}
        {arc(nonCompliant, (compliant + atRisk) / total, "#EF4444", "n")}
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
    <div className="bg-white rounded-2xl p-5 hover:shadow-md transition-all cursor-pointer group" style={{ border: "1px solid #E8E4F0", boxShadow: "0 1px 4px rgba(123,143,212,0.06)" }}>
      <div className="flex items-start justify-between mb-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: bg }}>
          {icon}
        </div>
      </div>
      <p className={cn("text-3xl font-bold leading-none", textColor)}>{value}</p>
      <p className="text-sm mt-1 leading-tight" style={{ color: TEXT_MID }}>{label}</p>
      {sub && <p className="text-xs mt-1" style={{ color: "#A0AEC0" }}>{sub}</p>}
      {href && (
        <p className="text-xs font-medium mt-3 flex items-center gap-1 group-hover:gap-1.5 transition-all" style={{ color: PERIWINKLE }}>
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
    ? <Badge className="text-[11px] px-2.5 py-0.5 rounded-full border-0 bg-emerald-50 text-emerald-700 font-medium">✓ Completed</Badge>
    : session.status === "in_progress"
    ? <Badge className="text-[11px] px-2.5 py-0.5 rounded-full border-0 font-medium" style={{ background: "#EEF0FB", color: PERIWINKLE }}>● In Progress</Badge>
    : isNext
    ? <Badge className="text-[11px] px-2.5 py-0.5 rounded-full border-0 font-medium" style={{ background: "#FBF0F6", color: BLUSH_MID }}>▶ Next</Badge>
    : <Badge className="text-[11px] px-2.5 py-0.5 rounded-full border-0 font-medium" style={{ background: "#F4F2FB", color: TEXT_MID }}>+ Upcoming</Badge>;

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
          <h1 className="text-2xl font-bold" style={{ color: TEXT_DARK }}>
            {greeting}, {firstName}! 👋
          </h1>
          <p className="text-sm mt-0.5" style={{ color: TEXT_MID }}>Here's what's happening today.</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <Link href="/participants/new">
            <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold bg-white transition-colors hover:bg-[#F8F6FC]"
              style={{ border: "1px solid #E8E4F0", color: TEXT_DARK }}>
              <UserPlus size={14} />
              Add Participant
            </button>
          </Link>
          <Link href="/sessions/new">
            <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[13px] font-semibold hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(135deg, #8B9FE8 0%, #6B7FD4 100%)" }}>
              <Play size={13} className="fill-current" />
              New Session
            </button>
          </Link>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Sessions today"
          value={todaySessions.length}
          icon={<Calendar size={19} style={{ color: ROSE }} />}
          bg="#FFF0F5"
          textColor="text-[#0D0D55]"
          href="/sessions"
        />
        <StatCard
          label="Ready to bill"
          value={readyCount}
          icon={<CheckCircle2 size={19} style={{ color: "#16A34A" }} />}
          bg="#F0FDF4"
          textColor="text-[#0D0D55]"
          sub={readyCount > 0 ? "Compliant & complete" : ""}
          href="/sessions"
        />
        <StatCard
          label="Need attention"
          value={needsAttentionCount}
          icon={<AlertCircle size={19} style={{ color: "#D97706" }} />}
          bg="#FFFBEB"
          textColor={needsAttentionCount > 0 ? "text-amber-700" : "text-[#0D0D55]"}
          href="/compliance"
        />
        <StatCard
          label="Incomplete (prior days)"
          value={pastIncomplete.length}
          icon={<Clock size={19} style={{ color: "#DC2626" }} />}
          bg="#FEF2F2"
          textColor={pastIncomplete.length > 0 ? "text-red-600" : "text-[#0D0D55]"}
          href="/sessions"
        />
      </div>

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Left: Today's Schedule */}
        <div className="lg:col-span-3 bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #E8E4F0", boxShadow: "0 1px 4px rgba(123,143,212,0.06)" }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #F0EDF6" }}>
            <h2 className="font-semibold text-[15px]" style={{ color: TEXT_DARK }}>Today's Schedule</h2>
            <Link href="/sessions">
              <span className="text-xs font-medium flex items-center gap-1 hover:underline cursor-pointer" style={{ color: PERIWINKLE }}>
                View all <ArrowRight size={12} />
              </span>
            </Link>
          </div>

          {sessionsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#A0AEC0" }} />
            </div>
          ) : todaySessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-center px-6">
              <div className="h-12 w-12 rounded-2xl flex items-center justify-center" style={{ background: "#EEF0FB" }}>
                <Calendar size={22} style={{ color: PERIWINKLE }} />
              </div>
              <p className="font-semibold" style={{ color: TEXT_DARK }}>No sessions today</p>
              <p className="text-sm" style={{ color: TEXT_MID }}>Start by creating a new session for a participant.</p>
              <Link href="/sessions/new">
                <button className="mt-1 px-4 py-2 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                  style={{ background: "linear-gradient(135deg, #8B9FE8 0%, #6B7FD4 100%)" }}>
                  New Session
                </button>
              </Link>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "#F8F6FC" }}>
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
            <div className="px-5 py-3" style={{ borderTop: "1px solid #F8F6FC" }}>
              <Link href="/sessions">
                <span className="text-xs font-medium cursor-pointer" style={{ color: PERIWINKLE }}>
                  View full schedule →
                </span>
              </Link>
            </div>
          )}
        </div>

        {/* Right: Compliance + Alerts */}
        <div className="lg:col-span-2 space-y-5">
          {/* Compliance overview */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #E8E4F0", boxShadow: "0 1px 4px rgba(123,143,212,0.06)" }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #F0EDF6" }}>
              <h2 className="font-semibold text-[15px]" style={{ color: TEXT_DARK }}>Compliance Overview</h2>
              <span className="text-xs flex items-center gap-1" style={{ color: TEXT_MID }}>
                <Calendar size={11} /> This week
              </span>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-5">
                <DonutChart compliant={compliantCount} atRisk={atRiskCount} nonCompliant={nonCompliantCount} />
                <div className="space-y-2.5 flex-1">
                  {[
                    { label: "Compliant", count: compliantCount, color: "#22C55E" },
                    { label: "Needs Attention", count: atRiskCount, color: "#F59E0B" },
                    { label: "At Risk", count: nonCompliantCount, color: "#EF4444" },
                    { label: "Not Assessed", count: weekSessions.filter(s => s.compliance_score === null || s.compliance_score === undefined).length, color: "#CBD5E1" },
                  ].map(({ label, count, color }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                      <span className="flex-1 text-xs" style={{ color: TEXT_MID }}>{label}</span>
                      <span className="text-sm font-bold" style={{ color: TEXT_DARK }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Link href="/compliance">
                <button className="mt-4 w-full text-xs font-medium flex items-center justify-center gap-1 hover:underline" style={{ color: PERIWINKLE }}>
                  View compliance details <ArrowRight size={11} />
                </button>
              </Link>
            </div>
          </div>

          {/* Recent alerts */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #E8E4F0", boxShadow: "0 1px 4px rgba(123,143,212,0.06)" }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #F0EDF6" }}>
              <h2 className="font-semibold text-[15px]" style={{ color: TEXT_DARK }}>Recent Alerts</h2>
              <Link href="/compliance">
                <span className="text-xs font-medium flex items-center gap-1 hover:underline cursor-pointer" style={{ color: PERIWINKLE }}>
                  View all <ArrowRight size={11} />
                </span>
              </Link>
            </div>
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-6">
                <CheckCircle2 size={24} className="text-emerald-400" />
                <p className="text-sm font-medium" style={{ color: TEXT_MID }}>No active alerts</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "#F8F6FC" }}>
                {(alerts as Alert[]).slice(0, 3).map((alert) => (
                  <AlertRow key={alert.id} alert={alert} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #E8E4F0", boxShadow: "0 1px 4px rgba(123,143,212,0.06)" }}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid #F0EDF6" }}>
          <h2 className="font-semibold text-[15px]" style={{ color: TEXT_DARK }}>Quick Actions</h2>
        </div>
        <div className="flex items-center gap-2 px-4 py-4 flex-wrap">
          <QuickActionBtn
            href="/sessions/new"
            label="New Session"
            icon={<Calendar size={22} />}
            bg="#EEF0FB"
            iconColor={PERIWINKLE}
          />
          <QuickActionBtn
            href="/participants/new"
            label="Add Participant"
            icon={<UserPlus size={22} />}
            bg="#FBF0F6"
            iconColor={BLUSH_MID}
          />
          <QuickActionBtn
            href="/incidents/new"
            label="Report Incident"
            icon={<AlertTriangle size={22} />}
            bg="#FFFBEB"
            iconColor="#D97706"
          />
          <QuickActionBtn
            href="/sessions"
            label="Upload Document"
            icon={<UploadCloud size={22} />}
            bg="#EEF0FB"
            iconColor={PERIWINKLE}
          />
          <QuickActionBtn
            href="/compliance"
            label="View Reports"
            icon={<FileBarChart2 size={22} />}
            bg="#F0FDF4"
            iconColor="#16A34A"
          />
          <QuickActionBtn
            href="/patients"
            label="All Participants"
            icon={<Users size={22} />}
            bg="#FBF0F6"
            iconColor={BLUSH_MID}
          />
        </div>
      </div>
    </div>
  );
}

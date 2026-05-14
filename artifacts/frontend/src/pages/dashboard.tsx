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
  Clock,
  Users,
  AlertTriangle,
  ChevronRight,
  FileBarChart2,
  ClipboardList,
  Loader2,
  Sparkles,
  Activity,
} from "lucide-react";

// ── Design tokens ──────────────────────────────────────────────────────────────
const PLUM        = "#542269";
const CORAL       = "#F1738A";
const T1          = "#1C1626";
const T2          = "#4A3D5A";
const T3          = "#7A6A8A";
const BORDER      = "rgba(232,213,232,0.5)";
const CARD_SHADOW = "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

// ── Helpers ────────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function StatusBadge({ score, status }: { score?: number | null; status?: string }) {
  if (status === "draft" || (!score && !status)) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: "rgba(84,34,105,0.06)", color: T3 }}>Draft</span>
    );
  }
  if (score != null) {
    const cfg = score >= 85
      ? { bg: "rgba(22,163,74,0.08)", color: "#16A34A", label: "Compliant" }
      : score >= 60
      ? { bg: "rgba(245,158,11,0.08)", color: "#D97706", label: "At Risk" }
      : { bg: "rgba(239,68,68,0.08)", color: "#DC2626", label: "Non-Compliant" };
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: cfg.bg, color: cfg.color }}>
        <ShieldCheck size={9} />
        {cfg.label}
      </span>
    );
  }
  return null;
}

// ── Stat card ──────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, accent, loading,
}: {
  label: string;
  value: number | string;
  sub: string;
  icon: React.ComponentType<{ size?: number }>;
  accent: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl p-5" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T3 }}>
          {label}
        </span>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: `${accent}12` }}>
          <Icon size={15} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-16 rounded-lg animate-pulse" style={{ background: "rgba(232,213,232,0.4)" }} />
      ) : (
        <p className="text-[28px] font-bold leading-none" style={{ color: T1 }}>{value}</p>
      )}
      <p className="text-[12px] mt-1.5" style={{ color: T3 }}>{sub}</p>
    </div>
  );
}

// ── Quick action button ────────────────────────────────────────────────────────
function QuickBtn({
  label, icon: Icon, href, onClick,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  href?: string;
  onClick?: () => void;
}) {
  const inner = (
    <div
      className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-white text-center transition-all duration-150 hover:-translate-y-0.5 cursor-pointer"
      style={{ boxShadow: CARD_SHADOW }}
      onClick={onClick}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center"
        style={{ background: `${PLUM}0A` }}>
        <Icon size={16} />
      </div>
      <span className="text-[12px] font-semibold leading-tight" style={{ color: T2 }}>{label}</span>
    </div>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: sessions = [], isLoading: sessionsLoading } = useGetSessions({ limit: 50 });
  const { data: participants = [], isLoading: participantsLoading } = useGetParticipants();
  const { data: alerts = [], isLoading: alertsLoading }           = useGetUnreadAlerts();
  const { data: rawOverview, isLoading: overviewLoading }         = useGetComplianceOverview();

  // Computed stats from real data
  const now      = new Date();
  const weekAgo  = subDays(now, 7);
  const thisWeek = sessions.filter(s => {
    try { return isAfter(parseISO(s.session_date), weekAgo); } catch { return false; }
  });

  const missingNotes = sessions.filter(s =>
    !s.notes || (s.notes as string).trim().length < 30
  ).length;

  const complianceScore = (rawOverview as any)?.average_score ?? null;
  const unreadCount     = (Array.isArray(alerts) ? alerts : []).length;

  const recentSessions = sessions.slice(0, 6);
  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Welcome card ─────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #FAF5FF 0%, #FDF0F5 50%, #F6F4FB 100%)",
          boxShadow: CARD_SHADOW,
        }}
      >
        {/* Decorative blobs */}
        <div className="absolute top-0 right-0 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: `${CORAL}10`, transform: "translate(30%, -30%)", filter: "blur(32px)" }} />
        <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full pointer-events-none"
          style={{ background: `${PLUM}08`, transform: "translate(-20%, 30%)", filter: "blur(24px)" }} />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles size={14} style={{ color: CORAL }} />
              <span className="text-[12px] font-semibold" style={{ color: T3 }}>
                {format(now, "EEEE, MMMM d")}
              </span>
            </div>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight" style={{ color: T1 }}>
              {greeting()}, {firstName}
            </h1>
            <p className="text-[14px] mt-1.5" style={{ color: T2 }}>
              {sessionsLoading
                ? "Loading your sessions…"
                : `${thisWeek.length} session${thisWeek.length !== 1 ? "s" : ""} this week · ${missingNotes > 0 ? `${missingNotes} note${missingNotes !== 1 ? "s" : ""} still needed` : "All notes complete"}`}
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Link href="/sessions/new">
              <button
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all duration-200 hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                <Play size={13} fill="white" /> Start Session
              </button>
            </Link>
            <Link href="/patients/new">
              <button
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold border bg-white transition-all duration-150 hover:shadow-sm"
                style={{ borderColor: BORDER, color: T2 }}
              >
                <Plus size={13} /> Add Participant
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Participants"
          value={participantsLoading ? "—" : participants.length}
          sub="Active participants"
          icon={Users}
          accent={PLUM}
          loading={participantsLoading}
        />
        <StatCard
          label="Sessions"
          value={sessionsLoading ? "—" : thisWeek.length}
          sub="This week"
          icon={Calendar}
          accent={CORAL}
          loading={sessionsLoading}
        />
        <StatCard
          label="Missing Notes"
          value={sessionsLoading ? "—" : missingNotes}
          sub={missingNotes === 0 ? "All notes complete" : "Sessions need attention"}
          icon={ClipboardList}
          accent={missingNotes > 0 ? "#D97706" : "#16A34A"}
          loading={sessionsLoading}
        />
        <StatCard
          label="Compliance Alerts"
          value={alertsLoading ? "—" : unreadCount}
          sub={unreadCount === 0 ? "No new alerts" : "Unread alerts"}
          icon={AlertTriangle}
          accent={unreadCount > 0 ? "#DC2626" : "#16A34A"}
          loading={alertsLoading}
        />
      </div>

      {/* ── Main grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recent sessions (left, spans 2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
          <div
            className="flex items-center justify-between px-5 py-4 border-b"
            style={{ borderColor: "rgba(232,213,232,0.4)" }}
          >
            <div>
              <h2 className="text-[15px] font-semibold" style={{ color: T1 }}>Recent Sessions</h2>
              <p className="text-[12px] mt-0.5" style={{ color: T3 }}>Your latest clinical activity</p>
            </div>
            <Link href="/sessions">
              <button
                className="flex items-center gap-1 text-[12px] font-semibold transition-colors duration-150 hover:opacity-70"
                style={{ color: CORAL }}
              >
                View all <ChevronRight size={13} />
              </button>
            </Link>
          </div>

          <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.25)" }}>
            {sessionsLoading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="px-5 py-3.5 flex items-center gap-3 animate-pulse">
                  <div className="w-8 h-8 rounded-xl shrink-0" style={{ background: "rgba(232,213,232,0.45)" }} />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-36 rounded" style={{ background: "rgba(232,213,232,0.45)" }} />
                    <div className="h-2.5 w-24 rounded" style={{ background: "rgba(232,213,232,0.35)" }} />
                  </div>
                </div>
              ))
            ) : recentSessions.length === 0 ? (
              <div className="py-14 flex flex-col items-center gap-2">
                <Calendar size={24} style={{ color: "rgba(122,106,138,0.3)" }} />
                <p className="text-[13px] font-medium" style={{ color: T3 }}>No sessions yet</p>
                <Link href="/sessions/new">
                  <button
                    className="mt-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-colors hover:opacity-80"
                    style={{ color: CORAL }}
                  >
                    Start your first session →
                  </button>
                </Link>
              </div>
            ) : (
              recentSessions.map(session => {
                const name = (session as any).participants?.full_name;
                const initials = name
                  ? name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
                  : "?";
                let dateStr = "—";
                try { dateStr = format(parseISO(session.session_date), "MMM d · h:mm a"); } catch {}

                return (
                  <div
                    key={session.id}
                    className="flex items-center gap-3.5 px-5 py-3 transition-colors duration-150 hover:bg-[#F6F4FB]/60 cursor-pointer group"
                    onClick={() => navigate(`/sessions/${session.id}`)}
                  >
                    {/* Avatar */}
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0"
                      style={{ background: `${PLUM}10`, color: PLUM }}
                    >
                      {initials}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[13px] font-semibold truncate transition-colors duration-150 group-hover:text-[#542269]"
                        style={{ color: T1 }}
                      >
                        {name || "Unknown Participant"}
                      </p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] truncate" style={{ color: T3 }}>
                          {session.session_type}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] shrink-0" style={{ color: T3 }}>
                          <Calendar size={10} /> {dateStr}
                        </span>
                        {session.duration_minutes && (
                          <span className="flex items-center gap-1 text-[11px] shrink-0" style={{ color: T3 }}>
                            <Clock size={10} /> {session.duration_minutes}m
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status + action */}
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge score={session.compliance_score} status={session.status} />
                      {session.status === "in_progress" && (
                        <button
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all duration-150 hover:opacity-80"
                          style={{ borderColor: `${CORAL}40`, color: CORAL, background: `${CORAL}08` }}
                          onClick={e => { e.stopPropagation(); navigate(`/sessions/${session.id}/live`); }}
                        >
                          <Play size={9} fill={CORAL} /> Continue
                        </button>
                      )}
                      <ChevronRight size={13} style={{ color: T3, opacity: 0.5 }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">

          {/* Compliance score card */}
          <div className="bg-white rounded-2xl p-5" style={{ boxShadow: CARD_SHADOW }}>
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} style={{ color: T3 }} />
              <h3 className="text-[14px] font-semibold" style={{ color: T1 }}>Compliance Score</h3>
            </div>

            {overviewLoading ? (
              <div className="h-16 animate-pulse rounded-xl" style={{ background: "rgba(232,213,232,0.3)" }} />
            ) : complianceScore !== null ? (
              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <span className="text-[36px] font-bold leading-none" style={{ color: T1 }}>
                    {Math.round(complianceScore)}
                  </span>
                  <span className="text-[14px] mb-1" style={{ color: T3 }}>/100</span>
                </div>
                {/* Arc progress bar */}
                <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(232,213,232,0.4)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${complianceScore}%`,
                      background: complianceScore >= 85
                        ? "#16A34A"
                        : complianceScore >= 60
                        ? "#D97706"
                        : "#DC2626",
                    }}
                  />
                </div>
                <p className="text-[12px]" style={{ color: T3 }}>
                  {complianceScore >= 85
                    ? "Audit-ready — excellent documentation"
                    : complianceScore >= 60
                    ? "At risk — some sessions need attention"
                    : "Action needed — compliance is low"}
                </p>
                <Link href="/compliance">
                  <button
                    className="w-full mt-1 py-2 rounded-xl text-[12px] font-semibold border transition-all duration-150 hover:shadow-sm"
                    style={{ borderColor: BORDER, color: T2 }}
                  >
                    View full report →
                  </button>
                </Link>
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: T3 }}>Run a session to see your compliance score.</p>
            )}
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
            <div
              className="px-5 py-3.5 border-b"
              style={{ borderColor: "rgba(232,213,232,0.4)" }}
            >
              <h3 className="text-[14px] font-semibold" style={{ color: T1 }}>Quick Actions</h3>
            </div>
            <div className="grid grid-cols-2 gap-0 divide-x divide-y" style={{ borderColor: "rgba(232,213,232,0.3)" }}>
              {[
                { label: "New Session",    icon: Play,          href: "/sessions/new"  },
                { label: "Add Participant",icon: Users,         href: "/patients"      },
                { label: "View Sessions",  icon: Calendar,      href: "/sessions"      },
                { label: "Audit Report",   icon: FileBarChart2, href: "/compliance"    },
              ].map(({ label, icon: Icon, href }) => (
                <Link key={label} href={href}>
                  <button
                    className="w-full flex flex-col items-center gap-1.5 py-4 px-3 transition-colors duration-150 hover:bg-[#F6F4FB]"
                  >
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{ background: `${PLUM}0A` }}>
                      <Icon size={14} style={{ color: PLUM }} />
                    </div>
                    <span className="text-[11px] font-semibold leading-tight text-center" style={{ color: T2 }}>
                      {label}
                    </span>
                  </button>
                </Link>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

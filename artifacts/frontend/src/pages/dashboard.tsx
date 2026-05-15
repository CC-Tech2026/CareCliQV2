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
  FileText,
  CircleDot,
} from "lucide-react";

// ── Design tokens (warm clinical palette) ─────────────────────────────────────
const PLUM        = "#542269";
const CORAL       = "#F1738A";
const T1          = "#1C1626";
const T2          = "#4A3D5A";
const T3          = "#7A6A8A";
const BORDER      = "rgba(232,213,232,0.5)";
const CARD_SHADOW = "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

// ── Compliance chip ────────────────────────────────────────────────────────────
function ComplianceChip({ score, status }: { score?: number | null; status?: string }) {
  if (status === "draft" || (!score && !status)) {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: "rgba(84,34,105,0.06)", color: T3 }}>Draft</span>
    );
  }
  if (score != null) {
    const cfg = score >= 85
      ? { bg: "rgba(22,163,74,0.08)",   color: "#16A34A", label: "Compliant" }
      : score >= 60
      ? { bg: "rgba(245,158,11,0.08)",  color: "#D97706", label: "At Risk" }
      : { bg: "rgba(239,68,68,0.08)",   color: "#DC2626", label: "Non-Compliant" };
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
        style={{ background: cfg.bg, color: cfg.color }}>
        <ShieldCheck size={9} />{cfg.label}
      </span>
    );
  }
  return null;
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, icon: Icon, accent, loading,
}: {
  label: string; value: number | string; sub: string;
  icon: React.ComponentType<{ size?: number }>;
  accent: string; loading?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl p-5" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T3 }}>
          {label}
        </span>
        <div className="w-7 h-7 rounded-xl flex items-center justify-center"
          style={{ background: `${accent}12` }}>
          <Icon size={14} />
        </div>
      </div>
      {loading ? (
        <div className="h-7 w-14 rounded-lg animate-pulse" style={{ background: "rgba(232,213,232,0.4)" }} />
      ) : (
        <p className="text-[26px] font-bold leading-none tracking-tight" style={{ color: T1 }}>{value}</p>
      )}
      <p className="text-[12px] mt-1" style={{ color: T3 }}>{sub}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: sessions = [],     isLoading: sessionsLoading }     = useGetSessions({ limit: 50 });
  const { data: participants = [], isLoading: participantsLoading } = useGetParticipants();
  const { data: alerts = [],       isLoading: alertsLoading }       = useGetUnreadAlerts();
  const { data: rawOverview,       isLoading: overviewLoading }     = useGetComplianceOverview();

  const now             = new Date();
  const weekAgo         = subDays(now, 7);
  const thisWeek        = sessions.filter(s => {
    try { return isAfter(parseISO(s.session_date), weekAgo); } catch { return false; }
  });
  const missingNotes    = sessions.filter(s =>
    !s.notes || (s.notes as string).trim().length < 30
  );
  const inProgress      = sessions.find(s => s.status === "in_progress");
  const complianceScore = (rawOverview as { average_score?: number })?.average_score ?? null;
  const unreadCount     = Array.isArray(alerts) ? alerts.length : 0;
  const recentSessions  = sessions.slice(0, 6);
  const firstName       = user?.full_name?.split(" ")[0] ?? "there";

  function fmtDate(d?: string | null) {
    if (!d) return "—";
    try { return format(parseISO(d), "d MMM"); } catch { return d; }
  }

  function sessionTypeLabel(t?: string | null) {
    if (!t) return "Session";
    return t.split("_").map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  }

  return (
    <div className="space-y-5 max-w-5xl">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 pt-1">
        <div>
          <p className="text-[12px] font-medium mb-0.5" style={{ color: T3 }}>
            {format(now, "EEEE, d MMMM yyyy")}
          </p>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: T1 }}>
            {greeting()}, {firstName}
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: T2 }}>
            {sessionsLoading
              ? "Loading…"
              : `${thisWeek.length} session${thisWeek.length !== 1 ? "s" : ""} this week`
              + (missingNotes.length > 0
                ? ` · ${missingNotes.length} note${missingNotes.length !== 1 ? "s" : ""} incomplete`
                : " · all notes complete")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/sessions/new">
            <button
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-[13px] font-bold hover:opacity-90 transition-opacity"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              <Play size={13} fill="white" /> Start Session
            </button>
          </Link>
          <Link href="/patients">
            <button
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-semibold bg-white hover:bg-pink-50 transition-colors"
              style={{ border: `1px solid ${BORDER}`, color: T2 }}
            >
              <Plus size={13} /> Add Participant
            </button>
          </Link>
        </div>
      </div>

      {/* ── Continue last session ───────────────────────────────────────── */}
      {inProgress && (
        <div
          className="flex items-center justify-between px-5 py-4 rounded-2xl bg-white border-l-4"
          style={{ boxShadow: CARD_SHADOW, borderLeftColor: PLUM }}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(84,34,105,0.07)" }}>
              <CircleDot size={15} style={{ color: PLUM }} />
            </div>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: T1 }}>Session in progress</p>
              <p className="text-[12px]" style={{ color: T3 }}>
                {sessionTypeLabel(inProgress.session_type)} · {fmtDate(inProgress.session_date)}
              </p>
            </div>
          </div>
          <Link href={`/sessions/${inProgress.id}/live`}>
            <button
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-[12.5px] font-bold hover:opacity-90 transition-opacity"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              <Play size={12} fill="white" /> Continue
            </button>
          </Link>
        </div>
      )}

      {/* ── Incomplete notes alert ──────────────────────────────────────── */}
      {!sessionsLoading && missingNotes.length > 0 && (
        <div
          className="flex items-center justify-between px-5 py-3 rounded-2xl"
          style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle size={15} style={{ color: "#92400E" }} />
            <p className="text-[13px] font-medium" style={{ color: "#92400E" }}>
              {missingNotes.length} session{missingNotes.length !== 1 ? "s" : ""} missing clinical notes
            </p>
          </div>
          <Link href="/sessions">
            <button className="text-[12px] font-semibold underline underline-offset-2" style={{ color: "#92400E" }}>
              Review
            </button>
          </Link>
        </div>
      )}

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Participants"  value={participantsLoading ? "—" : participants.length} sub="Active"         icon={Users}      accent={PLUM}  loading={participantsLoading} />
        <StatCard label="Sessions"      value={sessionsLoading     ? "—" : thisWeek.length}     sub="This week"     icon={Calendar}   accent={CORAL} loading={sessionsLoading} />
        <StatCard label="Incomplete"    value={sessionsLoading     ? "—" : missingNotes.length} sub="Notes needed"  icon={FileText}   accent={CORAL} loading={sessionsLoading} />
        <StatCard label="Compliance"    value={overviewLoading     ? "—" : complianceScore != null ? `${Math.round(complianceScore)}%` : "—"} sub="Avg. audit score" icon={ShieldCheck} accent={PLUM} loading={overviewLoading} />
      </div>

      {/* ── Two-column row ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Recent sessions (2/3) */}
        <div className="lg:col-span-2 bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
          <div className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: `1px solid ${BORDER}` }}>
            <h2 className="text-[14px] font-semibold" style={{ color: T1 }}>Recent Sessions</h2>
            <Link href="/sessions">
              <button className="flex items-center gap-1 text-[12px] font-medium hover:underline" style={{ color: PLUM }}>
                View all <ChevronRight size={13} />
              </button>
            </Link>
          </div>

          {sessionsLoading ? (
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {Array(4).fill(0).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-4 w-24 rounded-lg animate-pulse" style={{ background: "rgba(232,213,232,0.4)" }} />
                  <div className="h-4 w-16 rounded-lg animate-pulse ml-auto" style={{ background: "rgba(232,213,232,0.4)" }} />
                </div>
              ))}
            </div>
          ) : recentSessions.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Calendar size={28} className="mx-auto mb-2 opacity-25" style={{ color: T3 }} />
              <p className="text-[13px]" style={{ color: T3 }}>No sessions yet</p>
              <Link href="/sessions/new">
                <button className="mt-3 text-[12px] font-semibold underline" style={{ color: PLUM }}>
                  Start your first session
                </button>
              </Link>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {recentSessions.map((s) => {
                const isLive = s.status === "in_progress";
                return (
                  <Link key={s.id} href={isLive ? `/sessions/${s.id}/live` : `/sessions/${s.id}`}>
                    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-pink-50/40 transition-colors cursor-pointer">
                      <div className="shrink-0 text-center w-10">
                        <p className="text-[18px] font-bold leading-none" style={{ color: T1 }}>
                          {s.session_date ? format(parseISO(s.session_date), "d") : "—"}
                        </p>
                        <p className="text-[10px] font-medium uppercase" style={{ color: T3 }}>
                          {s.session_date ? format(parseISO(s.session_date), "MMM") : ""}
                        </p>
                      </div>
                      <div className="w-px h-8 shrink-0" style={{ background: BORDER }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: T1 }}>
                          {sessionTypeLabel(s.session_type)}
                          {isLive && (
                            <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ background: "rgba(84,34,105,0.07)", color: PLUM }}>
                              <span className="w-1.5 h-1.5 rounded-full animate-pulse inline-block" style={{ background: PLUM }} />
                              Live
                            </span>
                          )}
                        </p>
                        <p className="text-[11.5px] truncate mt-0.5" style={{ color: T3 }}>
                          {s.duration_minutes ? `${s.duration_minutes} min` : "Duration TBD"}
                          {s.notes && ` · ${(s.notes as string).slice(0, 60)}…`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <ComplianceChip score={s.compliance_score} status={s.status} />
                        <ChevronRight size={14} style={{ color: T3 }} />
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Right column (1/3) */}
        <div className="space-y-4">

          {/* Quick actions */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
            <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <h2 className="text-[14px] font-semibold" style={{ color: T1 }}>Quick Actions</h2>
            </div>
            <div className="divide-y" style={{ borderColor: BORDER }}>
              {[
                { label: "Start New Session",  icon: Play,       href: "/sessions/new" },
                { label: "View Participants",  icon: Users,      href: "/patients" },
                { label: "Compliance Report",  icon: ShieldCheck, href: "/compliance" },
                { label: "View All Sessions",  icon: Calendar,   href: "/sessions" },
              ].map(({ label, icon: Icon, href }) => (
                <Link key={label} href={href}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-pink-50/40 transition-colors cursor-pointer">
                    <Icon size={14} style={{ color: CORAL }} />
                    <span className="text-[13px] font-medium" style={{ color: T1 }}>{label}</span>
                    <ChevronRight size={13} className="ml-auto" style={{ color: T3 }} />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Compliance summary */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
            <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <h2 className="text-[14px] font-semibold" style={{ color: T1 }}>Compliance</h2>
            </div>
            <div className="px-4 py-4">
              {overviewLoading ? (
                <div className="h-8 w-24 rounded-lg animate-pulse" style={{ background: "rgba(232,213,232,0.4)" }} />
              ) : complianceScore != null ? (
                <>
                  <div className="flex items-end gap-2 mb-2">
                    <span className="text-[32px] font-bold leading-none" style={{ color: T1 }}>
                      {Math.round(complianceScore)}
                    </span>
                    <span className="text-[16px] font-medium mb-0.5" style={{ color: T3 }}>/ 100</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full mb-2" style={{ background: "rgba(232,213,232,0.4)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, complianceScore)}%`,
                        background: complianceScore >= 85 ? "#16A34A" : complianceScore >= 60 ? "#D97706" : "#DC2626",
                      }}
                    />
                  </div>
                  <p className="text-[12px]" style={{ color: T3 }}>
                    {complianceScore >= 85
                      ? "Audit-ready · All sessions compliant"
                      : complianceScore >= 60
                      ? "Some sessions need attention"
                      : "Action required · Review failing sessions"}
                  </p>
                </>
              ) : (
                <p className="text-[13px]" style={{ color: T3 }}>No compliance data yet</p>
              )}
              <Link href="/compliance">
                <button className="mt-3 flex items-center gap-1 text-[12px] font-semibold" style={{ color: PLUM }}>
                  View full report <ChevronRight size={13} />
                </button>
              </Link>
            </div>
          </div>

          {/* Alerts panel */}
          {!alertsLoading && unreadCount > 0 && (
            <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
              <div className="px-4 py-3.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <h2 className="text-[14px] font-semibold" style={{ color: T1 }}>Alerts</h2>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
                  style={{ background: CORAL }}>
                  {unreadCount}
                </span>
              </div>
              <div className="divide-y" style={{ borderColor: BORDER }}>
                {(Array.isArray(alerts) ? alerts : []).slice(0, 3).map((alert: { id: string; message?: string; type?: string }) => (
                  <div key={alert.id} className="flex items-start gap-3 px-4 py-3">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" style={{ color: "#D97706" }} />
                    <p className="text-[12px] leading-relaxed" style={{ color: T2 }}>
                      {alert.message ?? "Compliance alert"}
                    </p>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3" style={{ borderTop: `1px solid ${BORDER}` }}>
                <Link href="/compliance">
                  <button className="text-[12px] font-semibold" style={{ color: PLUM }}>
                    Review all alerts →
                  </button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

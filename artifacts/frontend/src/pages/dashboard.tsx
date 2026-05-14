import { Link } from "wouter";
import { format } from "date-fns";
import { useGetSessions } from "@workspace/api-client-react";
import type { Session } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  Play, ArrowRight, UserPlus, ChevronRight,
  FileBarChart2, UploadCloud, Users, AlertTriangle, Loader2,
  TrendingUp,
} from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const PLUM   = "#542269";
const CORAL  = "#F1738A";
const BLUSH  = "#F6B8C0";

// Text — all WCAG AA on white
const T1 = "#1C1626";   // headings
const T2 = "#4A3D5A";   // body
const T3 = "#7A6A8A";   // captions (≥ 12 px only)

const BORDER = "rgba(232,213,232,0.5)";
const CARD_SHADOW = "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)";
const HOVER_SHADOW = "0 4px 16px rgba(84,34,105,0.10), 0 0 0 1px rgba(232,213,232,0.5)";
const PAGE_BG = "#F6F4FB";

// ── Compliance donut ──────────────────────────────────────────────────────────
function ComplianceGauge({ score = 94 }: { score?: number }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const arc = score >= 85 ? CORAL : score >= 60 ? "#F59E0B" : "#EF4444";
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="110" height="110" className="-rotate-90">
        <circle cx="55" cy="55" r={r} stroke="rgba(232,213,232,0.6)" strokeWidth="7" fill="none" />
        <circle
          cx="55" cy="55" r={r} stroke={arc} strokeWidth="7" fill="none"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 100)}
          strokeLinecap="round" className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[22px] font-bold leading-none" style={{ color: T1 }}>{score}%</span>
        <span className="text-[10px] font-semibold uppercase tracking-widest mt-0.5" style={{ color: T3 }}>Score</span>
      </div>
    </div>
  );
}

// ── Stat pill ─────────────────────────────────────────────────────────────────
function StatPill({
  label, value, accent, href,
}: { label: string; value: string | number; accent: string; href?: string }) {
  const inner = (
    <div
      className="group flex flex-col gap-2 rounded-2xl bg-white px-5 py-4 transition-shadow duration-200"
      style={{ boxShadow: CARD_SHADOW }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = HOVER_SHADOW)}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = CARD_SHADOW)}
    >
      <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: T3 }}>{label}</span>
      <span className="text-[28px] font-bold leading-none tracking-tight" style={{ color: accent }}>{value}</span>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ── Session list row ──────────────────────────────────────────────────────────
function SessionRow({ session, name }: { session: Session; name: string }) {
  const isLive = session.status === "in_progress";
  const isDone = session.status === "completed";

  const badge = isLive
    ? { bg: "rgba(241,115,138,0.10)", color: CORAL, label: "Live" }
    : isDone
    ? { bg: "rgba(22,163,74,0.08)", color: "#16A34A", label: "Done" }
    : { bg: "rgba(84,34,105,0.06)", color: T3, label: (session.status ?? "draft").replace("_", " ") };

  return (
    <div
      className={cn(
        "group flex items-center gap-4 px-6 py-3.5 transition-colors duration-150",
        isLive ? "bg-rose-50/40" : "hover:bg-[#F6F4FB]/70",
      )}
    >
      {/* Time */}
      <div className="w-10 shrink-0 text-right">
        <p className="text-[13px] font-semibold" style={{ color: T1 }}>
          {session.created_at ? format(new Date(session.created_at), "h:mm") : "--"}
        </p>
        <p className="text-[10px] font-medium uppercase" style={{ color: T3 }}>
          {session.created_at ? format(new Date(session.created_at), "a") : ""}
        </p>
      </div>

      {/* Avatar */}
      <div
        className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-[12px] font-bold"
        style={{ background: `${PLUM}10`, color: PLUM, border: `1.5px solid ${PLUM}1A` }}
      >
        {name.charAt(0).toUpperCase()}
      </div>

      {/* Name + type */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-semibold truncate" style={{ color: T1 }}>{name}</p>
          {isLive && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />}
        </div>
        <p className="text-[12px] font-medium truncate" style={{ color: T3 }}>
          {session.session_type ?? "General Session"}
        </p>
      </div>

      {/* Badge + link */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="px-2.5 py-1 rounded-full text-[11px] font-semibold capitalize"
          style={{ background: badge.bg, color: badge.color }}
        >
          {badge.label}
        </span>
        <Link href={`/sessions/${session.id}${isLive ? "/live" : ""}`}>
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center border transition-all duration-150 hover:shadow-sm"
            style={{ borderColor: BORDER, color: T3 }}
          >
            <ChevronRight size={15} />
          </div>
        </Link>
      </div>
    </div>
  );
}

// ── Quick action tile ─────────────────────────────────────────────────────────
function QuickAction({
  label, icon, iconBg, iconColor, href,
}: { label: string; icon: React.ReactNode; iconBg: string; iconColor: string; href?: string }) {
  const inner = (
    <div
      className="group flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-white border cursor-pointer transition-all duration-200 hover:-translate-y-0.5"
      style={{ borderColor: BORDER, boxShadow: CARD_SHADOW }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = HOVER_SHADOW)}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = CARD_SHADOW)}
    >
      <div className={cn("p-2.5 rounded-xl transition-transform duration-200 group-hover:scale-105", iconBg, iconColor)}>
        {icon}
      </div>
      <span className="text-[12px] font-semibold" style={{ color: T2 }}>{label}</span>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <>{inner}</>;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const { data: sessions = [], isLoading } = useGetSessions({ limit: 50 });

  const firstName = (user?.full_name ?? "").split(" ")[0] || "there";
  const today = format(new Date(), "EEEE, d MMMM");

  return (
    <div className="min-h-screen px-4 py-6 md:px-8 md:py-8" style={{ background: PAGE_BG }}>
      <div className="max-w-6xl mx-auto space-y-7">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: T3 }}>
              {today}
            </p>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight" style={{ color: T1 }}>
              Good morning, {firstName}
            </h1>
            <p className="text-[14px] mt-1" style={{ color: T2 }}>
              Here's your care overview for today.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link href="/participants/new">
              <button
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border text-[13px] font-semibold transition-all duration-200 hover:shadow-[0_2px_8px_rgba(84,34,105,0.08)]"
                style={{ borderColor: BORDER, color: T2 }}
              >
                <UserPlus size={14} strokeWidth={2} /> Add Participant
              </button>
            </Link>
            <Link href="/sessions/new">
              <button
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all duration-200 hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                <Play size={12} fill="white" /> New Session
              </button>
            </Link>
          </div>
        </header>

        {/* ── Stat strip ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatPill label="Total Sessions"  value={sessions.length} accent={T1}       href="/sessions"   />
          <StatPill label="Compliance"       value="94%"             accent="#16A34A"                    />
          <StatPill label="Pending Notes"    value="3"               accent="#D97706"                    />
          <StatPill label="Open Alerts"      value="0"               accent={T3}                         />
        </div>

        {/* ── Main grid ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Sessions list — 2/3 */}
          <section
            className="lg:col-span-2 bg-white rounded-2xl overflow-hidden"
            style={{ boxShadow: CARD_SHADOW }}
          >
            {/* Card header */}
            <div
              className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "rgba(232,213,232,0.4)" }}
            >
              <h2 className="text-[17px] font-semibold" style={{ color: T1 }}>Recent Sessions</h2>
              <Link href="/sessions">
                <span
                  className="flex items-center gap-1 text-[12px] font-semibold transition-opacity duration-150 hover:opacity-70"
                  style={{ color: CORAL }}
                >
                  View all <ArrowRight size={12} />
                </span>
              </Link>
            </div>

            {/* Rows */}
            <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.3)" }}>
              {isLoading ? (
                <div className="py-20 flex justify-center">
                  <Loader2 size={22} className="animate-spin" style={{ color: BLUSH }} />
                </div>
              ) : sessions.length === 0 ? (
                <div className="py-16 flex flex-col items-center text-center px-8">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
                    style={{ background: `${PLUM}0A` }}
                  >
                    <Play size={20} style={{ color: PLUM }} />
                  </div>
                  <p className="text-[15px] font-semibold" style={{ color: T1 }}>No sessions yet</p>
                  <p className="text-[13px] mt-1 max-w-xs" style={{ color: T3 }}>
                    Start your first clinical session to see it appear here.
                  </p>
                  <Link href="/sessions/new">
                    <button
                      className="mt-5 px-5 py-2.5 rounded-xl text-white text-[13px] font-bold"
                      style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
                    >
                      Start a session
                    </button>
                  </Link>
                </div>
              ) : (
                sessions.slice(0, 6).map(s => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    name={(s as any).participants?.full_name ?? "Participant"}
                  />
                ))
              )}
            </div>
          </section>

          {/* Right column */}
          <div className="flex flex-col gap-5">

            {/* Compliance card */}
            <section
              className="bg-white rounded-2xl p-6"
              style={{ boxShadow: CARD_SHADOW }}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[16px] font-semibold" style={{ color: T1 }}>Compliance</h2>
                <TrendingUp size={15} style={{ color: CORAL }} />
              </div>

              <div className="flex flex-col items-center gap-4">
                <ComplianceGauge score={94} />

                <div className="w-full grid grid-cols-2 gap-3">
                  <div
                    className="rounded-xl px-3 py-3 text-center"
                    style={{ background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.14)" }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#16A34A" }}>Compliant</p>
                    <p className="text-[20px] font-bold mt-0.5" style={{ color: T1 }}>85</p>
                  </div>
                  <div
                    className="rounded-xl px-3 py-3 text-center"
                    style={{ background: "rgba(241,115,138,0.06)", border: "1px solid rgba(241,115,138,0.14)" }}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: CORAL }}>At Risk</p>
                    <p className="text-[20px] font-bold mt-0.5" style={{ color: T1 }}>12</p>
                  </div>
                </div>

                <Link href="/compliance" className="w-full">
                  <button
                    className="w-full py-2.5 rounded-xl text-[13px] font-semibold border transition-all duration-200 hover:bg-[#F6F4FB]"
                    style={{ borderColor: BORDER, color: T2 }}
                  >
                    View Audit Log
                  </button>
                </Link>
              </div>
            </section>

            {/* Quick actions */}
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-3 px-0.5" style={{ color: T3 }}>
                Quick Actions
              </p>
              <div className="grid grid-cols-2 gap-3">
                <QuickAction label="Reports"      icon={<FileBarChart2 size={17} />} iconBg="bg-blue-50"    iconColor="text-blue-600"   href="/reports"    />
                <QuickAction label="Upload"        icon={<UploadCloud size={17} />}   iconBg="bg-violet-50"  iconColor="text-violet-600"               />
                <QuickAction label="Participants"  icon={<Users size={17} />}         iconBg="bg-emerald-50" iconColor="text-emerald-600" href="/patients"   />
                <QuickAction label="Incidents"     icon={<AlertTriangle size={17} />} iconBg="bg-rose-50"    iconColor="text-rose-500"    href="/incidents"  />
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

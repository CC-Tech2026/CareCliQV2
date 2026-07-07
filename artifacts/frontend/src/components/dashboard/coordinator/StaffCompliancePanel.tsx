/**
 * StaffCompliancePanel — NDIS-grounded worker compliance view.
 *
 * Shows at-risk workers first, with multi-select filter chips
 * mapped to NDIS Practice Standard categories:
 *
 *  – Missing credential    (Practice Std 4.1 Worker screening)
 *  – Documentation risk    (Practice Std 1.1 Person-centred supports)
 *  – Inactive              (Practice Std 4.2 Qualifications)
 *  – Incident pattern      (Practice Std 2.2 Incident management)
 *  – Onboarding incomplete (Practice Std 4.2)
 *  – Overall at-risk       (Practice Std 3.1 Quality management)
 */
import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  BadgeCheck, FileText, Clock, AlertTriangle,
  ClipboardList, ShieldAlert, ArrowRight, Users, ChevronDown, ChevronUp,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getCoordinatorCredentialAlerts,
  type CredentialAlert,
} from "@/services/coordinatorService";
import type { CoordinatorDashboard } from "@/services/dashboardService";

// ── Token aliases ─────────────────────────────────────────────────────────────
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

// ── NDIS compliance categories ────────────────────────────────────────────────
const CATEGORIES = [
  {
    id: "credential",
    label: "Missing credential",
    icon: BadgeCheck,
    color: "#DC2626",
    bg: "rgba(220,38,38,0.08)",
    ndis: "Std 4.1",
    match: (reason?: string) =>
      /credential|first aid|cpr|wwcc|screen|police|cert/i.test(reason ?? ""),
  },
  {
    id: "documentation",
    label: "Documentation risk",
    icon: FileText,
    color: "#D97706",
    bg: "rgba(217,119,6,0.08)",
    ndis: "Std 1.1",
    match: (reason?: string) =>
      /note|documentation|compliance|session|report|record/i.test(reason ?? ""),
  },
  {
    id: "inactive",
    label: "Inactive",
    icon: Clock,
    color: "#0369A1",
    bg: "rgba(3,105,161,0.08)",
    ndis: "Std 4.2",
    match: (reason?: string) =>
      /inactive|shift|activity|available|logg/i.test(reason ?? ""),
  },
  {
    id: "incident",
    label: "Incident pattern",
    icon: AlertTriangle,
    color: "#EA580C",
    bg: "rgba(234,88,12,0.08)",
    ndis: "Std 2.2",
    match: (reason?: string) =>
      /incident|report|flag|complaint/i.test(reason ?? ""),
  },
  {
    id: "onboarding",
    label: "Onboarding incomplete",
    icon: ClipboardList,
    color: "#7C3AED",
    bg: "rgba(124,58,237,0.08)",
    ndis: "Std 4.2",
    match: (reason?: string) =>
      /onboard|profile|setup|incomplete|missing info/i.test(reason ?? ""),
  },
  {
    id: "at_risk",
    label: "Overall at-risk",
    icon: ShieldAlert,
    color: "#B45309",
    bg: "rgba(180,83,9,0.08)",
    ndis: "Std 3.1",
    match: (_reason?: string, score?: number | null) =>
      score != null && score < 60,
  },
] as const;
type CategoryId = (typeof CATEGORIES)[number]["id"];

// ── Worker row shape ──────────────────────────────────────────────────────────
interface WorkerRow {
  id: string;
  full_name: string;
  compliance_score?: number | null;
  reason?: string;
  categories: CategoryId[];
  /** workers from credential alerts may have extra detail */
  credentialDetail?: string;
}

function scoreColor(score?: number | null) {
  if (score == null) return MUTED;
  if (score >= 85) return "#16A34A";
  if (score >= 60) return "#D97706";
  return "#DC2626";
}
function scoreBg(score?: number | null) {
  if (score == null) return SOFT;
  if (score >= 85) return "rgba(22,163,74,0.08)";
  if (score >= 60) return "rgba(217,119,6,0.08)";
  return "rgba(220,38,38,0.08)";
}
function initials(name: string) {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// ── Main component ─────────────────────────────────────────────────────────────
interface StaffCompliancePanelProps {
  data: CoordinatorDashboard;
}

export function StaffCompliancePanel({ data }: StaffCompliancePanelProps) {
  const [activeFilters, setActiveFilters] = useState<Set<CategoryId>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const { data: credentialData } = useOrgQuery(["coordinator-credential-alerts"], {
    queryFn: getCoordinatorCredentialAlerts,
    staleTime: 5 * 60_000,
  });

  // ── Merge workers_needing_attention + credential alerts into one list ───────
  const rows = useMemo<WorkerRow[]>(() => {
    const map = new Map<string, WorkerRow>();

    // 1. Seed from workers_needing_attention
    for (const w of data.workers_needing_attention ?? []) {
      const cats = CATEGORIES.filter((c) =>
        c.match(w.reason, w.compliance_score),
      ).map((c) => c.id as CategoryId);
      // Always add at_risk if score < 60 even if not in reason text
      if (w.compliance_score != null && w.compliance_score < 60 && !cats.includes("at_risk")) {
        cats.push("at_risk");
      }
      map.set(w.id, {
        id: w.id,
        full_name: w.full_name,
        compliance_score: w.compliance_score,
        reason: w.reason,
        categories: cats.length > 0 ? cats : ["at_risk"],
      });
    }

    // 2. Merge in credential alerts (add workers not already in map)
    const alerts: CredentialAlert[] =
      credentialData?.alerts ?? (data.credential_alerts as CredentialAlert[]) ?? [];
    for (const a of alerts) {
      const key = a.user_id ?? a.full_name ?? "";
      if (!key) continue;
      const existing = map.get(key);
      const daysLeft = a.expiry_date
        ? Math.ceil((new Date(a.expiry_date).getTime() - Date.now()) / 86_400_000)
        : null;
      const credDetail = daysLeft != null && daysLeft <= 0
        ? `${a.credential_type || a.title || "Credential"} expired`
        : `${a.credential_type || a.title || "Credential"} expires in ${daysLeft}d`;
      if (existing) {
        if (!existing.categories.includes("credential")) {
          existing.categories.unshift("credential");
        }
        existing.credentialDetail = credDetail;
      } else {
        map.set(key, {
          id: key,
          full_name: a.full_name || "Team member",
          compliance_score: null,
          categories: ["credential"],
          credentialDetail: credDetail,
        });
      }
    }

    // 3. Sort: critical (score < 60 or credential expired) first, then amber, then rest
    return Array.from(map.values()).sort((a, b) => {
      const rankA =
        (a.compliance_score != null && a.compliance_score < 60) || a.categories.includes("credential")
          ? 0
          : a.compliance_score != null && a.compliance_score < 85
            ? 1
            : 2;
      const rankB =
        (b.compliance_score != null && b.compliance_score < 60) || b.categories.includes("credential")
          ? 0
          : b.compliance_score != null && b.compliance_score < 85
            ? 1
            : 2;
      return rankA - rankB;
    });
  }, [data, credentialData]);

  // ── Filter workers by active chips ────────────────────────────────────────
  const filtered = useMemo(() => {
    if (activeFilters.size === 0) return rows;
    return rows.filter((w) =>
      w.categories.some((c) => activeFilters.has(c)),
    );
  }, [rows, activeFilters]);

  const visible = showAll ? filtered : filtered.slice(0, 6);
  const atRisk  = rows.filter((w) =>
    (w.compliance_score != null && w.compliance_score < 85) || w.categories.includes("credential"),
  ).length;

  function toggleFilter(id: CategoryId) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <section
      className="rounded-xl border bg-white overflow-hidden"
      style={{ borderColor: BORDER }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b"
        style={{ borderColor: BORDER }}
      >
        <div className="flex items-center gap-2.5">
          <Users size={15} style={{ color: MUTED }} />
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
            Staff compliance
          </h2>
          {atRisk > 0 && (
            <span
              className="text-[11px] font-black px-2.5 py-0.5 rounded-full"
              style={{ background: "rgba(217,119,6,0.1)", color: "#D97706" }}
            >
              {atRisk} at risk
            </span>
          )}
        </div>
        <Link href="/team">
          <span className="text-[12px] font-black hover:opacity-75 transition flex items-center gap-1" style={{ color: "var(--cc-plum)" }}>
            Full team <ArrowRight size={11} />
          </span>
        </Link>
      </div>

      {/* Filter chips — NDIS compliance categories */}
      <div
        className="flex flex-wrap gap-1.5 px-5 py-3 border-b overflow-x-auto"
        style={{ borderColor: BORDER, background: SOFT }}
      >
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const active = activeFilters.has(cat.id as CategoryId);
          const count = rows.filter((w) => w.categories.includes(cat.id as CategoryId)).length;
          if (count === 0) return null;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => toggleFilter(cat.id as CategoryId)}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors whitespace-nowrap"
              style={
                active
                  ? { background: cat.bg, borderColor: cat.color, color: cat.color }
                  : { background: "white", borderColor: BORDER, color: MUTED }
              }
              title={`NDIS ${cat.ndis}`}
            >
              <Icon size={10} />
              {cat.label}
              <span
                className="text-[10px] font-black min-w-[16px] h-[16px] flex items-center justify-center rounded-full"
                style={{ background: active ? cat.color : "var(--cc-border)", color: active ? "white" : MUTED }}
              >
                {count}
              </span>
            </button>
          );
        })}
        {activeFilters.size > 0 && (
          <button
            type="button"
            onClick={() => setActiveFilters(new Set())}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors"
            style={{ background: "white", borderColor: BORDER, color: MUTED }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Worker rows */}
      {visible.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm font-bold" style={{ color: MUTED }}>
            No workers match the selected filters
          </p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {visible.map((w) => (
            <Link key={w.id} href="/team">
              <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--cc-soft)] transition-colors cursor-pointer">
                {/* Avatar */}
                <div
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-black text-white"
                  style={{ background: "var(--cc-text)" }}
                >
                  {initials(w.full_name)}
                </div>

                {/* Name + issue labels */}
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold truncate" style={{ color: TEXT }}>
                    {w.full_name}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {w.credentialDetail && (
                      <span className="text-[10px] font-semibold" style={{ color: "#DC2626" }}>
                        {w.credentialDetail}
                      </span>
                    )}
                    {!w.credentialDetail && w.reason && (
                      <span className="text-[10px]" style={{ color: MUTED }}>
                        {w.reason}
                      </span>
                    )}
                  </div>
                  {/* NDIS category chips */}
                  <div className="flex flex-wrap gap-1 mt-1">
                    {w.categories.slice(0, 3).map((catId) => {
                      const cat = CATEGORIES.find((c) => c.id === catId);
                      if (!cat) return null;
                      return (
                        <span
                          key={catId}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: cat.bg, color: cat.color }}
                        >
                          {cat.label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Compliance score */}
                <div className="shrink-0 text-right">
                  {w.compliance_score != null ? (
                    <span
                      className="text-[13px] font-black px-2.5 py-1 rounded-lg"
                      style={{
                        background: scoreBg(w.compliance_score),
                        color: scoreColor(w.compliance_score),
                      }}
                    >
                      {w.compliance_score}%
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold" style={{ color: MUTED }}>
                      No score
                    </span>
                  )}
                  <ArrowRight size={11} className="mt-1 ml-auto" style={{ color: MUTED }} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Show more / less */}
      {filtered.length > 6 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-3 text-[12px] font-black border-t transition hover:bg-[var(--cc-soft)]"
          style={{ borderColor: BORDER, color: "var(--cc-plum)" }}
        >
          {showAll ? (
            <><ChevronUp size={13} /> Show fewer</>
          ) : (
            <><ChevronDown size={13} /> Show all {filtered.length} workers</>
          )}
        </button>
      )}
    </section>
  );
}

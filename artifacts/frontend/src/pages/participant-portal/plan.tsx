import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, Target } from "lucide-react";
import { ParticipantPortalShell } from "@/components/participant-portal/ParticipantPortalShell";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { getPortalPlan, type PortalPlan } from "@/services/participantPortalService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

const MANAGEMENT_LABELS: Record<string, string> = {
  "NDIA-managed": "NDIA-managed",
  "plan-managed": "Plan-managed",
  "self-managed": "Self-managed",
  ndia_managed: "NDIA-managed",
  plan_managed: "Plan-managed",
  self_managed: "Self-managed",
};

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

function formatDate(value?: string | null) {
  if (!value) return "N/A";
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** "daily_living" → "Daily living". */
function humanise(value: string) {
  const text = value.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[13px] font-bold" style={{ color: MUTED }}>{label}</p>
      <p className="mt-0.5 text-[16px] font-black" style={{ color: TEXT }}>{value}</p>
    </div>
  );
}

/** The participant's current NDIS plan: dates, funding, budgets by category, goals. */
export default function ParticipantPlanPage() {
  const { participantId } = useViewingParticipant();
  const [data, setData] = useState<PortalPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!participantId) return;
    let cancelled = false;
    setData(null);
    setLoadError(null);
    getPortalPlan(participantId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the NDIS plan."); });
    return () => { cancelled = true; };
  }, [participantId]);

  const plan = data?.plan;

  return (
    <ParticipantPortalShell>
      <div className="space-y-6">
        <Link href="/participant-portal/documents" className="inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color: PLUM }}>
          <ArrowLeft size={14} /> Documents
        </Link>
        <div>
          <h1 className="text-2xl font-black" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>NDIS Plan</h1>
          <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Your current plan, funding and goals.</p>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 rounded-2xl border p-4" style={{ borderColor: AMBER, background: AMBER_SOFT }}>
            <AlertTriangle size={15} style={{ color: AMBER }} className="shrink-0" />
            <p className="text-[13px] font-bold" style={{ color: AMBER }}>{loadError}</p>
          </div>
        )}

        {!data && !loadError && <div className="h-40 animate-pulse rounded-2xl" style={{ background: SOFT }} />}

        {data && !plan && (
          <p className="rounded-2xl p-6 text-center text-[13px]" style={{ background: SOFT, color: MUTED }}>
            No NDIS plan is on file yet. Your provider will add it.
          </p>
        )}

        {plan && (
          <>
            <div
              className="grid divide-y divide-[var(--cc-border)] rounded-2xl border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4"
              style={{ borderColor: BORDER, background: SURFACE }}
            >
              <Stat label="Plan dates" value={`${formatDate(plan.plan_start)} to ${formatDate(plan.plan_end)}`} />
              <Stat label="Status" value={humanise(plan.status)} />
              <Stat label="Managed by" value={MANAGEMENT_LABELS[plan.plan_management_type ?? ""] ?? "N/A"} />
              <Stat label="Total funding" value={money.format(plan.total_funding)} />
            </div>

            {plan.budgets.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-[16px] font-black" style={{ color: TEXT }}>Budget by category</h2>
                <ul className="space-y-3">
                  {plan.budgets.map((b) => {
                    const pct = b.allocated > 0 ? Math.min(100, Math.round((b.used / b.allocated) * 100)) : 0;
                    return (
                      <li key={b.category} className="rounded-2xl border p-4" style={{ borderColor: BORDER, background: SURFACE }}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-[14px] font-bold" style={{ color: TEXT }}>{b.category}</p>
                          <p className="text-[13px]" style={{ color: MUTED }}>
                            <strong style={{ color: TEXT }}>{money.format(b.remaining)}</strong> left of {money.format(b.allocated)}
                          </p>
                        </div>
                        <div
                          className="mt-2 h-2 overflow-hidden rounded-full"
                          style={{ background: SOFT }}
                          role="progressbar"
                          aria-label={`${b.category} budget used`}
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: PLUM }} />
                        </div>
                        <p className="mt-1 text-[13px]" style={{ color: MUTED }}>{pct}% used ({money.format(b.used)})</p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </>
        )}

        {data && data.goals.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-[16px] font-black" style={{ color: TEXT }}>Goals</h2>
            <ul className="divide-y divide-[var(--cc-border)] rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
              {data.goals.map((g, i) => (
                <li key={`${g.name}-${i}`} className="flex gap-3 p-4 sm:px-5">
                  <Target size={18} className="mt-0.5 shrink-0" style={{ color: MUTED }} />
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold" style={{ color: TEXT }}>{g.name}</p>
                    {g.description && <p className="mt-0.5 text-[14px]" style={{ color: MUTED }}>{g.description}</p>}
                    <p className="mt-1 text-[13px]" style={{ color: MUTED }}>
                      {[g.goal_area ? humanise(g.goal_area) : null, g.target_date ? `Target ${formatDate(g.target_date)}` : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ParticipantPortalShell>
  );
}

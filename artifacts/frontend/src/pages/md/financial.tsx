import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { DollarSign, AlertTriangle, ArrowLeft, TrendingUp, FileText, PieChart } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const CYAN = "#0EA5E9";

interface BillingReport {
  total_billed_cents: number;
  total_paid_cents: number;
  total_outstanding_cents: number;
  invoice_count: number;
  monthly: Array<{ month: string; billed: number; paid: number; outstanding: number; count: number }>;
  session_count?: number | null;
  total_session_costs_cents?: number | null;
  cost_per_session_cents?: number | null;
  gross_margin_pct?: number | null;
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  color?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-xl border bg-white p-4 shadow-sm"
      style={{ borderColor: highlight ? color ?? PLUM : BORDER }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: SOFT, color: color ?? PLUM }}>
          <Icon size={14} strokeWidth={2.5} />
        </div>
      </div>
      <p className="text-2xl font-black leading-none" style={{ color: color ?? TEXT }}>{value}</p>
      {sub && <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>{sub}</p>}
    </div>
  );
}

function MonthBar({ label, revenue, max }: { label: string; revenue: number; max: number }) {
  const pct = max > 0 ? Math.round((revenue / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold" style={{ color: TEXT }}>{label}</span>
        <span className="text-[11px] font-black" style={{ color: PLUM }}>
          ${revenue.toLocaleString("en-AU", { maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="h-2 rounded-full" style={{ background: BORDER }}>
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: "var(--cc-text)" }} />
      </div>
    </div>
  );
}

export default function MDFinancialPage() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();
  const [rev, setRev] = useState<BillingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/billing/revenue-report")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => { if (!cancelled) setRev(r); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const centsToAud = (cents: number) => (cents ?? 0) / 100;

  const totalRev = centsToAud(rev?.total_billed_cents ?? 0);
  const totalPaid = centsToAud(rev?.total_paid_cents ?? 0);
  const totalOutstanding = centsToAud(rev?.total_outstanding_cents ?? 0);
  const totalInvoices = rev?.invoice_count ?? 0;

  const costPerSession = rev?.cost_per_session_cents != null && rev.cost_per_session_cents > 0
    ? centsToAud(rev.cost_per_session_cents)
    : null;
  const grossMarginPct: number | null = rev?.gross_margin_pct ?? null;
  const totalSessionCosts = rev?.total_session_costs_cents != null && rev.total_session_costs_cents > 0
    ? centsToAud(rev.total_session_costs_cents)
    : null;
  const hasCostData = costPerSession !== null || grossMarginPct !== null;

  const target = Math.max(totalRev * 1.05, 1000);
  const targetPct = totalRev > 0 ? Math.round((totalRev / target) * 100) : 0;

  const monthly = (rev?.monthly ?? []).map((m) => ({
    month: m.month,
    revenue: centsToAud(m.billed),
    invoice_count: m.count,
  }));
  const maxMonthRev = monthly.reduce((m, b) => Math.max(m, b.revenue), 0);

  const fmt = (n: number) =>
    n >= 1000
      ? `$${(n / 1000).toFixed(1)}K`
      : `$${n.toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;

  return (
    <HubLayout>
      <div className="space-y-6 pb-10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-white"
            style={{ color: MUTED, background: SOFT }}
          >
            <ArrowLeft size={13} strokeWidth={2.5} /> {translate("md.backToHub")}
          </button>
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>{translate("md.financial.title")}</h1>
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>Revenue, margins and billing performance</p>
          </div>
          <div className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: SOFT, color: CYAN }}>
            <DollarSign size={16} strokeWidth={2.5} />
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-2xl" style={{ background: SOFT }} />)}
          </div>
        ) : error || !rev ? (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER }}>
            <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: "#F97316" }} />
            <p className="font-black" style={{ color: TEXT }}>{translate("md.financial.loadFailed")}</p>
          </div>
        ) : (
          <>
            <section>
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Revenue Summary</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label={translate("md.financial.totalBilled")} value={fmt(totalRev)} sub={translate("md.financial.sub.allInvoices")} icon={DollarSign} color={CYAN} />
                <MetricCard label={translate("md.financial.totalPaid")} value={fmt(totalPaid)} sub={translate("md.financial.sub.collected")} icon={TrendingUp} color="#10B981" />
                <MetricCard label={translate("md.financial.outstanding")} value={fmt(totalOutstanding)} sub={translate("md.financial.sub.awaitingPayment")} icon={FileText} color="#F59E0B" />
                <MetricCard label={translate("md.financial.totalInvoices")} value={String(totalInvoices)} sub={translate("md.financial.sub.invoicesRaised")} icon={FileText} color={PLUM} />
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Performance vs Target</h2>
                  <p className="mt-0.5 text-[11px] font-medium" style={{ color: MUTED }}>Revenue against estimated 5% growth target</p>
                </div>
                <span
                  className="rounded-full px-3 py-1 text-[12px] font-black"
                  style={{
                    background: targetPct >= 90 ? "#D1FAE5" : targetPct >= 75 ? "#FEF3C7" : "#FEE2E2",
                    color: targetPct >= 90 ? "#065F46" : targetPct >= 75 ? "#92400E" : "#991B1B",
                  }}
                >
                  {targetPct}% of target
                </span>
              </div>
              <div className="h-3 rounded-full" style={{ background: BORDER }}>
                <div
                  className="h-3 rounded-full transition-all"
                  style={{
                    width: `${Math.min(targetPct, 100)}%`,
                    background: targetPct >= 90 ? "#10B981" : targetPct >= 75 ? "#F59E0B" : "#EF4444",
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[10px] font-medium" style={{ color: MUTED }}>
                <span>$0</span>
                <span>Target: {fmt(target)}</span>
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <h2 className="mb-4 text-[14px] font-black" style={{ color: TEXT }}>Cost & Margin Analysis</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl p-4" style={{ background: SOFT }}>
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] mb-2" style={{ color: MUTED }}>Cost per Session</p>
                  <p className="text-2xl font-black" style={{ color: TEXT }}>
                    {costPerSession !== null ? fmt(costPerSession) : "N/A"}
                  </p>
                  <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>
                    {costPerSession !== null ? `Avg across ${rev?.session_count ?? 0} sessions` : "No session cost data yet"}
                  </p>
                </div>
                <div className="rounded-xl p-4" style={{ background: SOFT }}>
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] mb-2" style={{ color: MUTED }}>
                    {grossMarginPct !== null ? "Gross Margin" : "Est. Gross Margin"}
                  </p>
                  <p className="text-2xl font-black" style={{ color: grossMarginPct !== null ? (grossMarginPct >= 0 ? "#10B981" : "#EF4444") : MUTED }}>
                    {grossMarginPct !== null ? `${grossMarginPct}%` : "N/A"}
                  </p>
                  <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>
                    {grossMarginPct !== null ? "Revenue minus session costs" : "No billing data yet"}
                  </p>
                </div>
                <div className="rounded-xl p-4" style={{ background: SOFT }}>
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] mb-2" style={{ color: MUTED }}>Total Session Costs</p>
                  <p className="text-2xl font-black" style={{ color: totalSessionCosts !== null ? TEXT : MUTED }}>
                    {totalSessionCosts !== null ? fmt(totalSessionCosts) : "N/A"}
                  </p>
                  <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>
                    {totalSessionCosts !== null ? "From NDIS budget usage records" : "No cost records yet"}
                  </p>
                </div>
              </div>
              {!hasCostData && (
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                  <p className="text-[11px] font-medium text-blue-700">
                    Margin figures will appear once sessions with recorded costs exist. Save sessions with AI to capture cost data.
                  </p>
                </div>
              )}
            </section>

            {monthly.length > 0 && (
              <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
                <h2 className="mb-4 text-[14px] font-black" style={{ color: TEXT }}>{translate("md.financial.monthlyRevenue")} Breakdown</h2>
                <div className="space-y-3">
                  {monthly.slice(-6).map((m) => (
                    <MonthBar key={m.month} label={m.month} revenue={m.revenue} max={maxMonthRev} />
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <h2 className="mb-2 text-[14px] font-black" style={{ color: TEXT }}>Revenue by Support Category</h2>
              <div className="flex items-center gap-3 rounded-xl p-4" style={{ background: SOFT }}>
                <PieChart size={24} style={{ color: MUTED }} />
                <div>
                  <p className="text-[13px] font-black" style={{ color: TEXT }}>Category breakdown unavailable</p>
                  <p className="mt-0.5 text-[11px] font-medium" style={{ color: MUTED }}>
                    Connect invoice support-category tagging to see breakdown by Core / Capacity Building / Capital.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </HubLayout>
  );
}

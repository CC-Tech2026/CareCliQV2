import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  Loader2,
  Pencil,
  Send,
  Table as TableIcon,
  Wallet,
} from "lucide-react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch } from "@/lib/api-fetch";
import { loadErrorFrom, loadErrorHint } from "@/lib/load-error";
import { HubLayout } from "@/components/layout/HubLayout";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Field, PanelFooter, PanelHeader, PrimaryButton, SecondaryButton, inputClass } from "@/pages/md/vault/components/PanelKit";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { formatAppDate } from "@/lib/datetime";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { LoadError, PageHeader, StatusText, SummaryStrip, ctaClass, outlineClass, type Tone } from "@/components/layout/PageKit";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

const RED = "#B3261E";


type Period = "month" | "quarter" | "year";

interface MonthFigures {
  month: string;
  billed_cents: number;
  collected_cents: number;
  wages_cents: number | null;
  overheads_cents: number | null;
  net_cents: number | null;
  current: boolean;
  future: boolean;
}

interface FinancialSummary {
  period: Period;
  period_label: string;
  invoice_count: number;
  billed_cents: number;
  collected_cents: number;
  outstanding_cents: number;
  overdue_cents: number;
  session_count: number;
  costed_session_count: number;
  labour_cost_cents: number | null;
  cost_per_session_cents: number | null;
  revenue_by_month: MonthFigures[];
  recent_invoices: Array<{ id: string; invoice_number: string; name: string; total_cents: number; status: string }>;
  profit_and_loss?: {
    revenue_cents: number;
    wages_cents: number | null;
    overheads_cents: number | null;
    net_profit_cents: number | null;
    margin_pct: number | null;
    wages_complete: boolean;
    overheads_set: boolean;
  };
  cash?: {
    on_hand_cents: number | null;
    as_of: string | null;
    basis_months: string[];
    avg_monthly_net_cents: number | null;
    avg_monthly_costs_cents: number | null;
    runway_months: number | null;
    covers_months: number | null;
    cash_positive: boolean;
  };
  settings?: {
    cash_on_hand_cents: number | null;
    cash_as_of: string | null;
    monthly_overheads_cents: number | null;
    updated_at: string | null;
  };
}

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

// Chart series — checked for colour-blind separation in light and dark.
const SERIES = {
  revenue: { label: "Revenue", color: "#E8457A" },
  costs: { label: "Costs", color: "#5B6CD9" },
  net: { label: "Net profit", color: "#1A9E77" },
} as const;
type SeriesKey = keyof typeof SERIES;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (key: string) => MONTH_ABBR[Number(key.slice(5, 7)) - 1] ?? key;
const monthLong = (key: string) => `${MONTH_LONG[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`;

const money = (cents: number, compact = false) =>
  compact && Math.abs(cents) >= 100_000
    ? `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100_000).toFixed(Math.abs(cents) >= 1_000_000 ? 0 : 1)}k`
    : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: compact ? 0 : 2 }).format(cents / 100);
const months = (n: number) => `${n.toLocaleString("en-AU", { maximumFractionDigits: 1 })} month${n === 1 ? "" : "s"}`;

const INVOICE_TONE: Record<string, Tone> = { draft: "neutral", outstanding: "warning", overdue: "danger", paid: "good" };

const INVOICE_STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  draft: { label: "Draft", fg: "var(--cc-muted)", bg: "var(--cc-soft)" },
  outstanding: { label: "Outstanding", fg: "var(--cc-status-warning)", bg: "var(--cc-status-warning-bg)" },
  overdue: { label: "Overdue", fg: "var(--cc-status-danger)", bg: "var(--cc-status-danger-bg)" },
  paid: { label: "Paid", fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" },
};

// Claims and the invoice register live in Billing & claims; this page is
// the overview and links there rather than repeating them.
const BILLING_CLAIMS = "/billing?workspace=claims";
const BILLING_INVOICES = "/billing?workspace=invoices";

function Card({ children, className = "", label }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <section className={`rounded-2xl bg-cc-surface p-5 ${className}`} aria-label={label}>
      {children}
    </section>
  );
}

/* ── Chart ─────────────────────────────────────────────────────────────── */

type ChartPoint = { key: string; label: string; revenue: number; costs: number | null; net: number | null; current: boolean; future: boolean };

function toChart(data: FinancialSummary): ChartPoint[] {
  return data.revenue_by_month.map((m) => {
    const hasCosts = m.wages_cents != null || m.overheads_cents != null;
    return {
      key: m.month,
      label: monthLabel(m.month),
      revenue: m.billed_cents / 100,
      costs: hasCosts ? ((m.wages_cents ?? 0) + (m.overheads_cents ?? 0)) / 100 : null,
      net: m.net_cents == null ? null : m.net_cents / 100,
      current: m.current,
      future: !!m.future,
    };
  });
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const row = (key: SeriesKey, value: number | null) => (
    <div className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-1.5" style={{ color: MUTED }}>
        <span className="h-2 w-2 rounded-sm" style={{ background: SERIES[key].color }} />
        {SERIES[key].label}
      </span>
      <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{value == null ? "—" : money(Math.round(value * 100))}</span>
    </div>
  );
  return (
    <div className="min-w-[180px] space-y-1 rounded-xl border bg-cc-surface p-3 text-[12px] shadow-lg" style={{ borderColor: BORDER }}>
      <p className="mb-1 font-bold" style={{ color: TEXT }}>{monthLong(p.key)}</p>
      {row("revenue", p.revenue)}
      {row("costs", p.costs)}
      {row("net", p.net)}
      <p className="pt-1 text-[11px]" style={{ color: MUTED }}>{p.future ? "Not reached yet" : "Click for the breakdown"}</p>
    </div>
  );
}

function PerformanceChart({
  data,
  selected,
  onSelect,
}: {
  data: FinancialSummary;
  selected: string | null;
  onSelect: (month: string) => void;
}) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [asTable, setAsTable] = useState(false);
  const points = toChart(data);
  const anyCosts = points.some((p) => p.costs != null);
  const toggle = (key: SeriesKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card label="Revenue, costs and profit" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>Revenue, costs and profit</h2>
          <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
            {anyCosts ? "By month. Click a month to see its breakdown." : "Costs appear once pay has been calculated or overheads are set."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(SERIES) as SeriesKey[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={!hidden.has(key)}
              onClick={() => toggle(key)}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-opacity"
              style={{ borderColor: BORDER, color: TEXT, opacity: hidden.has(key) ? 0.45 : 1 }}
              title={hidden.has(key) ? `Show ${SERIES[key].label}` : `Hide ${SERIES[key].label}`}
            >
              <span className={key === "net" ? "h-0.5 w-3 rounded" : "h-2.5 w-2.5 rounded-sm"} style={{ background: SERIES[key].color }} />
              {SERIES[key].label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold"
            style={{ borderColor: BORDER, color: MUTED }}
            aria-pressed={asTable}
          >
            {asTable ? <BarChart3 size={12} /> : <TableIcon size={12} />} {asTable ? "Chart" : "Table"}
          </button>
        </div>
      </div>

      {asTable ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-[12px]">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: BORDER, color: MUTED }}>
                <th className="py-2 font-semibold">Month</th>
                <th className="py-2 text-right font-semibold">Revenue</th>
                <th className="py-2 text-right font-semibold">Collected</th>
                <th className="py-2 text-right font-semibold">Costs</th>
                <th className="py-2 text-right font-semibold">Net profit</th>
              </tr>
            </thead>
            <tbody>
              {data.revenue_by_month.map((m) => {
                const costs = m.wages_cents == null && m.overheads_cents == null ? null : (m.wages_cents ?? 0) + (m.overheads_cents ?? 0);
                return (
                  <tr key={m.month} className="border-b last:border-b-0" style={{ borderColor: BORDER, color: TEXT }}>
                    <td className="py-2 font-medium">{monthLong(m.month)}</td>
                    <td className="py-2 text-right tabular-nums">{money(m.billed_cents)}</td>
                    <td className="py-2 text-right tabular-nums">{money(m.collected_cents)}</td>
                    <td className="py-2 text-right tabular-nums">{costs == null ? "—" : money(costs)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums" style={{ color: m.net_cents != null && m.net_cents < 0 ? "var(--cc-status-danger)" : TEXT }}>
                      {m.net_cents == null ? "—" : money(m.net_cents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 h-64" role="img" aria-label={`Revenue by month: ${points.map((p) => `${p.label} ${money(Math.round(p.revenue * 100))}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 8, right: 4, bottom: 0, left: 0 }}
              barGap={2}
              onClick={(e: { activePayload?: Array<{ payload: ChartPoint }> } | null) => {
                const p = e?.activePayload?.[0]?.payload;
                if (p && !p.future) onSelect(p.key);
              }}
            >
              <CartesianGrid vertical={false} stroke={BORDER} strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
              <YAxis
                width={48}
                tick={{ fontSize: 10, fill: MUTED }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => money(Math.round(v * 100), true)}
              />
              <ReferenceLine y={0} stroke={MUTED} strokeOpacity={0.5} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--cc-soft)", opacity: 0.6 }} />
              {!hidden.has("revenue") && (
                <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer">
                  {points.map((p) => (
                    <Cell
                      key={p.key}
                      fill={SERIES.revenue.color}
                      fillOpacity={selected && selected !== p.key ? 0.35 : p.future ? 0.25 : 1}
                    />
                  ))}
                </Bar>
              )}
              {!hidden.has("costs") && (
                <Bar dataKey="costs" name="Costs" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer">
                  {points.map((p) => (
                    <Cell key={p.key} fill={SERIES.costs.color} fillOpacity={selected && selected !== p.key ? 0.35 : 1} />
                  ))}
                </Bar>
              )}
              {!hidden.has("net") && (
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net profit"
                  stroke={SERIES.net.color}
                  strokeWidth={2}
                  dot={{ r: 4, fill: SERIES.net.color, stroke: "var(--cc-surface)", strokeWidth: 2 }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/* ── Month breakdown, P&L, cash ───────────────────────────────────────── */

function Line2({ label, value, strong, negative, hint }: { label: string; value: string; strong?: boolean; negative?: boolean; hint?: React.ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "border-t pt-3" : ""}`} style={{ borderColor: BORDER }}>
      <span className={strong ? "text-[13px] font-bold" : "text-[13px]"} style={{ color: strong ? TEXT : MUTED }}>
        {label}
        {hint && <span className="block text-[11px] font-normal" style={{ color: MUTED }}>{hint}</span>}
      </span>
      <span
        className={`shrink-0 whitespace-nowrap tabular-nums ${strong ? "text-[16px] font-extrabold" : "text-[13px] font-semibold"}`}
        style={{ color: negative ? "var(--cc-status-danger)" : TEXT }}
      >
        {value}
      </span>
    </div>
  );
}

function ProfitAndLoss({ data, month, onClearMonth, onEdit }: { data: FinancialSummary; month: MonthFigures | null; onClearMonth: () => void; onEdit: () => void }) {
  const pl = data.profit_and_loss;
  const revenue = month ? month.billed_cents : pl?.revenue_cents ?? data.billed_cents;
  const wages = month ? month.wages_cents : pl?.wages_cents ?? null;
  const overheads = month ? month.overheads_cents : pl?.overheads_cents ?? null;
  const net = month ? month.net_cents : pl?.net_profit_cents ?? null;
  const margin = net != null && revenue > 0 ? Math.round((net / revenue) * 1000) / 10 : null;

  return (
    <Card label="Profit and loss">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>Profit &amp; loss</h2>
          <p className="text-[12px]" style={{ color: MUTED }}>{month ? monthLong(month.month) : data.period_label}</p>
        </div>
        {month && (
          <button type="button" onClick={onClearMonth} className={outlineClass}>
            Back to {data.period_label}
          </button>
        )}
      </div>
      <div className="mt-3">
        <Line2 label="Revenue" value={money(revenue)} hint={month ? `${money(month.collected_cents)} collected` : `${money(data.collected_cents)} collected`} />
        <Line2
          label="Wages"
          value={wages == null ? "—" : `−${money(wages)}`}
          hint={
            wages == null
              ? "No pay calculated yet"
              : !month && pl && !pl.wages_complete
                ? `${data.costed_session_count.toLocaleString("en-AU")} of ${data.session_count.toLocaleString("en-AU")} shifts costed`
                : undefined
          }
        />
        <Line2
          label="Overheads"
          value={overheads == null ? "—" : `−${money(overheads)}`}
          hint={
            overheads == null ? (
              <button type="button" onClick={onEdit} className="font-semibold underline" style={{ color: PLUM }}>Add monthly overheads</button>
            ) : (
              "Rent, insurance, software and other running costs"
            )
          }
        />
        <Line2
          label="Net profit"
          value={net == null ? "—" : money(net)}
          negative={net != null && net < 0}
          strong
          hint={margin != null ? `${margin}% margin` : undefined}
        />
      </div>
      {!month && data.cost_per_session_cents != null && (
        <p className="mt-2 rounded-xl p-3 text-[12px]" style={{ background: SOFT, color: MUTED }}>
          {data.session_count.toLocaleString("en-AU")} sessions · <span className="font-semibold" style={{ color: TEXT }}>{money(data.cost_per_session_cents)}</span> wages per session
        </p>
      )}
    </Card>
  );
}

function CashPosition({ data, onEdit }: { data: FinancialSummary; onEdit: () => void }) {
  const cash = data.cash;
  const onHand = cash?.on_hand_cents ?? null;
  const covers = cash?.covers_months ?? null;
  const pct = covers == null ? 0 : Math.min(100, (covers / 12) * 100);
  // Red only when the business is losing money and reserves are thin.
  const tone =
    covers == null
      ? MUTED
      : covers >= 6
        ? "var(--cc-status-success)"
        : covers < 3 && !cash?.cash_positive
          ? "var(--cc-status-danger)"
          : "var(--cc-status-warning)";

  return (
    <Card label="Cash position">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>Cash &amp; runway</h2>
          <p className="text-[12px]" style={{ color: MUTED }}>
            {onHand == null ? "From your bank balance" : `Balance as of ${cash?.as_of ? formatAppDate(cash.as_of) : "—"}`}
          </p>
        </div>
        <button type="button" onClick={onEdit} className={outlineClass}>
          <Pencil size={14} /> {onHand == null ? "Set up" : "Update"}
        </button>
      </div>

      {onHand == null ? (
        <div className="mt-4 rounded-2xl bg-cc-soft p-4 text-sm leading-6" style={{ color: MUTED }}>
          Enter your cash balance and monthly overheads to see how many months your reserves cover.
          <button type="button" onClick={onEdit} className={`${ctaClass} mt-3`}>
            <Wallet size={15} /> Add cash balance
          </button>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[26px] font-extrabold tabular-nums" style={{ color: TEXT }}>{money(onHand)}</p>
          <div className="mt-3">
            <div className="flex items-center justify-between text-[12px]">
              <span style={{ color: MUTED }}>Covers</span>
              <span className="font-bold" style={{ color: tone }}>{covers == null ? "—" : `${months(covers)} of costs`}</span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full"
              style={{ background: SOFT }}
              role="meter"
              aria-label="Months of costs covered"
              aria-valuemin={0}
              aria-valuemax={12}
              aria-valuenow={covers ?? 0}
            >
              <div className="h-full rounded-full transition-[width]" style={{ width: `${pct}%`, background: tone }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px]" style={{ color: MUTED }}>
              <span>0</span><span>3</span><span>6</span><span>12+ months</span>
            </div>
          </div>
          <div className="mt-3 space-y-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <span style={{ color: MUTED }}>Average monthly result</span>
              <span
                className="font-semibold tabular-nums"
                style={{ color: cash?.avg_monthly_net_cents != null && cash.avg_monthly_net_cents < 0 ? "var(--cc-status-danger)" : TEXT }}
              >
                {cash?.avg_monthly_net_cents == null ? "—" : money(cash.avg_monthly_net_cents)}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span style={{ color: MUTED }}>Runway</span>
              <span className="font-semibold" style={{ color: TEXT }}>
                {cash?.runway_months != null ? months(cash.runway_months) : cash?.cash_positive ? "Cash-positive" : "—"}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[11px]" style={{ color: MUTED }}>
            {cash?.basis_months.length
              ? `Based on ${cash.basis_months.map(monthLabel).join(", ")}.`
              : "Runway appears after a full month with costs recorded."}
          </p>
        </>
      )}
    </Card>
  );
}

/* ── Settings dialog ──────────────────────────────────────────────────── */

function FinanceSettingsDialog({ open, onOpenChange, data, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; data?: FinancialSummary; onSaved: () => void }) {
  const { toast } = useToast();
  const [cash, setCash] = useState("");
  const [asOf, setAsOf] = useState("");
  const [overheads, setOverheads] = useState("");
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!open) return;
    const s = data?.settings;
    setCash(s?.cash_on_hand_cents != null ? String(s.cash_on_hand_cents / 100) : "");
    setAsOf(s?.cash_as_of ?? today);
    setOverheads(s?.monthly_overheads_cents != null ? String(s.monthly_overheads_cents / 100) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[$,\s]/g, "")));
  const cashN = num(cash);
  const overheadsN = num(overheads);
  const invalid = [cashN, overheadsN].some((n) => n != null && (!Number.isFinite(n) || n < 0));

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/billing/financial-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cash_on_hand: cashN, cash_as_of: cashN == null ? null : asOf || null, monthly_overheads: overheadsN }),
      });
      if (!res.ok) throw await loadErrorFrom(res, "Couldn't save.");
      toast({ title: "Financial settings saved" });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Not saved", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetTitle className="sr-only">Cash and overheads</SheetTitle>
        <SheetDescription className="sr-only">Add your cash balance and monthly overheads.</SheetDescription>
        <PanelHeader
          icon={Wallet}
          title="Cash and overheads"
          description="CareCliQ knows your revenue and wages. Add what's in your accounting system so net profit and runway are complete."
        />
        <form
          id="finance-settings-form"
          className="mt-6 flex-1 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
            <Field label="Cash in the bank ($)" htmlFor="finance-cash">
              <input id="finance-cash" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="e.g. 250000" className={inputClass} style={{ borderColor: BORDER, color: TEXT }} />
            </Field>
            <Field label="As of" htmlFor="finance-as-of">
              <input id="finance-as-of" type="date" value={asOf} max={today} onChange={(e) => setAsOf(e.target.value)} disabled={cashN == null} className={`${inputClass} disabled:opacity-50`} style={{ borderColor: BORDER, color: TEXT }} />
            </Field>
          </div>
          <Field
            label="Monthly overheads ($)"
            htmlFor="finance-overheads"
            hint="Costs outside payroll: rent, insurance, software, vehicles, accounting. Wages come from the pay engine."
          >
            <input id="finance-overheads" inputMode="decimal" value={overheads} onChange={(e) => setOverheads(e.target.value)} placeholder="e.g. 18000" className={inputClass} style={{ borderColor: BORDER, color: TEXT }} />
          </Field>
          {invalid && <p role="alert" className="text-sm" style={{ color: "var(--cc-danger-text)" }}>Enter amounts as numbers, e.g. 18000.</p>}
        </form>
        <PanelFooter>
          <SecondaryButton onClick={() => onOpenChange(false)} disabled={saving}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" form="finance-settings-form" busy={saving} disabled={invalid}>
            {saving ? "Saving…" : "Save"}
          </PrimaryButton>
        </PanelFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ── Recent invoices, claims shortcut ─────────────────────────────────── */

function RecentInvoices({ rows }: { rows: FinancialSummary["recent_invoices"] }) {
  return (
    <Card label="Recent invoices">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold" style={{ color: TEXT }}>Recent invoices</h2>
        <Link href={BILLING_INVOICES} className="text-sm font-medium underline-offset-4 hover:underline" style={{ color: TEXT }}>All invoices</Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm" style={{ color: MUTED }}>No invoices yet.</p>
      ) : (
        <ul className="mt-3 divide-y" style={{ borderColor: BORDER }}>
          {rows.map((inv) => {
            const tone = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.draft;
            return (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold" style={{ color: TEXT }}>{inv.invoice_number}</p>
                  <p className="truncate text-[11px]" style={{ color: MUTED }}>{inv.name}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[13px] font-bold tabular-nums" style={{ color: TEXT }}>{money(inv.total_cents)}</span>
                  <span className="w-[84px] text-right">
                    <StatusText tone={INVOICE_TONE[inv.status] ?? "neutral"}>{tone.label}</StatusText>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

type ClaimsCounts = {
  ready: Array<{ total_cents: number; problems: string[] }>;
  submitted: Array<{ total_cents: number }>;
};

function ClaimsShortcut({ onOpen }: { onOpen: () => void }) {
  const claims = useOrgQuery<ClaimsCounts>(["billing", "ndia-claims"], {
    queryFn: async () => {
      const res = await apiFetch("/api/billing/claims");
      if (!res.ok) throw await loadErrorFrom(res);
      return res.json();
    },
  });
  const ready = (claims.data?.ready ?? []).filter((r) => r.problems.length === 0);
  const needsFixing = (claims.data?.ready ?? []).length - ready.length;
  const submitted = claims.data?.submitted ?? [];
  const sum = (rows: Array<{ total_cents: number }>) => rows.reduce((s, r) => s + r.total_cents, 0);
  return (
    <Card label="NDIS claims">
      <h2 className="text-base font-semibold" style={{ color: TEXT }}>NDIS claims</h2>
      <p className="text-[12px]" style={{ color: MUTED }}>Money waiting on the NDIA</p>
      {claims.isError ? (
        <p className="mt-4 text-[12px]" style={{ color: MUTED }}>Claims couldn't be loaded.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button type="button" onClick={onOpen} className="rounded-2xl bg-cc-soft p-3.5 text-left transition hover:opacity-80">
            <p className="text-xs font-medium" style={{ color: MUTED }}>Ready to claim</p>
            <p className="mt-1 text-[18px] font-extrabold tabular-nums" style={{ color: TEXT }}>{claims.isLoading ? "…" : money(sum(ready))}</p>
            <p className="text-[11px]" style={{ color: MUTED }}>
              {ready.length} invoice{ready.length === 1 ? "" : "s"}
              {needsFixing > 0 && <span style={{ color: "var(--cc-status-danger)" }}> · {needsFixing} to fix</span>}
            </p>
          </button>
          <button type="button" onClick={onOpen} className="rounded-2xl bg-cc-soft p-3.5 text-left transition hover:opacity-80">
            <p className="text-xs font-medium" style={{ color: MUTED }}>Awaiting payment</p>
            <p className="mt-1 text-[18px] font-extrabold tabular-nums" style={{ color: TEXT }}>{claims.isLoading ? "…" : money(sum(submitted))}</p>
            <p className="text-[11px]" style={{ color: MUTED }}>{submitted.length} claim{submitted.length === 1 ? "" : "s"}</p>
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={onOpen}
        className={`${ctaClass} mt-4 w-full`}
      >
        <Send size={15} /> {ready.length ? `Claim ${ready.length} invoice${ready.length === 1 ? "" : "s"}` : "Open NDIS claims"}
      </button>
    </Card>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export default function MDFinancialPage() {
  const [, navigate] = useLocation();
  // Old links to the claims and ledger tabs that used to live here.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "claims") navigate(BILLING_CLAIMS, { replace: true });
    else if (tab === "ledger") navigate(BILLING_INVOICES, { replace: true });
  }, [navigate]);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("quarter");
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const summary = useOrgQuery<FinancialSummary>(["md", "financial-summary", period], {
    queryFn: async () => {
      const res = await apiFetch(`/api/billing/financial-summary?period=${period}`);
      if (!res.ok) throw await loadErrorFrom(res);
      return res.json();
    },
    placeholderData: (previous) => previous,
  });
  const data = summary.data;
  const pl = data?.profit_and_loss;
  const collectionRate = data && data.billed_cents > 0 ? Math.round((data.collected_cents / data.billed_cents) * 100) : null;
  const month = data?.revenue_by_month.find((m) => m.month === selectedMonth) ?? null;

  const changePeriod = (next: Period) => {
    setPeriod(next);
    setSelectedMonth(null);
  };
  const refreshFigures = () => void queryClient.invalidateQueries({ queryKey: [user?.organizationId ?? "__no_org__", "md", "financial-summary"] });

  const net = pl?.net_profit_cents ?? null;
  const cash = data?.cash;

  return (
    <HubLayout>
      <div className="space-y-8 pb-12">
        <PageHeader
          eyebrow="Finance"
          title="Financial Governance"
          description={`Revenue, profit, cash and NDIS claims${data ? ` · ${data.period_label}` : ""}`}
          actions={
            <div role="tablist" aria-label="Period" className="flex items-center rounded-full border p-1" style={{ borderColor: BORDER }}>
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    role="tab"
                    type="button"
                    aria-selected={period === p.key}
                    onClick={() => changePeriod(p.key)}
                    className="min-h-9 rounded-full px-4 text-sm font-medium transition"
                    style={period === p.key ? { background: "var(--cc-text)", color: "var(--cc-bg)" } : { color: MUTED }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
          }
        />

        {summary.isError && !data ? (
            <LoadError onRetry={() => void summary.refetch()}>
              <AlertTriangle size={16} style={{ color: RED }} />
              <span>
                <span className="font-semibold">Financial figures couldn't be loaded.</span>
                {loadErrorHint(summary.error) && <span style={{ color: MUTED }}> {loadErrorHint(summary.error)}</span>}
              </span>
            </LoadError>
          ) : !data ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" style={{ color: PLUM }} /></div>
          ) : (
            <>
              <SummaryStrip
                items={[
                  {
                    value: money(data.billed_cents),
                    label: "revenue",
                    hint: `${data.invoice_count.toLocaleString("en-AU")} invoices${collectionRate != null ? ` · ${collectionRate}% collected` : ""}`,
                    onClick: () => navigate(BILLING_INVOICES),
                  },
                  {
                    value: net == null ? "N/A" : money(net),
                    label: "net profit",
                    tone: net == null ? undefined : net < 0 ? "danger" : "good",
                    hint:
                      net == null
                        ? "Add costs to see profit"
                        : `${pl?.margin_pct ?? 0}% margin${pl && (!pl.overheads_set || !pl.wages_complete) ? " · costs incomplete" : ""}`,
                    onClick: net == null ? () => setEditing(true) : undefined,
                  },
                  {
                    value:
                      cash?.on_hand_cents == null
                        ? "Set up"
                        : cash.runway_months != null
                          ? months(cash.runway_months)
                          : cash.cash_positive
                            ? "Cash-positive"
                            : money(cash.on_hand_cents),
                    label: "cash runway",
                    tone: cash?.runway_months != null && cash.runway_months < 6 ? "danger" : cash?.cash_positive ? "good" : undefined,
                    hint:
                      cash?.on_hand_cents == null
                        ? "Add your cash balance"
                        : cash.covers_months != null
                          ? `${money(cash.on_hand_cents)} covers ${months(cash.covers_months)}`
                          : `Cash as of ${cash.as_of ? formatAppDate(cash.as_of) : "N/A"}`,
                    onClick: () => setEditing(true),
                  },
                  {
                    value: money(data.outstanding_cents),
                    label: "outstanding",
                    tone: data.overdue_cents ? "danger" : data.outstanding_cents ? "warning" : undefined,
                    hint: data.overdue_cents ? `${money(data.overdue_cents)} overdue` : "Nothing overdue",
                    onClick: () => navigate(BILLING_INVOICES),
                  },
                ]}
              />

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
                <PerformanceChart data={data} selected={selectedMonth} onSelect={(m) => setSelectedMonth((cur) => (cur === m ? null : m))} />
                <ProfitAndLoss data={data} month={month} onClearMonth={() => setSelectedMonth(null)} onEdit={() => setEditing(true)} />
              </div>

              <div className="grid gap-6 lg:grid-cols-3">
                <CashPosition data={data} onEdit={() => setEditing(true)} />
                <ClaimsShortcut onOpen={() => navigate(BILLING_CLAIMS)} />
                <RecentInvoices rows={data.recent_invoices} />
              </div>
            </>
          )}
      </div>
      <FinanceSettingsDialog open={editing} onOpenChange={setEditing} data={data} onSaved={refreshFigures} />
    </HubLayout>
  );
}

import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Loader2,
  Search,
  Eye,
  Printer,
  Download,
  CalendarDays,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { HubLayout } from "@/components/layout/HubLayout";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReAuth } from "@/hooks/useReAuth";
import { useToast } from "@/hooks/use-toast";
import { formatAppDate } from "@/lib/datetime";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { StatCard, StatCardGroup } from "@/components/ui/stat-card";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

const GREEN = "#0F7B57";
const RED = "#B3261E";
const CYAN = "#2A5C8A";


function centsToAud(cents: number | null | undefined) {
  return (cents ?? 0) / 100;
}

function formatMoney(value: number, compact = false) {
  if (compact) {
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }

    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}K`;
    }
  }

  return `$${value.toLocaleString("en-AU", {
    maximumFractionDigits: 0,
  })}`;
}


/* -------------------------------------------------------------------------- */
/* Invoice-level ledger                                                       */
/* -------------------------------------------------------------------------- */

interface Invoice {
  id: string;
  invoice_number: string;
  recipient_name: string;
  total_cents: number;
  status: string;
  payment_method: string | null;
  service_category: "aged_care" | "disability" | null;
  created_at: string;
  pdf_url: string | null;
  /** Participant's branch zone. */
  timezone?: string | null;
}

const INVOICE_STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: "Draft", bg: SOFT, color: MUTED },
  finalized: { label: "Finalized", bg: `${CYAN}1F`, color: CYAN },
  issued: { label: "Issued", bg: `${CYAN}1F`, color: CYAN },
  sent: { label: "Sent", bg: `${CYAN}1F`, color: CYAN },
  paid: { label: "Paid", bg: `${GREEN}1F`, color: GREEN },
  overdue: { label: "Overdue", bg: `${RED}1F`, color: RED },
  void: { label: "Void", bg: SOFT, color: MUTED },
  cancelled: { label: "Cancelled", bg: SOFT, color: MUTED },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer",
  credit_card: "Credit card",
  direct_debit: "Direct debit",
  ndis_portal: "NDIS portal",
  cash: "Cash",
  other: "Other",
};

type LedgerStatusFilter = "all" | "paid" | "outstanding" | "overdue" | "void";

// Shown only when recorded — never filled in with a made-up value.
function displayServiceCategory(inv: Invoice): "aged_care" | "disability" | null {
  return inv.service_category ?? null;
}

function displayPaymentMethod(inv: Invoice): string | null {
  return inv.payment_method ?? null;
}

/** Fetches the PDF as a blob and saves it locally — more reliable than a plain
 *  <a download> against a cross-origin signed URL, which browsers often just
 *  navigate to instead of downloading. */
async function downloadInvoicePdf(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

function InvoiceLedger() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<LedgerStatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const { requireReAuth, modal: reauthModal } = useReAuth();
  const { toast } = useToast();

  useEffect(() => {
    apiFetch("/api/billing/invoices")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setInvoices(Array.isArray(data) ? data : []))
      .catch(() => setInvoices([]));
  }, []);

  // pdf_url is only ever set by generating the PDF (see billing_service.py's
  // generate_invoice_pdf) — a coordinator can trigger it from billing.tsx,
  // but an MD reviewing the ledger here had no way to self-serve one before
  // that happened. This lets them generate it directly instead of asking a
  // coordinator to do it first.
  async function generatePdf(invoice: Invoice) {
    setGeneratingId(invoice.id);
    try {
      const res = await requireReAuth(() =>
        apiFetch(`/api/billing/invoices/${invoice.id}/pdf`, { method: "POST" })
      );
      if (!res) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Could not generate PDF.");
      }
      const updated = await res.json();
      setInvoices((prev) => (prev ? prev.map((i) => (i.id === updated.id ? updated : i)) : prev));
      if (updated.pdf_url) window.open(updated.pdf_url, "_blank", "noopener");
    } catch (err) {
      toast({
        title: "PDF generation failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setGeneratingId(null);
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = (invoices ?? []).filter((inv) => {
    if (q && !(inv.recipient_name.toLowerCase().includes(q) || inv.invoice_number.toLowerCase().includes(q))) return false;
    if (statusFilter === "paid" && inv.status !== "paid") return false;
    if (statusFilter === "outstanding" && !["draft", "finalized", "issued", "sent"].includes(inv.status)) return false;
    if (statusFilter === "overdue" && inv.status !== "overdue") return false;
    if (statusFilter === "void" && !["void", "cancelled"].includes(inv.status)) return false;
    const day = inv.created_at.slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    return true;
  });

  return (
    <section className="mb-5 rounded-3xl border bg-white" style={{ borderColor: BORDER }}>
      <div className="border-b px-6 py-5" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <FileText size={15} strokeWidth={2.5} style={{ color: PLUM }} />
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Monthly financial ledger</h2>
        </div>
        <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>Invoice-level billing activity, collections and outstanding balances</p>
      </div>

      <div className="flex flex-col gap-3 border-b px-6 py-4 lg:flex-row lg:items-center" style={{ borderColor: BORDER }}>
        <div className="relative min-w-0 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by participant name or invoice ID"
            className="h-9 rounded-xl pl-8 text-[12px]"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as LedgerStatusFilter)}>
          <SelectTrigger className="h-9 w-full rounded-xl text-[12px] lg:w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="outstanding">Outstanding</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="void">Void / Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[135px] rounded-xl text-[11px]" />
          <span className="text-[10px] font-bold" style={{ color: MUTED }}>to</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[135px] rounded-xl text-[11px]" />
          {(search || statusFilter !== "all" || dateFrom || dateTo) && (
            <button
              onClick={() => { setSearch(""); setStatusFilter("all"); setDateFrom(""); setDateTo(""); }}
              className="whitespace-nowrap text-[11px] font-bold hover:opacity-70"
              style={{ color: PLUM }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {invoices === null ? (
        <div className="p-8 text-center"><p className="text-[12px] font-medium" style={{ color: MUTED }}>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center"><p className="text-[12px] font-medium" style={{ color: MUTED }}>No invoices match the current filters.</p></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: BORDER }}>
                <th className="px-6 py-3 text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Invoice ID</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Participant</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Service type</th>
                <th className="px-4 py-3 text-right text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Amount</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Payment method</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Date</th>
                <th className="px-4 py-3 text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Status</th>
                <th className="px-6 py-3 text-right text-[9px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const meta = INVOICE_STATUS_META[inv.status] ?? INVOICE_STATUS_META.draft;
                return (
                  <tr key={inv.id} className="border-b last:border-b-0" style={{ borderColor: BORDER }}>
                    <td className="px-6 py-3.5 text-[11px] font-black" style={{ color: TEXT }}>{inv.invoice_number}</td>
                    <td className="px-4 py-3.5 text-[11px] font-bold" style={{ color: TEXT }}>{inv.recipient_name}</td>
                    <td className="px-4 py-3.5 text-[11px] font-medium" style={{ color: MUTED }}>
                      {displayServiceCategory(inv) == null ? "—" : displayServiceCategory(inv) === "aged_care" ? "Aged Care" : "Disability"}
                    </td>
                    <td className="px-4 py-3.5 text-right text-[11px] font-black" style={{ color: TEXT }}>{formatMoney(centsToAud(inv.total_cents))}</td>
                    <td className="px-4 py-3.5 text-[11px] font-medium" style={{ color: MUTED }}>
                      {(() => { const method = displayPaymentMethod(inv); return method ? PAYMENT_METHOD_LABEL[method] ?? method : "—"; })()}
                    </td>
                    <td className="px-4 py-3.5 text-[11px] font-medium" style={{ color: MUTED }}>
                      {formatAppDate(inv.created_at, inv.timezone)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wide" style={{ background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        {inv.pdf_url ? (
                          <>
                            <button
                              onClick={() => window.open(inv.pdf_url!, "_blank", "noopener")}
                              title="View"
                              aria-label={`View invoice ${inv.invoice_number}`}
                              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5"
                            >
                              <Eye size={13} style={{ color: MUTED }} />
                            </button>
                            <button
                              onClick={() => window.open(inv.pdf_url!, "_blank", "noopener")}
                              title="Print"
                              aria-label={`Print invoice ${inv.invoice_number}`}
                              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5"
                            >
                              <Printer size={13} style={{ color: MUTED }} />
                            </button>
                            <button
                              onClick={() => downloadInvoicePdf(inv.pdf_url!, `${inv.invoice_number}.pdf`)}
                              title="Download"
                              aria-label={`Download invoice ${inv.invoice_number}`}
                              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5"
                            >
                              <Download size={13} style={{ color: MUTED }} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => generatePdf(inv)}
                            disabled={generatingId === inv.id}
                            title="Generate PDF"
                            aria-label={`Generate PDF for invoice ${inv.invoice_number}`}
                            className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
                            style={{ borderColor: BORDER, color: PLUM }}
                          >
                            {generatingId === inv.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <FileText size={12} />
                            )}
                            Generate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {reauthModal}
    </section>
  );
}

type Period = "month" | "quarter" | "year";

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
  revenue_by_month: Array<{ month: string; billed_cents: number; current: boolean }>;
  recent_invoices: Array<{ id: string; invoice_number: string; name: string; total_cents: number; status: string }>;
}

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

const PINK = "#E8457A";
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (cents: number, compact = false) =>
  compact && Math.abs(cents) >= 100_000
    ? `$${(cents / 100_000).toFixed(1)}k`
    : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: compact ? 0 : 2 }).format(cents / 100);

const INVOICE_STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  draft: { label: "Draft", fg: "var(--cc-muted)", bg: "var(--cc-soft)" },
  outstanding: { label: "Outstanding", fg: "var(--cc-status-warning)", bg: "var(--cc-status-warning-bg)" },
  overdue: { label: "Overdue", fg: "var(--cc-status-danger)", bg: "var(--cc-status-danger-bg)" },
  paid: { label: "Paid", fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" },
};

function RevenueChart({ data }: { data: FinancialSummary }) {
  const months = data.revenue_by_month;
  const max = Math.max(...months.map((m) => m.billed_cents), 1);
  return (
    <section className="rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }} aria-label="Revenue by month">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold" style={{ color: TEXT }}>Revenue by month</h2>
        <p className="text-[12px]" style={{ color: MUTED }}>
          Cost / session{" "}
          <span className="font-bold" style={{ color: TEXT }}>
            {data.cost_per_session_cents != null ? money(data.cost_per_session_cents) : "—"}
          </span>
        </p>
      </div>
      {data.cost_per_session_cents == null && (
        <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
          Cost per session appears once completed shifts have been through pay calculation.
        </p>
      )}
      <div className="mt-6 flex h-56 items-end gap-3" role="list">
        {months.map((m) => {
          const pct = Math.max((m.billed_cents / max) * 100, m.billed_cents ? 4 : 1.5);
          const label = MONTH_ABBR[Number(m.month.slice(5, 7)) - 1] ?? m.month;
          return (
            <div key={m.month} role="listitem" aria-label={`${label}: ${money(m.billed_cents)}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-[11px] font-bold tabular-nums" style={{ color: m.current ? PINK : TEXT }}>
                {money(m.billed_cents, true)}
              </span>
              <div
                className="w-full rounded-t-lg transition-[height]"
                style={{ height: `${pct}%`, background: m.current ? PINK : "#EBD5DF" }}
              />
              <span className="text-[11px]" style={{ color: MUTED }}>{label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RecentInvoices({ rows }: { rows: FinancialSummary["recent_invoices"] }) {
  return (
    <section className="rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }} aria-label="Recent invoices">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold" style={{ color: TEXT }}>Recent invoices</h2>
        <Link href="/billing" className="text-[12px] font-semibold" style={{ color: PLUM }}>All invoices</Link>
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
                  <span className="w-[92px] rounded-full px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide" style={{ color: tone.fg, background: tone.bg }}>
                    {tone.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function MDFinancialPage() {
  const [period, setPeriod] = useState<Period>("quarter");
  const summary = useOrgQuery<FinancialSummary>(["md", "financial-summary", period], {
    queryFn: async () => {
      const res = await apiFetch(`/api/billing/financial-summary?period=${period}`);
      if (!res.ok) throw new Error("Couldn't load financial figures.");
      return res.json();
    },
    placeholderData: (previous) => previous,
  });
  const data = summary.data;
  const collectionRate = data && data.billed_cents > 0 ? Math.round((data.collected_cents / data.billed_cents) * 100) : null;

  return (
    <HubLayout>
      <div className="space-y-5 pb-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "var(--cc-active-bg)", color: PINK }}>
              <CircleDollarSign size={20} />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.025em]" style={{ color: TEXT }}>Financial Governance</h1>
              <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>
                Invoices, collections and cost per session{data ? ` · ${data.period_label}` : ""}
              </p>
            </div>
          </div>
          <div role="tablist" aria-label="Period" className="flex rounded-xl border p-1" style={{ borderColor: BORDER, background: SOFT }}>
            {PERIODS.map((p) => (
              <button
                key={p.key}
                role="tab"
                type="button"
                aria-selected={period === p.key}
                onClick={() => setPeriod(p.key)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: period === p.key ? "white" : "transparent",
                  color: period === p.key ? TEXT : MUTED,
                  boxShadow: period === p.key ? "0 1px 2px rgba(0,0,0,0.08)" : undefined,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {summary.isError && !data ? (
          <div role="alert" className="flex items-center gap-2 rounded-2xl border p-4 text-sm" style={{ borderColor: RED, color: RED }}>
            <AlertTriangle size={15} /> Financial figures couldn't be loaded.
            <button type="button" className="font-bold underline" onClick={() => void summary.refetch()}>Try again</button>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" style={{ color: PLUM }} /></div>
        ) : (
          <>
            <StatCardGroup fill>
              <StatCard
                icon={<FileText size={16} />}
                label="Invoices"
                value={data.invoice_count.toLocaleString("en-AU")}
                sub={`${money(data.billed_cents)} billed`}
                tone="brand"
                href="/billing"
              />
              <StatCard
                icon={<CheckCircle2 size={16} />}
                label="Collected"
                value={money(data.collected_cents)}
                sub={collectionRate != null ? `${collectionRate}% of billed` : "Paid in this period"}
                tone="success"
                href="/billing"
              />
              <StatCard
                icon={<AlertTriangle size={16} />}
                label="Outstanding"
                value={money(data.outstanding_cents)}
                sub={data.overdue_cents ? `${money(data.overdue_cents)} overdue` : "Nothing overdue"}
                tone={data.overdue_cents ? "danger" : "warning"}
                href="/billing"
              />
              <StatCard
                icon={<CalendarDays size={16} />}
                label="Sessions"
                value={data.session_count.toLocaleString("en-AU")}
                sub="Completed shifts"
                tone="info"
                href="/md/schedule"
              />
            </StatCardGroup>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <RevenueChart data={data} />
              <RecentInvoices rows={data.recent_invoices} />
            </div>
          </>
        )}

        <InvoiceLedger />
      </div>
    </HubLayout>
  );
}

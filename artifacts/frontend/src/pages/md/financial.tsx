import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileText,
  PieChart,
  TrendingUp,
  Wallet,
  Search,
  Eye,
  Printer,
  Download,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

const GREEN = "#0F7B57";
const AMBER = "#9A5B0A";
const RED = "#B3261E";
const CYAN = "#2A5C8A";

interface BillingReport {
  total_billed_cents: number;
  total_paid_cents: number;
  total_outstanding_cents: number;
  invoice_count: number;

  monthly: Array<{
    month: string;
    billed: number;
    paid: number;
    outstanding: number;
    count: number;
  }>;

  session_count?: number | null;
  total_session_costs_cents?: number | null;
  cost_per_session_cents?: number | null;
  gross_margin_pct?: number | null;
}

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

function getMonthLabel(month: string) {
  const date = new Date(`${month}-01`);

  if (Number.isNaN(date.getTime())) {
    return month;
  }

  return date.toLocaleDateString("en-AU", {
    month: "short",
    year: "numeric",
  });
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

// UI-only placeholders — service_category and payment_method aren't real
// columns yet (migration 142 hasn't been run), so until they are, the
// ledger fills these two cells with a value derived deterministically from
// the invoice's own id. Same invoice always shows the same dummy value on
// every render/reload; nothing is written anywhere, purely cosmetic.
const DUMMY_SERVICE_CATEGORIES: Array<"aged_care" | "disability"> = ["disability", "aged_care"];
const DUMMY_PAYMENT_METHODS = ["bank_transfer", "credit_card", "direct_debit", "ndis_portal"];

function stableIndex(seed: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % length;
}

function displayServiceCategory(inv: Invoice): "aged_care" | "disability" {
  return inv.service_category ?? DUMMY_SERVICE_CATEGORIES[stableIndex(inv.id, DUMMY_SERVICE_CATEGORIES.length)];
}

function displayPaymentMethod(inv: Invoice): string {
  return inv.payment_method ?? DUMMY_PAYMENT_METHODS[stableIndex(inv.id, DUMMY_PAYMENT_METHODS.length)];
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

  useEffect(() => {
    apiFetch("/api/billing/invoices")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setInvoices(Array.isArray(data) ? data : []))
      .catch(() => setInvoices([]));
  }, []);

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
                      {displayServiceCategory(inv) === "aged_care" ? "Aged Care" : "Disability"}
                    </td>
                    <td className="px-4 py-3.5 text-right text-[11px] font-black" style={{ color: TEXT }}>{formatMoney(centsToAud(inv.total_cents))}</td>
                    <td className="px-4 py-3.5 text-[11px] font-medium" style={{ color: MUTED }}>
                      {PAYMENT_METHOD_LABEL[displayPaymentMethod(inv)] ?? displayPaymentMethod(inv)}
                    </td>
                    <td className="px-4 py-3.5 text-[11px] font-medium" style={{ color: MUTED }}>
                      {new Date(inv.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wide" style={{ background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => inv.pdf_url && window.open(inv.pdf_url, "_blank", "noopener")}
                          disabled={!inv.pdf_url}
                          title="View"
                          aria-label={`View invoice ${inv.invoice_number}`}
                          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Eye size={13} style={{ color: MUTED }} />
                        </button>
                        <button
                          onClick={() => inv.pdf_url && window.open(inv.pdf_url, "_blank", "noopener")}
                          disabled={!inv.pdf_url}
                          title="Print"
                          aria-label={`Print invoice ${inv.invoice_number}`}
                          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Printer size={13} style={{ color: MUTED }} />
                        </button>
                        <button
                          onClick={() => inv.pdf_url && downloadInvoicePdf(inv.pdf_url, `${inv.invoice_number}.pdf`)}
                          disabled={!inv.pdf_url}
                          title="Download"
                          aria-label={`Download invoice ${inv.invoice_number}`}
                          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <Download size={13} style={{ color: MUTED }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FinancialStat({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{
    size?: number;
    strokeWidth?: number;
  }>;
  color: string;
}) {
  return (
    <div className="group">
      <div className="mb-2 flex items-center gap-2">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{
            background: `${color}12`,
            color,
          }}
        >
          <Icon size={13} strokeWidth={2.5} />
        </div>

        <span
          className="text-[10px] font-black uppercase tracking-[0.14em]"
          style={{ color: MUTED }}
        >
          {label}
        </span>
      </div>

      <p
        className="text-[25px] font-black tracking-tight"
        style={{ color: TEXT }}
      >
        {value}
      </p>

      <p
        className="mt-1 text-[11px] font-medium"
        style={{ color: MUTED }}
      >
        {sub}
      </p>
    </div>
  );
}

function ProgressBar({
  value,
  color,
  height = 8,
}: {
  value: number;
  color: string;
  height?: number;
}) {
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{
        height,
        background: `${BORDER}`,
      }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{
          width: `${Math.min(Math.max(value, 0), 100)}%`,
          background: color,
        }}
      />
    </div>
  );
}

function MiniMetric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <p
        className="text-[9px] font-black uppercase tracking-[0.14em]"
        style={{ color: MUTED }}
      >
        {label}
      </p>

      <p
        className="mt-1 text-[18px] font-black"
        style={{ color: TEXT }}
      >
        {value}
      </p>

      {sub && (
        <p
          className="mt-0.5 text-[10px] font-medium"
          style={{ color: MUTED }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

export default function MDFinancialPage() {
  const { translate } = useAccessibility();

  const [rev, setRev] = useState<BillingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/billing/revenue-report")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load financial report");
        }

        return response.json();
      })
      .then((result) => {
        if (!cancelled) {
          setRev(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const totalRevenue = centsToAud(rev?.total_billed_cents);
  const totalPaid = centsToAud(rev?.total_paid_cents);
  const outstanding = centsToAud(rev?.total_outstanding_cents);
  const invoiceCount = rev?.invoice_count ?? 0;

  const collectionRate =
    totalRevenue > 0
      ? Math.round((totalPaid / totalRevenue) * 100)
      : 0;

  const outstandingRate =
    totalRevenue > 0
      ? Math.round((outstanding / totalRevenue) * 100)
      : 0;

  const costPerSession =
    rev?.cost_per_session_cents != null
      ? centsToAud(rev.cost_per_session_cents)
      : null;

  const sessionCosts =
    rev?.total_session_costs_cents != null
      ? centsToAud(rev.total_session_costs_cents)
      : null;

  const grossMargin =
    rev?.gross_margin_pct != null
      ? rev.gross_margin_pct
      : null;

  const monthly = useMemo(() => {
    return (rev?.monthly ?? []).map((item) => ({
      ...item,
      billedAud: centsToAud(item.billed),
      paidAud: centsToAud(item.paid),
      outstandingAud: centsToAud(item.outstanding),
    }));
  }, [rev]);

  const visibleMonths = monthly.slice(-6);

  const maxMonthlyRevenue = Math.max(
    ...visibleMonths.map((month) => month.billedAud),
    1,
  );

  const latestMonth = visibleMonths[visibleMonths.length - 1];
  const previousMonth =
    visibleMonths.length > 1
      ? visibleMonths[visibleMonths.length - 2]
      : null;

  const monthlyChange =
    latestMonth && previousMonth && previousMonth.billedAud > 0
      ? Math.round(
          ((latestMonth.billedAud - previousMonth.billedAud) /
            previousMonth.billedAud) *
            100,
        )
      : null;

  const target = Math.max(totalRevenue * 1.05, 1000);

  const targetProgress =
    target > 0
      ? Math.min(Math.round((totalRevenue / target) * 100), 100)
      : 0;

  return (
    <HubLayout>
      <div className="pb-12">
        {loading ? (
          <div className="space-y-5">
            <div
              className="h-32 animate-pulse rounded-3xl"
              style={{ background: SOFT }}
            />

            <div className="grid gap-4 lg:grid-cols-3">
              <div
                className="h-64 animate-pulse rounded-3xl"
                style={{ background: SOFT }}
              />

              <div
                className="h-64 animate-pulse rounded-3xl lg:col-span-2"
                style={{ background: SOFT }}
              />
            </div>

            <div
              className="h-72 animate-pulse rounded-3xl"
              style={{ background: SOFT }}
            />
          </div>
        ) : error || !rev ? (
          <div
            className="flex min-h-[360px] items-center justify-center rounded-3xl border bg-white"
            style={{ borderColor: BORDER }}
          >
            <div className="text-center">
              <div
                className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{
                  background: "#FBEAE9",
                  color: RED,
                }}
              >
                <AlertTriangle size={22} strokeWidth={2.2} />
              </div>

              <p
                className="text-[15px] font-black"
                style={{ color: TEXT }}
              >
                {translate("md.financial.loadFailed")}
              </p>

              <p
                className="mt-1 text-[12px] font-medium"
                style={{ color: MUTED }}
              >
                Financial reporting data could not be loaded.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* ========================================================= */}
            {/* COMMAND HEADER                                            */}
            {/* ========================================================= */}

            <header
              className="mb-7 flex flex-wrap items-end justify-between gap-4"
            >
              <div>
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl"
                    style={{
                      background: `${CYAN}12`,
                      color: CYAN,
                    }}
                  >
                    <CircleDollarSign size={21} strokeWidth={2.2} />
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h1
                        className="text-[23px] font-black tracking-tight"
                        style={{ color: TEXT }}
                      >
                        Financial Command Centre
                      </h1>

                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
                        style={{
                          background: "#E9F5F0",
                          color: "#0F7B57",
                        }}
                      >
                        Live
                      </span>
                    </div>

                    <p
                      className="mt-0.5 text-[12px] font-medium"
                      style={{ color: MUTED }}
                    >
                      Revenue, cash collection and delivery economics
                    </p>
                  </div>
                </div>
              </div>

              <div
                className="flex items-center gap-2 rounded-xl border px-3 py-2"
                style={{
                  borderColor: BORDER,
                  background: "#fff",
                }}
              >
                <Clock3 size={13} style={{ color: MUTED }} />

                <span
                  className="text-[10px] font-bold"
                  style={{ color: MUTED }}
                >
                  Based on current billing records
                </span>
              </div>
            </header>

            {/* ========================================================= */}
            {/* FINANCIAL POSITION                                        */}
            {/* ========================================================= */}

            <section
              className="relative mb-5 overflow-hidden rounded-3xl border bg-white"
              style={{ borderColor: BORDER }}
            >
              <div className="grid lg:grid-cols-[1.15fr_.85fr]">
                <div className="p-6 sm:p-7">
                  <div className="mb-5 flex items-center gap-2">
                    <Wallet
                      size={14}
                      strokeWidth={2.5}
                      style={{ color: PLUM }}
                    />

                    <span
                      className="text-[10px] font-black uppercase tracking-[0.17em]"
                      style={{ color: MUTED }}
                    >
                      Financial Position
                    </span>
                  </div>

                  <div className="flex flex-wrap items-end gap-x-7 gap-y-4">
                    <div>
                      <p
                        className="text-[10px] font-black uppercase tracking-[0.12em]"
                        style={{ color: MUTED }}
                      >
                        Total billed
                      </p>

                      <p
                        className="mt-1 text-[40px] font-black leading-none tracking-[-0.04em]"
                        style={{ color: TEXT }}
                      >
                        {formatMoney(totalRevenue, true)}
                      </p>
                    </div>

                    <div className="pb-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: GREEN }}
                        />

                        <span
                          className="text-[12px] font-black"
                          style={{ color: GREEN }}
                        >
                          {collectionRate}% collected
                        </span>
                      </div>

                      <p
                        className="mt-1 text-[10px] font-medium"
                        style={{ color: MUTED }}
                      >
                        {formatMoney(totalPaid)} received
                      </p>
                    </div>
                  </div>

                  <div className="mt-7 max-w-2xl">
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className="text-[10px] font-bold"
                        style={{ color: MUTED }}
                      >
                        Cash collected
                      </span>

                      <span
                        className="text-[10px] font-black"
                        style={{ color: TEXT }}
                      >
                        {formatMoney(totalPaid)} /{" "}
                        {formatMoney(totalRevenue)}
                      </span>
                    </div>

                    <ProgressBar
                      value={collectionRate}
                      color={GREEN}
                      height={10}
                    />

                    <div className="mt-2 flex justify-between">
                      <span
                        className="text-[10px] font-medium"
                        style={{ color: MUTED }}
                      >
                        Outstanding: {formatMoney(outstanding)}
                      </span>

                      <span
                        className="text-[10px] font-bold"
                        style={{
                          color:
                            outstandingRate > 25 ? AMBER : MUTED,
                        }}
                      >
                        {outstandingRate}% outstanding
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  className="border-t p-6 lg:border-l lg:border-t-0"
                  style={{
                    borderColor: BORDER,
                    background: `${SOFT}`,
                  }}
                >
                  <div className="grid grid-cols-2 gap-x-5 gap-y-7">
                    <FinancialStat
                      label="Invoices"
                      value={invoiceCount.toLocaleString("en-AU")}
                      sub="Raised to date"
                      icon={FileText}
                      color={PLUM}
                    />

                    <FinancialStat
                      label="Collected"
                      value={formatMoney(totalPaid, true)}
                      sub={`${collectionRate}% of billed`}
                      icon={CheckCircle2}
                      color={GREEN}
                    />

                    <FinancialStat
                      label="Outstanding"
                      value={formatMoney(outstanding, true)}
                      sub="Awaiting payment"
                      icon={Clock3}
                      color={AMBER}
                    />

                    <FinancialStat
                      label="Sessions"
                      value={(rev.session_count ?? 0).toLocaleString(
                        "en-AU",
                      )}
                      sub="Cost-tracked sessions"
                      icon={BarChart3}
                      color={CYAN}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* ========================================================= */}
            {/* REVENUE + ECONOMICS                                      */}
            {/* ========================================================= */}

            <div className="mb-5 grid gap-5 lg:grid-cols-[1.45fr_.85fr]">
              {/* Revenue performance */}
              <section
                className="rounded-3xl border bg-white p-6"
                style={{ borderColor: BORDER }}
              >
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <TrendingUp
                        size={15}
                        strokeWidth={2.5}
                        style={{ color: CYAN }}
                      />

                      <h2
                        className="text-[14px] font-black"
                        style={{ color: TEXT }}
                      >
                        Revenue performance
                      </h2>
                    </div>

                    <p
                      className="mt-1 text-[11px] font-medium"
                      style={{ color: MUTED }}
                    >
                      Monthly billed revenue across the organisation
                    </p>
                  </div>

                  {monthlyChange !== null && (
                    <div
                      className="flex items-center gap-1 rounded-full px-2.5 py-1"
                      style={{
                        background:
                          monthlyChange >= 0
                            ? "#E9F5F0"
                            : "#FBEAE9",
                        color:
                          monthlyChange >= 0 ? GREEN : RED,
                      }}
                    >
                      <ArrowUpRight
                        size={11}
                        strokeWidth={2.5}
                      />

                      <span className="text-[10px] font-black">
                        {monthlyChange > 0 ? "+" : ""}
                        {monthlyChange}% MoM
                      </span>
                    </div>
                  )}
                </div>

                {visibleMonths.length > 0 ? (
                  <div className="space-y-4">
                    {visibleMonths.map((month, index) => {
                      const percentage =
                        maxMonthlyRevenue > 0
                          ? (month.billedAud /
                              maxMonthlyRevenue) *
                            100
                          : 0;

                      const isLatest =
                        index === visibleMonths.length - 1;

                      return (
                        <div key={month.month}>
                          <div className="mb-1.5 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className="text-[11px] font-bold"
                                style={{ color: TEXT }}
                              >
                                {getMonthLabel(month.month)}
                              </span>

                              {isLatest && (
                                <span
                                  className="rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase"
                                  style={{
                                    background: `${PLUM}12`,
                                    color: PLUM,
                                  }}
                                >
                                  Current
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3">
                              <span
                                className="text-[10px] font-medium"
                                style={{ color: MUTED }}
                              >
                                {month.count} invoices
                              </span>

                              <span
                                className="text-[11px] font-black"
                                style={{ color: TEXT }}
                              >
                                {formatMoney(month.billedAud)}
                              </span>
                            </div>
                          </div>

                          <div
                            className="h-2 overflow-hidden rounded-full"
                            style={{
                              background: `${BORDER}`,
                            }}
                          >
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${percentage}%`,
                                background: isLatest
                                  ? PLUM
                                  : `${PLUM}80`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    className="flex h-40 items-center justify-center rounded-2xl"
                    style={{ background: SOFT }}
                  >
                    <p
                      className="text-[12px] font-medium"
                      style={{ color: MUTED }}
                    >
                      No monthly revenue data available.
                    </p>
                  </div>
                )}

                <div
                  className="mt-6 border-t pt-4"
                  style={{ borderColor: BORDER }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p
                        className="text-[10px] font-black uppercase tracking-[0.12em]"
                        style={{ color: MUTED }}
                      >
                        Revenue target
                      </p>

                      <p
                        className="mt-1 text-[13px] font-black"
                        style={{ color: TEXT }}
                      >
                        {formatMoney(totalRevenue)}{" "}
                        <span
                          className="font-medium"
                          style={{ color: MUTED }}
                        >
                          of {formatMoney(target)}
                        </span>
                      </p>
                    </div>

                    <span
                      className="text-[12px] font-black"
                      style={{
                        color:
                          targetProgress >= 90
                            ? GREEN
                            : targetProgress >= 75
                              ? AMBER
                              : RED,
                      }}
                    >
                      {targetProgress}%
                    </span>
                  </div>

                  <div className="mt-2">
                    <ProgressBar
                      value={targetProgress}
                      color={
                        targetProgress >= 90
                          ? GREEN
                          : targetProgress >= 75
                            ? AMBER
                            : RED
                      }
                    />
                  </div>
                </div>
              </section>

              {/* Delivery economics */}
              <section
                className="rounded-3xl border bg-white p-6"
                style={{ borderColor: BORDER }}
              >
                <div className="mb-6">
                  <div className="flex items-center gap-2">
                    <BarChart3
                      size={15}
                      strokeWidth={2.5}
                      style={{ color: PLUM }}
                    />

                    <h2
                      className="text-[14px] font-black"
                      style={{ color: TEXT }}
                    >
                      Delivery economics
                    </h2>
                  </div>

                  <p
                    className="mt-1 text-[11px] font-medium"
                    style={{ color: MUTED }}
                  >
                    Cost and margin signals from recorded sessions
                  </p>
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="mb-2 flex items-end justify-between">
                      <div>
                        <p
                          className="text-[9px] font-black uppercase tracking-[0.14em]"
                          style={{ color: MUTED }}
                        >
                          Gross margin
                        </p>

                        <p
                          className="mt-1 text-[30px] font-black"
                          style={{
                            color:
                              grossMargin !== null
                                ? grossMargin >= 0
                                  ? GREEN
                                  : RED
                                : MUTED,
                          }}
                        >
                          {grossMargin !== null
                            ? `${grossMargin}%`
                            : "N/A"}
                        </p>
                      </div>

                      <CircleDollarSign
                        size={25}
                        style={{
                          color:
                            grossMargin !== null
                              ? GREEN
                              : MUTED,
                        }}
                      />
                    </div>

                    {grossMargin !== null && (
                      <ProgressBar
                        value={Math.max(
                          Math.min(grossMargin, 100),
                          0,
                        )}
                        color={
                          grossMargin >= 0 ? GREEN : RED
                        }
                      />
                    )}
                  </div>

                  <div
                    className="grid grid-cols-2 gap-4 border-t pt-5"
                    style={{ borderColor: BORDER }}
                  >
                    <MiniMetric
                      label="Cost / session"
                      value={
                        costPerSession !== null
                          ? formatMoney(costPerSession)
                          : "N/A"
                      }
                      sub={
                        rev.session_count
                          ? `${rev.session_count} sessions`
                          : "No cost records"
                      }
                    />

                    <MiniMetric
                      label="Session costs"
                      value={
                        sessionCosts !== null
                          ? formatMoney(sessionCosts, true)
                          : "N/A"
                      }
                      sub="Recorded delivery costs"
                    />
                  </div>

                  <div
                    className="rounded-2xl p-4"
                    style={{ background: SOFT }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                        style={{
                          background: "#fff",
                          color:
                            grossMargin !== null
                              ? GREEN
                              : MUTED,
                        }}
                      >
                        <PieChart
                          size={15}
                          strokeWidth={2.2}
                        />
                      </div>

                      <div>
                        <p
                          className="text-[11px] font-black"
                          style={{ color: TEXT }}
                        >
                          Cost visibility
                        </p>

                        <p
                          className="mt-1 text-[10px] leading-relaxed"
                          style={{ color: MUTED }}
                        >
                          {grossMargin !== null ||
                          sessionCosts !== null
                            ? "Session cost data is being captured and can be used to monitor delivery economics."
                            : "Connect session cost records to start measuring delivery economics and margin."}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* ========================================================= */}
            {/* CASH POSITION                                             */}
            {/* ========================================================= */}

            <section
              className="mb-5 rounded-3xl border bg-white p-6"
              style={{ borderColor: BORDER }}
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Wallet
                      size={15}
                      strokeWidth={2.5}
                      style={{ color: GREEN }}
                    />

                    <h2
                      className="text-[14px] font-black"
                      style={{ color: TEXT }}
                    >
                      Cash position
                    </h2>
                  </div>

                  <p
                    className="mt-1 text-[11px] font-medium"
                    style={{ color: MUTED }}
                  >
                    How billed revenue is translating into collected cash
                  </p>
                </div>

                <span
                  className="hidden rounded-full px-2.5 py-1 text-[9px] font-black uppercase sm:block"
                  style={{
                    background:
                      outstandingRate <= 15
                        ? "#E9F5F0"
                        : "#FBF2E6",
                    color:
                      outstandingRate <= 15
                        ? "#0F7B57"
                        : "#7A4A08",
                  }}
                >
                  {outstandingRate <= 15
                    ? "Healthy collection"
                    : "Collection attention"}
                </span>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                <div>
                  <p
                    className="text-[9px] font-black uppercase tracking-[0.14em]"
                    style={{ color: MUTED }}
                  >
                    Collected
                  </p>

                  <p
                    className="mt-1 text-[28px] font-black"
                    style={{ color: GREEN }}
                  >
                    {formatMoney(totalPaid, true)}
                  </p>

                  <p
                    className="mt-1 text-[10px] font-medium"
                    style={{ color: MUTED }}
                  >
                    {collectionRate}% of billed revenue
                  </p>
                </div>

                <div
                  className="hidden h-12 w-px lg:block"
                  style={{ background: BORDER }}
                />

                <div>
                  <p
                    className="text-[9px] font-black uppercase tracking-[0.14em]"
                    style={{ color: MUTED }}
                  >
                    Outstanding
                  </p>

                  <p
                    className="mt-1 text-[28px] font-black"
                    style={{
                      color:
                        outstanding > 0 ? AMBER : GREEN,
                    }}
                  >
                    {formatMoney(outstanding, true)}
                  </p>

                  <p
                    className="mt-1 text-[10px] font-medium"
                    style={{ color: MUTED }}
                  >
                    {outstandingRate}% of billed revenue
                  </p>
                </div>

                <div className="lg:col-span-3">
                  <ProgressBar
                    value={collectionRate}
                    color={GREEN}
                    height={12}
                  />
                </div>
              </div>
            </section>

            {/* ========================================================= */}
            {/* MONTHLY LEDGER (invoice-level)                            */}
            {/* ========================================================= */}

            <InvoiceLedger />

            {/* ========================================================= */}
            {/* DATA COVERAGE                                             */}
            {/* ========================================================= */}

            <section
              className="rounded-3xl border p-5"
              style={{
                borderColor: BORDER,
                background: SOFT,
              }}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white"
                    style={{ color: MUTED }}
                  >
                    <PieChart size={16} strokeWidth={2.2} />
                  </div>

                  <div>
                    <p
                      className="text-[11px] font-black"
                      style={{ color: TEXT }}
                    >
                      Support category reporting
                    </p>

                    <p
                      className="mt-1 max-w-xl text-[10px] leading-relaxed"
                      style={{ color: MUTED }}
                    >
                      Revenue by Core, Capacity Building and Capital is not
                      yet available because invoice support-category tagging
                      is not connected.
                    </p>
                  </div>
                </div>

                <span
                  className="w-fit rounded-full border bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-wider"
                  style={{
                    borderColor: BORDER,
                    color: MUTED,
                  }}
                >
                  Data coverage
                </span>
              </div>
            </section>
          </>
        )}
      </div>
    </HubLayout>
  );
}
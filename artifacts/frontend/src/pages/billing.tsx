import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Plus,
  TrendingUp,
  Zap,
  Settings,
  Lock,
  FileText,
  Clock,
  Search,
  ChevronDown,
} from "lucide-react";
import { useGetParticipants } from "@workspace/api-client-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getRevenueReport,
  getParticipantCurrentBillingPeriod,
  getReadyToInvoice,
  planManagementTypeLabel,
  type ReadyToInvoiceEntry,
} from "@/services/coordinatorService";
import {
  resolveNdisPrice,
  listCurrentNdisCatalogue,
  type NdisPriceResolution,
  type NdisCatalogueItem,
} from "@/services/ndisService";
import { appLocalDateKey } from "@/lib/datetime";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { SectionInfo } from "@/components/ui/section-info";
import { useReAuth } from "@/hooks/useReAuth";
import { NdiaClaimsPanel } from "@/components/billing/NdiaClaimsPanel";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiGrid } from "@/components/ui/stat-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NdisPriceEditor } from "@/components/NdisPriceEditor";
import { NdisScheduleLoader } from "@/components/NdisScheduleLoader";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ShiftVerificationPanel } from "@/components/coordinator/ShiftVerificationPanel";

// ── Design tokens — aligned with Dashboard ────────────────────────────────────
const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

export interface Invoice {
  paid_at?: string | null;
  payment_date?: string | null;
  payment_reference?: string | null;
  payment_method?: string | null;
  finalized_at?: string | null;
  issued_at?: string | null;
  cancelled_at?: string | null;
  pdf_generation_failed?: boolean;
  id: string;
  invoice_number: string;
  recipient_name: string;
  recipient_email?: string | null;
  status: string;
  due_date?: string | null;
  total_cents: number;
  currency: string;
  created_at: string;
  line_items: Array<{
    description: string;
    quantity: number;
    unit_amount_cents: number;
    item_code?: string | null;
    service_date?: string | null;
    location_type?: string | null;
    line_total_cents: number;
  }>;
}

function cents(value?: number | null, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(
    (value || 0) / 100,
  );
}

export function overdueDays(
  invoice: Invoice,
  today = appLocalDateKey(new Date().toISOString()),
) {
  if (
    !["issued", "sent", "overdue"].includes(invoice.status) ||
    !invoice.due_date
  )
    return 0;
  const days = Math.floor(
    (Date.parse(today) - Date.parse(invoice.due_date.slice(0, 10))) / 86400000,
  );
  return Number.isFinite(days) ? Math.max(0, days) : 0;
}

export function invoiceReviewWarnings(invoice: Invoice) {
  const warnings: string[] = [];
  if (!invoice.recipient_name?.trim())
    warnings.push("Add the billing recipient.");
  if (!invoice.recipient_email?.trim())
    warnings.push(
      "No recipient email is recorded. Confirm how this invoice will be delivered.",
    );
  if (!invoice.due_date) warnings.push("No payment due date is recorded.");
  if (!invoice.line_items.length)
    warnings.push("This invoice has no service items.");
  if (invoice.line_items.some((item) => item.item_code && !item.service_date))
    warnings.push(
      "Some NDIS items have no service date. Check the applicable rate before finalising.",
    );
  if (invoice.pdf_generation_failed)
    warnings.push(
      "The invoice PDF could not be generated. Regenerate it before finalising.",
    );
  return warnings;
}

function InvoiceRecord({ invoice }: { invoice: Invoice }) {
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-1 gap-3 rounded-xl bg-cc-soft p-4 sm:grid-cols-2">
        <div>
          <dt className="text-cc-muted">Billing recipient</dt>
          <dd className="font-semibold break-words">
            {invoice.recipient_name}
          </dd>
          <dd className="break-all text-cc-muted">
            {invoice.recipient_email || "Email not recorded"}
          </dd>
        </div>
        <div>
          <dt className="text-cc-muted">Payment due</dt>
          <dd>{invoice.due_date || "Not recorded"}</dd>
        </div>
      </dl>
      <div className="divide-y divide-cc-border">
        {invoice.line_items.map((item, index) => (
          <div
            key={index}
            className="flex flex-wrap justify-between gap-2 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium break-words">{item.description}</p>
              <p className="break-all text-xs text-cc-muted">
                {item.item_code || "No NDIS item code"}
              </p>
              <p className="text-cc-muted">
                Service: {item.service_date || "Not recorded"}
              </p>
              <p className="text-cc-muted">
                {item.quantity} x{" "}
                {cents(item.unit_amount_cents, invoice.currency)}
              </p>
            </div>
            <strong className="tabular-nums">
              {cents(item.line_total_cents, invoice.currency)}
            </strong>
          </div>
        ))}
      </div>
      <div className="flex justify-between gap-3 border-t border-cc-border pt-3 font-semibold">
        <span>Invoice total</span>
        <span>{cents(invoice.total_cents, invoice.currency)}</span>
      </div>
      {invoice.status === "paid" && (
        <dl className="grid grid-cols-1 gap-2 rounded-xl border border-cc-border p-3 sm:grid-cols-2">
          <div>
            <dt className="text-cc-muted">Payment date</dt>
            <dd>
              {invoice.payment_date ||
                (invoice.paid_at
                  ? appLocalDateKey(invoice.paid_at)
                  : "Not recorded")}
            </dd>
          </div>
          <div>
            <dt className="text-cc-muted">Payment reference</dt>
            <dd className="break-all">
              {invoice.payment_reference || "Not recorded"}
            </dd>
          </div>
          <div>
            <dt className="text-cc-muted">Payment method</dt>
            <dd>{invoice.payment_method || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-cc-muted">Payment status</dt>
            <dd>Marked as paid in full</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function InvoiceActivity({ invoiceId }: { invoiceId: string }) {
  const { data, isLoading, isError, refetch } = useOrgQuery<
    Array<{
      id: string;
      action_type: string;
      actor_name: string;
      created_at: string;
    }>
  >(["billing", "activity", invoiceId], {
    queryFn: async () => {
      const response = await apiFetch(
        `/api/billing/invoices/${encodeURIComponent(invoiceId)}/activity`,
      );
      if (!response.ok) throw new Error("Could not load invoice activity.");
      return response.json();
    },
    staleTime: 0,
  });
  const labels: Record<string, string> = {
    "invoice.created": "Invoice created",
    "invoice.updated": "Invoice updated",
    "invoice.status_changed": "Invoice status changed",
    "invoice.cancelled": "Invoice cancelled",
    "invoice.pdf_generated": "PDF generated",
    "invoice.pdf_generation_failed": "PDF generation failed",
  };
  return (
    <section className="mt-5 border-t border-cc-border pt-4">
      <h3 className="font-semibold">Activity history</h3>
      {isLoading ? (
        <p role="status">Loading activity...</p>
      ) : isError ? (
        <div role="alert">
          Activity could not be loaded.{" "}
          <Button variant="link" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : !data?.length ? (
        <p className="mt-2 text-sm text-cc-muted">
          No recorded activity available.
        </p>
      ) : (
        <ol className="mt-3 space-y-3">
          {data.map((event) => (
            <li
              key={event.id}
              className="border-l-2 border-cc-border pl-3 text-sm"
            >
              <p className="font-medium">
                {labels[event.action_type] || "Invoice activity"}
              </p>
              <p className="break-words text-cc-muted">
                {event.actor_name} |{" "}
                {new Date(event.created_at).toLocaleString("en-AU")}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function statusTone(status: string) {
  if (status === "paid")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "finalized" || status === "issued" || status === "sent")
    return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "cancelled" || status === "void")
    return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-600 border-slate-200"; // draft
}

// ── Shared card component ─────────────────────────────────────────────────────
function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-cc-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cc-border px-4 py-4 sm:px-5">
        <h2 className="text-sm font-semibold text-cc-text">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function Billing() {
  const { translate, translateParams } = useAccessibility();
  const { user } = useAuth();
  const { toast } = useToast();
  const [reviewInvoice, setReviewInvoice] = useState<Invoice | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const { requireReAuth, modal } = useReAuth();
  const isCoordinator = user?.role === "support_coordinator";
  const isManagingDirector = user?.role === "managing_director";
  const canInvoice = isCoordinator || isManagingDirector;
  const priceRequest = useRef(0);

  // Set by the stat tiles: opens the revenue ledger filtered to what the tile counts.
  const [ledgerStatus, setLedgerStatus] = useState<RevenueLedgerStatusFilter>("all");
  const openLedger = (status: RevenueLedgerStatusFilter) => {
    setLedgerStatus(status);
    setWorkspace("reports");
  };
  const [workspace, setWorkspace] = useState<
    "invoices" | "claims" | "ready" | "checks" | "reports" | "pricing"
  >(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("workspace") === "claims"
      ? "claims"
      : "invoices",
  );
  const [readySearch, setReadySearch] = useState("");
  const [preparingDraft, setPreparingDraft] = useState(false);
  const [invoicePage, setInvoicePage] = useState(1);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("all");
  useEffect(() => setInvoicePage(1), [invoiceSearch, invoiceFilter]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyInvoice, setBusyInvoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [resolvingPrice, setResolvingPrice] = useState(false);
  const [resolvedPrice, setResolvedPrice] =
    useState<NdisPriceResolution | null>(null);
  const [showPriceEditor, setShowPriceEditor] = useState(false);
  const [showScheduleLoader, setShowScheduleLoader] = useState(false);

  const [form, setForm] = useState({
    participant_id: "",
    // Billing from verified shifts is the common path now that the pipeline
    // works end to end — default to it so opening the form doesn't drop a
    // coordinator into blank manual item-code/unit-amount/quantity fields
    // they have to remember to opt out of every time.
    generate_from_verified_tasks: true,
    period_start: "",
    period_end: "",
    service_date: "",
    location_type: "national" as "national" | "remote" | "very_remote",
    item_code: "",
    recipient_name: "",
    recipient_email: "",
    description: translate("billing.defaultDescription"),
    quantity: "1",
    unit_amount: "",
    due_date: "",
  });

  const participantsQuery = useGetParticipants();
  const participants = useMemo(() => {
    const raw = participantsQuery.data;
    if (Array.isArray(raw))
      return raw as unknown as Array<Record<string, unknown>>;
    if (
      raw &&
      typeof raw === "object" &&
      Array.isArray((raw as { data?: unknown }).data)
    ) {
      return (raw as { data: Array<Record<string, unknown>> }).data;
    }
    return [];
  }, [participantsQuery.data]);

  const billingPeriodQuery = useOrgQuery(
    ["billing", "participant-period", form.participant_id],
    {
      queryFn: () => getParticipantCurrentBillingPeriod(form.participant_id),
      enabled: Boolean(form.participant_id),
    },
  );

  const readyToInvoiceQuery = useOrgQuery<ReadyToInvoiceEntry[]>(
    ["billing", "ready-to-invoice"],
    {
      queryFn: getReadyToInvoice,
      enabled: canInvoice,
      staleTime: 60_000,
    },
  );

  function routingRecipient(
    participant: Record<string, unknown>,
    lockedType?: string | null,
  ) {
    const type = lockedType || String(participant.plan_management_type || "");
    if (type === "NDIA-managed") {
      return { recipient_name: "NDIA", recipient_email: "" };
    }
    if (type === "plan-managed") {
      return {
        recipient_name: String(participant.case_manager_name || "Plan Manager"),
        recipient_email: String(participant.case_manager_email || ""),
      };
    }
    return {
      recipient_name: String(participant.full_name || ""),
      recipient_email: String(participant.email || ""),
    };
  }

  /** Current calendar month as YYYY-MM-DD bounds — fallback period when a
   * participant has no "ready to invoice" entry to copy dates from (e.g.
   * their shifts haven't been verified yet, but a coordinator still wants
   * to set up the invoice period ahead of time). */
  function currentMonthBounds() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { period_start: iso(start), period_end: iso(end) };
  }

  function defaultPeriodFor(participantId: string) {
    const ready = (readyToInvoiceQuery.data ?? []).find(
      (entry) => entry.participant_id === participantId,
    );
    if (ready)
      return { period_start: ready.period_start, period_end: ready.period_end };
    return currentMonthBounds();
  }

  async function onParticipantChange(value: string) {
    if (value === "__none__") {
      setForm((prev) => ({
        ...prev,
        participant_id: "",
        recipient_name: "",
        recipient_email: "",
      }));
      return;
    }
    const participant = participants.find((p) => String(p.id) === value);
    if (!participant) {
      setForm((prev) => ({ ...prev, participant_id: value }));
      return;
    }
    const period = form.generate_from_verified_tasks
      ? defaultPeriodFor(value)
      : {};
    try {
      const currentPeriod = await getParticipantCurrentBillingPeriod(value);
      const lockedType =
        currentPeriod.open_period?.locked_plan_management_type ??
        currentPeriod.current_plan_management_type;
      const routed = routingRecipient(participant, lockedType);
      setForm((prev) => ({
        ...prev,
        ...period,
        participant_id: value,
        recipient_name: routed.recipient_name,
        recipient_email: routed.recipient_email,
      }));
    } catch {
      const routed = routingRecipient(
        participant,
        String(participant.plan_management_type || ""),
      );
      setForm((prev) => ({
        ...prev,
        ...period,
        participant_id: value,
        recipient_name: routed.recipient_name,
        recipient_email: routed.recipient_email,
      }));
    }
  }

  async function prefillFromReady(entry: ReadyToInvoiceEntry) {
    if (preparingDraft) return;
    setPreparingDraft(true);
    try {
      await onParticipantChange(entry.participant_id);
      setForm((prev) => ({
        ...prev,
        generate_from_verified_tasks: true,
        period_start: entry.period_start,
        period_end: entry.period_end,
      }));
      setShowInvoiceForm(true);
    } finally {
      setPreparingDraft(false);
    }
  }

  const totalOutstanding = useMemo(
    () =>
      invoices
        .filter((inv) => !["paid", "void", "cancelled"].includes(inv.status))
        .reduce((s, inv) => s + inv.total_cents, 0),
    [invoices],
  );
  const totalPaid = useMemo(
    () =>
      invoices
        .filter((inv) => inv.status === "paid")
        .reduce((s, inv) => s + inv.total_cents, 0),
    [invoices],
  );

  /** silent: refresh the list without swapping the page for a spinner
   * (used after actions taken inside a workspace, so it keeps its state). */
  async function loadBilling({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const r = await apiFetch("/api/billing/invoices");
      if (!r.ok) throw new Error("Could not load invoices.");
      setInvoices(await r.json());
    } catch (err) {
      setLoadError((err as Error).message);
      toast({
        title: translate("billing.toast.unavailable"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function resolveItemPrice(itemCode: string) {
    const request = ++priceRequest.current;
    if (!itemCode.trim() || !form.service_date) {
      setResolvingPrice(false);
      setResolvedPrice(null);
      return;
    }
    setResolvingPrice(true);
    try {
      const resolved = await resolveNdisPrice(
        itemCode,
        form.service_date,
        form.location_type,
      );
      if (request !== priceRequest.current) return;
      setResolvedPrice(resolved);
      // Auto-populate unit_amount with resolved price in dollars
      setForm((prev) => ({
        ...prev,
        unit_amount: Number(resolved.effective_price).toFixed(2),
      }));
    } catch (err) {
      if (request !== priceRequest.current) return;
      toast({
        title: translate("billing.toast.priceLookup"),
        description: translateParams("billing.toast.priceNotFound", {
          message: (err as Error).message,
        }),
        variant: "destructive",
      });
      setResolvedPrice(null);
      setForm((prev) => ({ ...prev, unit_amount: "" })); // Never substitute an unverified rate.
    } finally {
      if (request === priceRequest.current) setResolvingPrice(false);
    }
  }

  useEffect(() => {
    if (canInvoice) void loadBilling();
  }, [canInvoice]);

  async function createInvoice() {
    if (!canCreateDraft || creatingInvoice) return;
    setCreatingInvoice(true);
    try {
      const body = form.generate_from_verified_tasks
        ? {
            participant_id: form.participant_id || null,
            recipient_name: form.recipient_name,
            recipient_email: form.recipient_email || null,
            due_date: form.due_date || null,
            status: "draft",
            generate_from_verified_tasks: true,
            period_start: form.period_start,
            period_end: form.period_end,
            line_items: [],
          }
        : {
            participant_id: form.participant_id || null,
            recipient_name: form.recipient_name,
            recipient_email: form.recipient_email || null,
            due_date: form.due_date || null,
            status: "draft",
            line_items: [
              {
                description: form.description,
                service_date: form.service_date || null,
                location_type: form.location_type,
                quantity: Number(form.quantity || 1),
                unit_amount: Number(form.unit_amount || 0),
                item_code:
                  canInvoice && form.item_code?.trim() ? form.item_code : null,
              },
            ],
          };
      const res = await apiFetch("/api/billing/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.detail || "Could not create invoice.");
      }
      const inv = await res.json();
      setInvoices((prev) => [inv, ...prev]);
      setShowInvoiceForm(false);
      setWorkspace("invoices");
      setInvoicePage(1);
      setInvoiceSearch("");
      setInvoiceFilter("all");
      setForm((prev) => ({
        ...prev,
        participant_id: "",
        recipient_name: "",
        recipient_email: "",
        item_code: "",
        period_start: "",
        period_end: "",
      }));
      setResolvedPrice(null);
      if (form.generate_from_verified_tasks) void readyToInvoiceQuery.refetch();
      toast({
        title: translate("billing.toast.draftCreated"),
        description: inv.invoice_number,
      });
    } catch (err) {
      toast({
        title: translate("billing.toast.invoiceFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setCreatingInvoice(false);
    }
  }

  async function markPaid(invoice: Invoice) {
    if (busyInvoice) return;
    setBusyInvoice(invoice.id);
    try {
      const res = await requireReAuth(() =>
        apiFetch(`/api/billing/invoices/${invoice.id}/mark-paid`, {
          method: "POST",
        }),
      );
      if (!res) return;
      if (!res.ok) throw new Error("Could not mark paid.");
      const updated = await res.json();
      setInvoices((prev) =>
        prev.map((i) => (i.id === updated.id ? updated : i)),
      );
      toast({
        title: translate("billing.toast.markedPaid"),
        description: updated.invoice_number,
      });
    } catch (err) {
      toast({
        title: translate("billing.toast.updateFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusyInvoice(null);
    }
  }

  async function invoiceAction(
    invoice: Invoice,
    action: "finalize" | "mark-sent" | "cancel" | "pdf",
  ) {
    if (busyInvoice) return;
    setBusyInvoice(invoice.id);
    try {
      const res = await requireReAuth(() =>
        apiFetch(`/api/billing/invoices/${invoice.id}/${action}`, {
          method: "POST",
        }),
      );
      if (!res) return;
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.detail || "Action failed.");
      }
      const updated = await res.json();
      setInvoices((prev) =>
        prev.map((i) => (i.id === updated.id ? updated : i)),
      );
      toast({
        title: translate("billing.toast.invoiceUpdated"),
        description: updated.invoice_number,
      });
      if (action === "finalize") setReviewInvoice(null);
      if (action === "pdf" && updated.pdf_url)
        window.open(updated.pdf_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({
        title: translate("billing.toast.actionFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusyInvoice(null);
    }
  }

  if (!canInvoice) {
    return (
      <div className="space-y-2 py-10">
        <h1 className="text-xl font-semibold text-cc-text">
          {translate("billing.title")}
        </h1>
        <p className="text-sm font-medium text-cc-muted">
          {translate("billing.restricted")}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[360px] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-cc-plum" />
      </div>
    );
  }

  // An MD finds paid invoices in the Revenue report. Coordinators don't get
  // that report, so paid invoices stay in their register instead - they
  // still need to check every invoice is accurate.
  const paidInRegister = !isManagingDirector;
  const activeInvoices = invoices.filter(
    (invoice) => paidInRegister || invoice.status !== "paid",
  );
  const filteredInvoices = activeInvoices.filter(
    (invoice) =>
      (invoiceFilter === "all" ||
        (invoiceFilter === "overdue"
          ? overdueDays(invoice) > 0 || invoice.status === "overdue"
          : invoice.status === invoiceFilter)) &&
      `${invoice.invoice_number} ${invoice.id} ${invoice.recipient_name} ${invoice.recipient_email || ""}`
        .toLowerCase()
        .includes(invoiceSearch.trim().toLowerCase()),
  );

  const liveTotal =
    Number(form.quantity || 0) * Number(form.unit_amount || 0) * 100;
  const canCreateDraft = form.generate_from_verified_tasks
    ? Boolean(
        form.participant_id &&
        form.recipient_name.trim() &&
        form.period_start &&
        form.period_end,
      )
    : Boolean(
        form.recipient_name.trim() &&
        form.description.trim() &&
        Number.isFinite(Number(form.quantity)) &&
        Number(form.quantity) > 0 &&
        form.unit_amount.trim() &&
        Number.isFinite(Number(form.unit_amount)) &&
        Number(form.unit_amount) >= 0 &&
        (!form.item_code.trim() ||
          (form.service_date &&
            resolvedPrice?.item_code === form.item_code.trim() &&
            !resolvingPrice)),
      );

  return (
    <>
      {modal}
      <Sheet
        open={Boolean(reviewInvoice)}
        onOpenChange={(open) => {
          if (!open && !busyInvoice) setReviewInvoice(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-cc-border px-5 py-5 pr-12">
            <SheetTitle>Review invoice</SheetTitle>
            <SheetDescription>
              {reviewInvoice?.invoice_number} | Check the recipient, services
              and total before finalising.
            </SheetDescription>
          </SheetHeader>
          {reviewInvoice && (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <InvoiceRecord invoice={reviewInvoice} />
                {invoiceReviewWarnings(reviewInvoice).length > 0 && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-semibold">Check before continuing</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      {invoiceReviewWarnings(reviewInvoice).map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="space-y-3 border-t border-cc-border p-5">
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0 accent-cc-plum"
                    checked={reviewConfirmed}
                    onChange={(e) => setReviewConfirmed(e.target.checked)}
                  />
                  I have checked the billing details and service items.
                </label>
                <Button
                  className="min-h-11 w-full"
                  disabled={
                    !reviewConfirmed ||
                    Boolean(busyInvoice) ||
                    !reviewInvoice.line_items.length ||
                    !reviewInvoice.recipient_name?.trim() ||
                    reviewInvoice.pdf_generation_failed
                  }
                  onClick={() => invoiceAction(reviewInvoice, "finalize")}
                >
                  {busyInvoice ? "Finalising..." : "Finalise invoice"}
                </Button>
                <p className="text-xs text-cc-muted">
                  Finalising does not email the invoice to the recipient.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <div className="w-full min-w-0 space-y-4 pb-6">
        {/* ── Page header ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="hidden text-cc-muted">
              {translate("billing.role.coordinator")}
            </p>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-cc-text sm:text-3xl">
              {translate("billing.title")}
              <SectionInfo text="NDIS invoicing for delivered shifts: generate invoices, track payment status, and review pricing." />
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-cc-muted">
              Create drafts, review invoice details and track payments in one
              place.
            </p>
          </div>
          <Button
            className="min-h-11 gap-2 rounded-xl bg-cc-plum text-white"
            onClick={() => setShowInvoiceForm((open) => !open)}
            aria-expanded={showInvoiceForm}
            aria-controls="invoice-draft-form"
          >
            <Plus className="h-4 w-4" />
            {showInvoiceForm ? "Close draft form" : "New invoice"}
          </Button>
        </div>

        {/* ── Inline stat strip ─────────────────────────────────────────────── */}
        {/* Organisation-wide totals and the revenue report are managing
            director only. Coordinators work invoice by invoice (checking and
            verifying them) without the organisation's financial statistics. */}
        {isManagingDirector && (
          <KpiGrid className="sm:grid-cols-3 lg:grid-cols-3">
            <KpiCard
              label={translate("billing.stat.invoices")}
              value={loadError ? "Unavailable" : invoices.length}
              icon={<FileText />}
              onClick={() => setWorkspace("invoices")}
            />
            <KpiCard
              label={translate("billing.stat.outstanding")}
              value={loadError ? "Unavailable" : cents(totalOutstanding)}
              tone={totalOutstanding > 0 ? "warning" : "neutral"}
              icon={<Clock />}
              onClick={() => openLedger("outstanding")}
            />
            <KpiCard
              label={translate("billing.stat.paid")}
              value={loadError ? "Unavailable" : cents(totalPaid)}
              tone="success"
              icon={<Check />}
              onClick={() => openLedger("paid")}
            />
          </KpiGrid>
        )}
        <nav
          aria-label="Invoicing sections"
          className="flex flex-wrap gap-1 rounded-xl border border-cc-border bg-white p-1"
        >
          {(
            [
              ["invoices", "Invoices"],
              ["claims", "NDIA claims"],
              ["ready", "Ready to invoice"],
              ["checks", "Check completed shifts"],
              ["reports", "Revenue report"],
              ["pricing", "NDIS pricing"],
            ] as const
          )
            .filter(([key]) => key !== "reports" || isManagingDirector)
            .map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={workspace === key}
                onClick={() => setWorkspace(key)}
                className="min-h-11 rounded-lg px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  background: workspace === key ? SOFT : "transparent",
                  color: workspace === key ? PLUM : MUTED,
                }}
              >
                {label}
                {key === "ready" && readyToInvoiceQuery.data?.length
                  ? ` (${readyToInvoiceQuery.data.length})`
                  : ""}
              </button>
            ))}
        </nav>
        {workspace === "claims" && <NdiaClaimsPanel onChanged={() => void loadBilling({ silent: true })} />}
        {workspace === "ready" && readyToInvoiceQuery.isLoading && (
          <p role="status" className="py-6 text-sm text-cc-muted">
            Loading completed shifts...
          </p>
        )}
        {workspace === "ready" && readyToInvoiceQuery.isError && (
          <div
            role="alert"
            className="rounded-xl border border-cc-border bg-white p-5 text-sm"
          >
            Ready-to-invoice shifts could not be loaded.
            <Button
              variant="outline"
              className="ml-3"
              onClick={() => void readyToInvoiceQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        )}
        {workspace === "ready" &&
          !readyToInvoiceQuery.isLoading &&
          !readyToInvoiceQuery.isError &&
          !(readyToInvoiceQuery.data ?? []).length && (
            <Card title="Ready to invoice">
              <p className="text-sm text-cc-muted">
                No verified shifts are waiting to be invoiced.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setWorkspace("checks")}
              >
                Check completed shifts
              </Button>
            </Card>
          )}

        {/* ── Awaiting verification — completed shifts, one step before they
              can be invoiced. Lives here (not a separate page) so verifying a
              shift and seeing it become invoiceable happen in one place. ──── */}
        {canInvoice && workspace === "checks" && (
          <Card title="Check completed shifts">
            <div className="min-w-0">
              <ShiftVerificationPanel
                onVerified={() => void readyToInvoiceQuery.refetch()}
              />
            </div>
          </Card>
        )}

        {/* ── Ready to invoice — verified shifts with no invoice yet ──────────── */}
        {canInvoice &&
          workspace === "ready" &&
          !readyToInvoiceQuery.isLoading &&
          (readyToInvoiceQuery.data ?? []).length > 0 && (
            <Card
              title={`Ready to invoice (${readyToInvoiceQuery.data!.length})`}
            >
              {!readyToInvoiceQuery.data!.some((entry) =>
                [
                  entry.participant_name,
                  entry.participant_id,
                  entry.period_start,
                  entry.period_end,
                ]
                  .join(" ")
                  .toLowerCase()
                  .includes(readySearch.trim().toLowerCase()),
              ) && (
                <p className="py-4 text-sm text-cc-muted">
                  No billing periods match your search.
                </p>
              )}
              <div className="space-y-2">
                {readyToInvoiceQuery
                  .data!.filter((entry) =>
                    [
                      entry.participant_name,
                      entry.participant_id,
                      entry.period_start,
                      entry.period_end,
                    ]
                      .join(" ")
                      .toLowerCase()
                      .includes(readySearch.trim().toLowerCase()),
                  )
                  .map((entry) => (
                    <div
                      key={`${entry.participant_id}-${entry.period_start}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cc-border px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-cc-text">
                          {entry.participant_name}
                        </p>
                        <p className="break-all text-xs text-cc-muted">
                          Participant ID: {entry.participant_id}
                        </p>
                        <p className="text-xs text-cc-muted">
                          {entry.completions_count} verified{" "}
                          {entry.completions_count === 1 ? "shift" : "shifts"} ·{" "}
                          {entry.period_start} to {entry.period_end} ·{" "}
                          {cents(entry.total_cents)}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        className="shrink-0 rounded-xl"
                        disabled={preparingDraft}
                        onClick={() => void prefillFromReady(entry)}
                      >
                        {preparingDraft
                          ? "Preparing draft..."
                          : "Prepare invoice"}
                      </Button>
                    </div>
                  ))}
              </div>
            </Card>
          )}

        {/* ── Main grid: form + register ─────────────────────────────────────── */}
        <div className="min-w-0">
          {/* Invoice form */}
          <Sheet
            open={showInvoiceForm}
            onOpenChange={(open) => {
              if (!creatingInvoice) setShowInvoiceForm(open);
            }}
          >
            <SheetContent
              id="invoice-draft-form"
              className="flex h-dvh w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
            >
              <SheetHeader className="shrink-0 border-b border-cc-border px-5 py-5 pr-12 text-left">
                <SheetTitle>New invoice</SheetTitle>
                <SheetDescription>
                  Prepare a draft from verified shifts or enter a service item.
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
                <div className="grid gap-4 sm:grid-cols-2 sm:[&>div]:col-span-2 sm:[&>div:has(>input)]:col-span-1">
                  <div>
                    <Label className="text-xs font-bold text-cc-muted">
                      {translate("billing.participant")}
                    </Label>
                    <Select
                      value={form.participant_id || "__none__"}
                      onValueChange={onParticipantChange}
                    >
                      <SelectTrigger
                        className="mt-1.5 rounded-lg border-cc-border"
                        data-testid="select-billing-participant"
                      >
                        <SelectValue
                          placeholder={translate(
                            "billing.participantPlaceholder",
                          )}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          {translate("billing.participantPlaceholder")}
                        </SelectItem>
                        {participants.map((p) => (
                          <SelectItem key={String(p.id)} value={String(p.id)}>
                            {String(p.full_name ?? "Participant")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-lg border border-cc-border bg-cc-soft px-3 py-3 space-y-3">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={form.generate_from_verified_tasks}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          const autoPeriod =
                            checked && form.participant_id && !form.period_start
                              ? defaultPeriodFor(form.participant_id)
                              : {};
                          setForm({
                            ...form,
                            ...autoPeriod,
                            generate_from_verified_tasks: checked,
                            item_code: checked ? "" : form.item_code,
                          });
                        }}
                        className="mt-0.5"
                      />
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-cc-text">
                          {translate("billing.generateFromVerifiedTasks")}
                        </p>
                        <p className="text-xs text-cc-muted">
                          {translate("billing.generateFromVerifiedTasksHint")}
                        </p>
                      </div>
                    </label>
                  </div>

                  {form.participant_id && (
                    <div
                      className="rounded-lg border border-cc-border bg-cc-soft px-3 py-2.5 space-y-2"
                      role="status"
                    >
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-cc-muted">
                        <Lock className="h-3.5 w-3.5" />
                        {translate("billing.lockedRouting")}
                      </div>
                      {billingPeriodQuery.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-cc-plum" />
                      ) : (
                        <>
                          <p className="text-xs text-cc-muted">
                            {translate("billing.lockedRoutingHint")}
                          </p>
                          <div className="grid grid-cols-1 gap-1.5 text-sm">
                            <p>
                              <span className="font-semibold text-cc-muted">
                                {translate("billing.currentPlanType")}:{" "}
                              </span>
                              <span className="font-bold text-cc-text">
                                {planManagementTypeLabel(
                                  billingPeriodQuery.data
                                    ?.current_plan_management_type,
                                  translate,
                                )}
                              </span>
                            </p>
                            <p>
                              <span className="font-semibold text-cc-muted">
                                {translate("billing.lockedPlanType")}:{" "}
                              </span>
                              <span className="font-bold text-cc-text">
                                {planManagementTypeLabel(
                                  billingPeriodQuery.data?.open_period
                                    ?.locked_plan_management_type ??
                                    billingPeriodQuery.data
                                      ?.current_plan_management_type,
                                  translate,
                                )}
                              </span>
                            </p>
                          </div>
                          {billingPeriodQuery.data?.type_differs_from_lock && (
                            <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                              {billingPeriodQuery.data.message ??
                                translate("billing.routingMismatch")}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div>
                    <Label className="text-xs font-bold text-cc-muted">
                      {translate("billing.recipientName")}
                    </Label>
                    <Input
                      value={form.recipient_name}
                      onChange={(e) =>
                        setForm({ ...form, recipient_name: e.target.value })
                      }
                      className="mt-1.5 rounded-lg border-cc-border"
                      placeholder={translate(
                        "billing.recipientNamePlaceholder",
                      )}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-bold text-cc-muted">
                      {translate("billing.recipientEmail")}{" "}
                      <span className="font-medium">
                        ({translate("common.optional")})
                      </span>
                    </Label>
                    <Input
                      type="email"
                      value={form.recipient_email}
                      onChange={(e) =>
                        setForm({ ...form, recipient_email: e.target.value })
                      }
                      className="mt-1.5 rounded-lg border-cc-border"
                    />
                  </div>
                  <div hidden={form.generate_from_verified_tasks}>
                    <Label className="text-xs font-bold text-cc-muted">
                      {translate("billing.description")}
                    </Label>
                    <Input
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      className="mt-1.5 rounded-lg border-cc-border"
                      disabled={form.generate_from_verified_tasks}
                    />
                  </div>

                  {!form.generate_from_verified_tasks ? (
                    <div className="space-y-3 border-t border-cc-border pt-4">
                      <p className="text-sm font-semibold text-cc-text">
                        NDIS support pricing
                      </p>
                      <p className="text-xs leading-5 text-cc-muted">
                        Use the catalogue rate for the service date and region.
                        Rates are AUD per support unit; SCHADS employee pay is
                        separate.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor="invoice-service-date">
                            Service date
                          </Label>
                          <Input
                            id="invoice-service-date"
                            type="date"
                            value={form.service_date}
                            onChange={(e) => {
                              priceRequest.current++;
                              setResolvingPrice(false);
                              setResolvedPrice(null);
                              setForm({
                                ...form,
                                service_date: e.target.value,
                                unit_amount: "",
                              });
                            }}
                          />
                        </div>
                        <div>
                          <Label htmlFor="invoice-price-region">
                            Pricing region
                          </Label>
                          <select
                            id="invoice-price-region"
                            className="h-10 w-full rounded-md border border-cc-border bg-white px-2 text-sm"
                            value={form.location_type}
                            onChange={(e) => {
                              priceRequest.current++;
                              setResolvingPrice(false);
                              setResolvedPrice(null);
                              setForm({
                                ...form,
                                location_type: e.target
                                  .value as typeof form.location_type,
                                unit_amount: "",
                              });
                            }}
                          >
                            <option value="national">National</option>
                            <option value="remote">Remote</option>
                            <option value="very_remote">Very remote</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {/* NDIS Item Code Picker — Coordinator Only */}
                  {canInvoice && !form.generate_from_verified_tasks && (
                    <div>
                      <Label className="text-xs font-bold flex items-center gap-1.5 text-cc-muted">
                        {translate("billing.ndisItemCode")}{" "}
                        <span className="font-normal">
                          ({translate("common.optional")})
                        </span>
                      </Label>
                      <div className="flex gap-2 mt-1.5">
                        <Input
                          aria-label="NDIS support item code"
                          value={form.item_code}
                          onChange={(e) => {
                            priceRequest.current++;
                            setResolvingPrice(false);
                            setResolvedPrice(null);
                            setForm({
                              ...form,
                              item_code: e.target.value,
                              unit_amount: "",
                            });
                          }}
                          className="mt-0 rounded-lg flex-1 border-cc-border"
                          placeholder={translate(
                            "billing.ndisItemCodePlaceholder",
                          )}
                        />
                        {resolvingPrice && (
                          <Loader2 className="w-5 h-5 animate-spin mt-1.5 text-cc-plum" />
                        )}
                      </div>
                      <Button
                        variant="outline"
                        disabled={
                          !form.item_code.trim() ||
                          !form.service_date ||
                          resolvingPrice
                        }
                        onClick={() => resolveItemPrice(form.item_code)}
                      >
                        Resolve catalogue rate
                      </Button>
                      {resolvedPrice && (
                        <div className="mt-2 rounded-lg px-3 py-2 text-xs bg-emerald-50 border border-emerald-200 flex items-center gap-1.5 text-emerald-700">
                          <Zap className="w-3.5 h-3.5" />
                          <span className="font-medium">
                            {translateParams("billing.priceResolved", {
                              name: resolvedPrice.name,
                              price: resolvedPrice.effective_price.toFixed(2),
                              source: translate(
                                resolvedPrice.effective_price_source ===
                                  "calculated_multiplier"
                                  ? "billing.priceSource.calculated"
                                  : "billing.priceSource.explicit",
                              ),
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {form.generate_from_verified_tasks ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs font-bold text-cc-muted">
                          {translate("billing.periodStart")}
                        </Label>
                        <Input
                          type="date"
                          value={form.period_start}
                          onChange={(e) =>
                            setForm({ ...form, period_start: e.target.value })
                          }
                          className="mt-1.5 rounded-lg border-cc-border"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-bold text-cc-muted">
                          {translate("billing.periodEnd")}
                        </Label>
                        <Input
                          type="date"
                          value={form.period_end}
                          onChange={(e) =>
                            setForm({ ...form, period_end: e.target.value })
                          }
                          className="mt-1.5 rounded-lg border-cc-border"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div>
                        <Label className="text-xs font-bold text-cc-muted">
                          {translate("billing.quantity")}
                        </Label>
                        <Input
                          type="number"
                          min={0.1}
                          step={0.1}
                          value={form.quantity}
                          onChange={(e) =>
                            setForm({ ...form, quantity: e.target.value })
                          }
                          className="mt-1.5 rounded-lg border-cc-border"
                        />
                      </div>
                      <div>
                        <Label className="text-xs font-bold flex items-center justify-between text-cc-muted">
                          {translate("billing.unitAmount")}
                          {resolvedPrice && (
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                              Catalogue:{" "}
                              {cents(
                                (resolvedPrice.effective_price || 0) * 100,
                              )}{" "}
                              / {resolvedPrice.unit}
                            </span>
                          )}
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          aria-label="Unit rate in AUD"
                          value={form.unit_amount}
                          onChange={(e) =>
                            setForm({ ...form, unit_amount: e.target.value })
                          }
                          className="mt-1.5 rounded-lg border-cc-border"
                        />
                      </div>
                    </div>
                  )}

                  {/* Running total */}
                  {!form.generate_from_verified_tasks && (
                    <div className="rounded-lg px-4 py-3 flex items-center justify-between bg-cc-soft border border-cc-border">
                      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-cc-muted">
                        {translate("billing.invoiceTotal")}
                      </span>
                      <span className="text-lg font-semibold text-cc-text">
                        {cents(liveTotal)}
                      </span>
                    </div>
                  )}

                  <div>
                    <Label className="text-xs font-bold text-cc-muted">
                      {translate("billing.dueDate")}{" "}
                      <span className="font-medium">
                        ({translate("common.optional")})
                      </span>
                    </Label>
                    <Input
                      type="date"
                      value={form.due_date}
                      onChange={(e) =>
                        setForm({ ...form, due_date: e.target.value })
                      }
                      className="mt-1.5 rounded-lg border-cc-border"
                    />
                  </div>
                </div>
              </div>
              <div className="shrink-0 border-t border-cc-border bg-white p-4">
                <button
                  onClick={createInvoice}
                  disabled={creatingInvoice || !canCreateDraft}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-white bg-cc-plum shadow-sm transition hover:opacity-95 disabled:opacity-50"
                >
                  {creatingInvoice ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {translate("billing.createDraft")}
                </button>
              </div>
            </SheetContent>
          </Sheet>

          {/* Invoice register + revenue */}
          <div className="min-w-0 space-y-6" hidden={workspace !== "invoices"}>
            <Card
              title={translate("billing.invoiceRegister")}
              action={
                activeInvoices.length > 0 ? (
                  <span className="rounded-lg px-3 py-1 text-xs font-semibold bg-cc-soft text-cc-plum">
                    {translateParams("billing.registerTotal", {
                      count: String(activeInvoices.length),
                    })}
                  </span>
                ) : undefined
              }
            >
              {isManagingDirector && (
                <p className="mb-4 text-sm text-cc-muted">
                  Paid invoices are available in Revenue report.
                </p>
              )}
              <div className="mb-5 flex flex-col gap-3 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Search
                    aria-hidden="true"
                    className="absolute left-3 top-3.5 h-4 w-4 text-cc-muted"
                  />
                  <Input
                    aria-label="Search invoices"
                    placeholder="Search invoice number, recipient or email"
                    value={invoiceSearch}
                    onChange={(event) => setInvoiceSearch(event.target.value)}
                    className="h-11 rounded-xl pl-10"
                  />
                </div>
                <select
                  aria-label="Filter invoice status"
                  value={invoiceFilter}
                  onChange={(event) => setInvoiceFilter(event.target.value)}
                  className="min-h-11 rounded-xl border border-cc-border bg-white px-3 text-sm"
                >
                  <option value="all">All statuses</option>
                  <option value="overdue">Overdue</option>
                  {Array.from(
                    new Set(
                      invoices
                        .filter(
                          (invoice) =>
                            (paidInRegister || invoice.status !== "paid") &&
                            invoice.status !== "overdue",
                        )
                        .map((invoice) => invoice.status),
                    ),
                  )
                    .sort()
                    .map((status) => (
                      <option key={status} value={status}>
                        {status.replaceAll("_", " ")}
                      </option>
                    ))}
                </select>
              </div>
              {loadError ? (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
                >
                  {loadError}
                  <Button
                    variant="outline"
                    className="ml-3"
                    onClick={loadBilling}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
              <p className="mb-3 text-xs text-cc-muted" aria-live="polite">
                {filteredInvoices.length} of {activeInvoices.length} invoices
              </p>
              {activeInvoices.length > 0 && filteredInvoices.length === 0 ? (
                <div className="py-8 text-center text-sm text-cc-muted">
                  No invoices match your search.
                  <Button
                    variant="link"
                    onClick={() => {
                      setInvoiceSearch("");
                      setInvoiceFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : null}
              {activeInvoices.length === 0 && !loadError ? (
                <div className="py-10 text-center">
                  <p className="text-sm font-semibold text-cc-text">
                    {translate("billing.noInvoices")}
                  </p>
                  <p className="mt-1 text-sm font-medium text-cc-muted">
                    {translate("billing.noInvoicesHint")}
                  </p>
                </div>
              ) : (
                <div className="divide-y border-cc-border">
                  {filteredInvoices
                    .slice(
                      (Math.min(
                        invoicePage,
                        Math.max(1, Math.ceil(filteredInvoices.length / 10)),
                      ) -
                        1) *
                        10,
                      Math.min(
                        invoicePage,
                        Math.max(1, Math.ceil(filteredInvoices.length / 10)),
                      ) * 10,
                    )
                    .map((invoice) => (
                      <div
                        key={invoice.id}
                        className="flex flex-wrap items-center gap-3 py-5 first:pt-0 last:pb-0"
                      >
                        {/* Initials circle */}
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-xs font-semibold text-white bg-cc-plum">
                          {invoice.recipient_name
                            .split(" ")
                            .map((p) => p[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-cc-text">
                              {invoice.recipient_name}
                            </p>
                            <span
                              className={`rounded-lg border px-2.5 py-0.5 text-[11px] font-bold ${statusTone(invoice.status)}`}
                            >
                              {overdueDays(invoice) > 0
                                ? `${overdueDays(invoice)} days overdue`
                                : invoice.status}
                            </span>
                          </div>
                          <p className="mt-1 break-words text-sm text-cc-muted">
                            {invoice.invoice_number}
                            {invoice.due_date
                              ? ` · ${translateParams("billing.due", { date: invoice.due_date })}`
                              : ""}
                          </p>
                        </div>

                        {/* Amount */}
                        <p className="shrink-0 text-lg font-semibold tabular-nums text-cc-text">
                          {cents(invoice.total_cents, invoice.currency)}
                        </p>

                        <details className="w-full min-w-0 rounded-xl border border-cc-border px-3">
                          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-medium text-cc-plum">
                            View invoice details
                            <ChevronDown className="h-4 w-4" />
                          </summary>
                          <div className="space-y-3 border-t border-cc-border py-3 text-sm">
                            {invoice.recipient_email ? (
                              <p className="break-all text-cc-muted">
                                {invoice.recipient_email}
                              </p>
                            ) : null}
                            {invoice.line_items.map((item, index) => (
                              <div
                                key={index}
                                className="flex flex-wrap items-start justify-between gap-2"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="break-words text-cc-text">
                                    {item.description}
                                  </p>
                                  {item.item_code && (
                                    <p className="break-all text-xs text-cc-muted">
                                      {item.item_code}
                                      {item.service_date
                                        ? ` | Service: ${item.service_date}`
                                        : ""}
                                      {item.location_type
                                        ? ` | ${item.location_type.replaceAll("_", " ")}`
                                        : ""}
                                    </p>
                                  )}
                                  <p className="text-xs text-cc-muted">
                                    {item.quantity} &times;{" "}
                                    {cents(
                                      item.unit_amount_cents,
                                      invoice.currency,
                                    )}
                                  </p>
                                </div>
                                <span className="font-semibold tabular-nums">
                                  {cents(
                                    item.line_total_cents,
                                    invoice.currency,
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                          {/* Actions */}
                          <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-cc-soft/40 p-2">
                            {invoice.status === "draft" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg text-sm min-h-10 h-auto px-3 py-2"
                                disabled={busyInvoice !== null}
                                onClick={() => (
                                  setReviewConfirmed(false),
                                  setReviewInvoice(invoice)
                                )}
                              >
                                Review & finalise
                              </Button>
                            )}
                            {["finalized", "issued"].includes(
                              invoice.status,
                            ) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg text-sm min-h-10 h-auto px-3 py-2"
                                disabled={busyInvoice !== null}
                                onClick={() =>
                                  invoiceAction(invoice, "mark-sent")
                                }
                              >
                                {translate("billing.action.markSent")}
                              </Button>
                            )}
                            {/* A draft is reviewed and finalised before it can be paid. */}
                            {!["draft", "paid", "void", "cancelled"].includes(
                              invoice.status,
                            ) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg text-sm min-h-10 h-auto px-3 py-2"
                                disabled={busyInvoice !== null}
                                onClick={() => markPaid(invoice)}
                              >
                                {translate("billing.action.paid")}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="rounded-lg text-sm min-h-10 h-auto px-3 py-2"
                              disabled={busyInvoice !== null}
                              onClick={() => invoiceAction(invoice, "pdf")}
                            >
                              {translate("billing.action.pdf")}
                            </Button>
                            {!["paid", "void", "cancelled"].includes(
                              invoice.status,
                            ) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-lg text-sm min-h-10 h-auto px-3 py-2 text-red-500"
                                disabled={busyInvoice !== null}
                                onClick={() => invoiceAction(invoice, "cancel")}
                              >
                                {translate("billing.action.cancel")}
                              </Button>
                            )}
                          </div>
                        </details>
                      </div>
                    ))}
                </div>
              )}
              {filteredInvoices.length > 10 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-cc-border pt-4">
                  <p className="text-sm text-cc-muted">
                    Page{" "}
                    {Math.min(
                      invoicePage,
                      Math.ceil(filteredInvoices.length / 10),
                    )}{" "}
                    of {Math.ceil(filteredInvoices.length / 10)}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={invoicePage <= 1}
                      onClick={() =>
                        setInvoicePage((page) =>
                          Math.max(
                            1,
                            Math.min(
                              page,
                              Math.ceil(filteredInvoices.length / 10),
                            ) - 1,
                          ),
                        )
                      }
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        invoicePage >= Math.ceil(filteredInvoices.length / 10)
                      }
                      onClick={() => setInvoicePage((page) => page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>

        {workspace === "reports" && isManagingDirector && (
          <RevenueReportPanel ledgerStatus={ledgerStatus} />
        )}
        <section
          hidden={workspace !== "pricing"}
          aria-label="NDIS pricing catalogue"
        >
          <div className="mt-4 space-y-4">
            {/* NDIS Pricing Administration — Coordinator Only */}
            {canInvoice && (
              <Card
                title={translate("billing.ndisPricing")}
                action={<Settings size={18} className="text-cc-muted" />}
              >
                <div className="space-y-3">
                  <p className="text-xs font-medium text-cc-muted">
                    {translate("billing.ndisPricingDesc")}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      onClick={() => setShowScheduleLoader(true)}
                      className="flex-1 rounded-lg px-4 py-2.5 text-sm font-bold text-white bg-cc-plum transition hover:opacity-90"
                    >
                      {translate("billing.loadSchedule")}
                    </button>
                    <button
                      onClick={() => setShowPriceEditor(true)}
                      className="flex-1 rounded-lg px-4 py-2.5 text-sm font-bold text-white bg-cc-coral transition hover:opacity-90"
                    >
                      {translate("billing.editItemPrice")}
                    </button>
                  </div>
                </div>
              </Card>
            )}
            {workspace === "pricing" && <NdisCatalogueBrowser />}
          </div>
        </section>
        {/* Modals — Coordinator Only */}
        {showPriceEditor && (
          <NdisPriceEditor onClose={() => setShowPriceEditor(false)} />
        )}
        {showScheduleLoader && (
          <NdisScheduleLoader
            onClose={() => setShowScheduleLoader(false)}
            onSuccess={() => loadBilling()}
          />
        )}
      </div>
    </>
  );
}

const CATALOGUE_SOURCE_META: Record<
  NdisCatalogueItem["source"],
  { label: string; bg: string; color: string }
> = {
  platform: { label: "Platform rate", bg: SOFT, color: MUTED },
  organization_override: { label: "Your rate", bg: SOFT, color: CORAL },
  organization: { label: "Organisation item", bg: SOFT, color: PLUM },
};

type CatalogueSourceFilter = "all" | NdisCatalogueItem["source"];

const CATALOGUE_PAGE_SIZE = 20;

export function NdisCatalogueBrowser() {
  const [region, setRegion] = useState<"national" | "remote" | "very_remote">(
    "national",
  );
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] =
    useState<CatalogueSourceFilter>("all");
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useOrgQuery(
    ["ndis-pricing", "current-catalogue"],
    {
      queryFn: listCurrentNdisCatalogue,
    },
  );

  const q = search.trim().toLowerCase();
  const filtered = (data ?? []).filter((item) => {
    if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
    if (
      q &&
      !(
        item.item_code.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        (item.category_number || "").toLowerCase().includes(q)
      )
    )
      return false;
    return true;
  });

  useEffect(() => setPage(1), [search, sourceFilter]);
  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / CATALOGUE_PAGE_SIZE),
  );
  const clampedPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (clampedPage - 1) * CATALOGUE_PAGE_SIZE,
    clampedPage * CATALOGUE_PAGE_SIZE,
  );

  function formatPrice(item: NdisCatalogueItem) {
    const value =
      region === "remote"
        ? item.price_remote
        : region === "very_remote"
          ? item.price_very_remote
          : item.price_national;
    if (value == null) return "Not listed";
    const unit =
      item.unit === "H"
        ? "hour"
        : item.unit === "E"
          ? "each"
          : item.unit || "unit not specified";
    return (
      new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
      }).format(value) +
      " / " +
      unit
    );
  }

  return (
    <div
      className="rounded-2xl border bg-white"
      style={{ borderColor: BORDER }}
    >
      <div className="border-b px-5 py-4" style={{ borderColor: BORDER }}>
        <h3 className="text-sm font-semibold" style={{ color: TEXT }}>
          Current NDIS pricing catalogue
        </h3>
        <p className="mt-1 text-xs font-medium" style={{ color: MUTED }}>
          Current catalogue rates for your organisation. Amounts are in AUD. Use
          the service date when checking a rate for an invoice.
        </p>
      </div>

      <div
        className="flex flex-col gap-3 border-b px-5 py-3 sm:flex-row sm:items-center"
        style={{ borderColor: BORDER }}
      >
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: MUTED }}
          />
          <Input
            aria-label="Search NDIS catalogue"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by item code, name, or category"
            className="min-h-11 rounded-xl pl-8 text-sm"
          />
        </div>
        <Select
          value={sourceFilter}
          onValueChange={(v) => setSourceFilter(v as CatalogueSourceFilter)}
        >
          <SelectTrigger
            aria-label="Filter rate source"
            className="min-h-11 w-full rounded-xl text-sm sm:w-[170px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="platform">Platform rate</SelectItem>
            <SelectItem value="organization_override">Your rate</SelectItem>
            <SelectItem value="organization">Organisation item</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <label className="text-sm font-medium">
          Pricing region
          <select
            aria-label="Catalogue pricing region"
            className="ml-2 min-h-10 rounded-lg border border-cc-border bg-white px-3"
            value={region}
            onChange={(event) => setRegion(event.target.value as typeof region)}
          >
            <option value="national">National</option>
            <option value="remote">Remote</option>
            <option value="very_remote">Very remote</option>
          </select>
        </label>
        <p className="text-xs text-cc-muted">
          Not listed means no explicit rate was returned for this region.
        </p>
      </div>
      {isError ? (
        <div role="alert" className="p-5 text-sm">
          The pricing catalogue could not be loaded.
          <Button
            variant="outline"
            className="ml-3"
            onClick={() => void refetch()}
          >
            Retry catalogue
          </Button>
        </div>
      ) : isLoading ? (
        <div
          className="p-8 text-center text-xs font-medium"
          style={{ color: MUTED }}
        >
          Loading catalogue…
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="p-8 text-center text-xs font-medium"
          style={{ color: MUTED }}
        >
          {(data ?? []).length === 0
            ? "No pricing catalogue loaded yet."
            : "No items match the current filters."}
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full md:min-w-[720px] max-md:block">
            <thead className="bg-white max-md:hidden">
              <tr
                className="border-b text-left"
                style={{ borderColor: BORDER }}
              >
                <th
                  className="px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em]"
                  style={{ color: MUTED }}
                >
                  Item code
                </th>
                <th
                  className="px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em]"
                  style={{ color: MUTED }}
                >
                  Name
                </th>
                <th
                  className="px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em]"
                  style={{ color: MUTED }}
                >
                  Day / time
                </th>
                <th
                  className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.14em]"
                  style={{ color: MUTED }}
                >
                  Price
                </th>
                <th
                  className="px-5 py-2.5 text-xs font-semibold uppercase tracking-[0.14em]"
                  style={{ color: MUTED }}
                >
                  Source
                </th>
              </tr>
            </thead>
            <tbody className="max-md:block">
              {paged.map((item) => {
                const meta = CATALOGUE_SOURCE_META[item.source];
                return (
                  <tr
                    key={item.item_code}
                    className="border-b last:border-b-0 max-md:grid max-md:grid-cols-1 max-md:py-2"
                    style={{ borderColor: BORDER }}
                  >
                    <td
                      className="px-5 py-2.5 text-sm font-mono font-bold"
                      style={{ color: TEXT }}
                    >
                      {item.item_code}
                    </td>
                    <td
                      className="px-4 py-2.5 text-sm font-medium"
                      style={{ color: TEXT }}
                    >
                      {item.name}
                      <p className="mt-1 text-xs font-normal text-cc-muted">
                        Effective from {item.valid_from || "date not supplied"}
                        {item.valid_to ? ` until ${item.valid_to}` : ""}
                      </p>
                    </td>
                    <td
                      className="px-4 py-2.5 text-sm font-medium"
                      style={{ color: MUTED }}
                    >
                      {[item.day_type, item.time_type]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td
                      className="px-4 py-2.5 text-left md:text-right text-sm font-semibold"
                      style={{ color: TEXT }}
                    >
                      {formatPrice(item)}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide"
                        style={{ background: meta.bg, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-2.5"
        style={{ borderColor: BORDER }}
      >
        <p className="text-xs font-medium" style={{ color: MUTED }}>
          {isError
            ? "Catalogue unavailable"
            : isLoading
              ? "Loading items..."
              : `${filtered.length} of ${(data ?? []).length} items`}
        </p>
        {filtered.length > CATALOGUE_PAGE_SIZE && (
          <div className="flex items-center gap-3">
            <p className="text-xs font-medium" style={{ color: MUTED }}>
              Page {clampedPage} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="min-h-10 px-3 text-sm"
                disabled={clampedPage <= 1}
                onClick={() =>
                  setPage((p) => Math.max(1, Math.min(p, totalPages) - 1))
                }
              >
                Previous
              </Button>
              <Button
                variant="outline"
                className="min-h-10 px-3 text-sm"
                disabled={clampedPage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RevenueReportPanel({ ledgerStatus = "all" }: { ledgerStatus?: RevenueLedgerStatusFilter } = {}) {
  const { translate, translateParams } = useAccessibility();
  const { data, isLoading, isError, refetch } = useOrgQuery(
    ["billing", "revenue-report"],
    {
      queryFn: getRevenueReport,
    },
  );

  function fmt(value?: number | null, currency = "AUD") {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency,
    }).format((value || 0) / 100);
  }

  return (
    <section className="rounded-lg border border-cc-border bg-white shadow-sm">
      <div className="px-6 py-4 border-b border-cc-border flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-cc-text">
          {translate("billing.revenueReport")}
        </h2>
        <TrendingUp size={18} className="text-cc-muted" />
      </div>
      <div className="p-6 space-y-5">
        {isError ? (
          <div role="alert" className="text-sm">
            Revenue totals could not be loaded.
            <Button
              variant="outline"
              className="ml-3"
              onClick={() => void refetch()}
            >
              Retry revenue totals
            </Button>
          </div>
        ) : isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm font-medium text-cc-muted">
            <Loader2 className="h-4 w-4 animate-spin" />{" "}
            {translate("billing.revenue.loading")}
          </div>
        ) : !data ? (
          <p className="text-sm font-medium text-cc-muted">
            {translate("billing.revenue.noData")}
          </p>
        ) : (
          <>
            {/* Top-line stats */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(
                [
                  {
                    labelKey: "billing.revenue.totalBilled",
                    value: fmt(data.total_billed_cents),
                    color: "text-cc-text",
                  },
                  {
                    labelKey: "billing.revenue.totalPaid",
                    value: fmt(data.total_paid_cents),
                    color: "text-emerald-600",
                  },
                  {
                    labelKey: "billing.revenue.outstanding",
                    value: fmt(data.total_outstanding_cents),
                    color:
                      (data.total_outstanding_cents ?? 0) > 0
                        ? "text-amber-600"
                        : "text-cc-text",
                  },
                ] as const
              ).map(({ labelKey, value, color }) => (
                <div
                  key={labelKey}
                  className="rounded-lg p-4 bg-cc-soft border border-cc-border"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-cc-muted">
                    {translate(labelKey)}
                  </p>
                  <p className={`mt-2 text-base font-semibold ${color}`}>
                    {value}
                  </p>
                </div>
              ))}
            </div>

            {/* Monthly breakdown */}
            {data.monthly && data.monthly.length > 0 && (
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-cc-muted">
                  {translate("billing.revenue.monthlyBreakdown")}
                </p>
                <div className="divide-y rounded-lg border border-cc-border overflow-hidden">
                  {data.monthly.slice(0, 6).map((m) => {
                    const billed = m.billed ?? 0;
                    const paid = m.paid ?? 0;
                    const paidPct =
                      billed > 0 ? Math.round((paid / billed) * 100) : 0;
                    return (
                      <div
                        key={m.month}
                        className="flex items-center gap-4 px-4 py-3 hover:bg-[#F8F6FE] transition-colors"
                      >
                        <p className="text-sm font-semibold w-20 shrink-0 text-cc-text">
                          {m.month}
                        </p>
                        <div className="flex-1 min-w-0">
                          <div className="h-1.5 overflow-hidden rounded-lg bg-[#EDE3FC]">
                            <div
                              className="h-full rounded-lg bg-emerald-600"
                              style={{
                                width: `${Math.min(100, Math.max(0, paidPct))}%`,
                              }}
                            />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-cc-text">
                            {fmt(billed)}
                          </p>
                          <p className="text-[10px] font-medium text-cc-muted">
                            {translateParams("billing.revenue.invCount", {
                              count: String(m.count),
                              pct: String(paidPct),
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
        <RevenueInvoiceLedger key={ledgerStatus} initialStatus={ledgerStatus} />
      </div>
    </section>
  );
}

type RevenueLedgerStatusFilter = "all" | "paid" | "outstanding" | "void";

/** Invoice-level list for the Revenue report — search + status + date range,
 * same filter shape as md/financial.tsx's InvoiceLedger, scoped to this
 * coordinator's own org via the same /api/billing/invoices endpoint the
 * "Invoices" tab already uses. Paid invoices live here, searchable, rather
 * than only visible mixed into the full invoice list. */
const REVENUE_LEDGER_PAGE_SIZE = 10;

export function RevenueInvoiceLedger({
  initialStatus = "all",
}: { initialStatus?: RevenueLedgerStatusFilter } = {}) {
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<RevenueLedgerStatusFilter>(initialStatus);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, refetch } = useOrgQuery(
    ["billing", "invoices"],
    {
      queryFn: async () => {
        const response = await apiFetch("/api/billing/invoices");
        if (!response.ok) throw new Error("Could not load invoices");
        return response.json();
      },
    },
  );
  const invoices: Invoice[] = Array.isArray(data) ? data : [];

  const q = search.trim().toLowerCase();
  const filtered = invoices.filter((inv) => {
    if (
      q &&
      !(
        inv.recipient_name.toLowerCase().includes(q) ||
        inv.invoice_number.toLowerCase().includes(q) ||
        (inv.recipient_email || "").toLowerCase().includes(q) ||
        inv.id.toLowerCase().includes(q)
      )
    )
      return false;
    if (statusFilter === "paid" && inv.status !== "paid") return false;
    if (
      statusFilter === "outstanding" &&
      !["finalized", "issued", "sent", "overdue"].includes(inv.status)
    )
      return false;
    if (statusFilter === "void" && !["void", "cancelled"].includes(inv.status))
      return false;
    const day = inv.created_at.slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
    return true;
  });

  const hasFilters = Boolean(
    search || statusFilter !== "all" || dateFrom || dateTo,
  );

  useEffect(() => setPage(1), [search, statusFilter, dateFrom, dateTo]);
  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / REVENUE_LEDGER_PAGE_SIZE),
  );
  const clampedPage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (clampedPage - 1) * REVENUE_LEDGER_PAGE_SIZE,
    clampedPage * REVENUE_LEDGER_PAGE_SIZE,
  );

  return (
    <>
      <Sheet
        open={Boolean(selectedInvoice)}
        onOpenChange={(open) => {
          if (!open) setSelectedInvoice(null);
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b border-cc-border p-5 pr-12">
            <SheetTitle>{selectedInvoice?.invoice_number}</SheetTitle>
            <SheetDescription>
              Invoice, payment details and recorded activity
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {selectedInvoice && (
              <>
                <InvoiceRecord invoice={selectedInvoice} />
                <InvoiceActivity invoiceId={selectedInvoice.id} />
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <div className="border-t border-cc-border pt-5">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-cc-muted">
          Invoice history
        </p>

        <div className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-cc-muted"
            />
            <Input
              aria-label="Search invoice history"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recipient, invoice number, email or ID"
              className="min-h-11 rounded-xl pl-8 text-sm"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as RevenueLedgerStatusFilter)
            }
          >
            <SelectTrigger
              aria-label="Filter invoice history status"
              className="min-h-11 w-full rounded-xl text-sm sm:w-[150px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="outstanding">Outstanding</SelectItem>
              <SelectItem value="void">Void / cancelled</SelectItem>
            </SelectContent>
          </Select>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Input
              aria-label="Invoice created from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="min-h-11 w-full min-w-0 rounded-xl text-sm"
            />
            <Input
              aria-label="Invoice created to"
              type="date"
              min={dateFrom || undefined}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="min-h-11 w-full min-w-0 rounded-xl text-sm"
            />
          </div>
          {hasFilters && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setDateFrom("");
                setDateTo("");
              }}
              className="whitespace-nowrap text-sm font-bold text-cc-plum hover:opacity-70"
            >
              Clear
            </button>
          )}
        </div>

        <p className="mb-3 text-xs text-cc-muted">
          Dates filter when the invoice was created, not when payment was
          received. Filters apply to the invoice history below.
        </p>
        {dateFrom && dateTo && dateFrom > dateTo && (
          <p role="alert" className="text-sm text-red-700">
            The end date must be on or after the start date.
          </p>
        )}
        {isError ? (
          <div role="alert" className="py-4 text-sm">
            Invoice history could not be loaded.
            <Button
              variant="outline"
              className="ml-3"
              onClick={() => void refetch()}
            >
              Retry invoice history
            </Button>
          </div>
        ) : isLoading ? (
          <p className="py-4 text-sm font-medium text-cc-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-sm font-medium text-cc-muted">
            {invoices.length === 0
              ? "No invoices yet."
              : "No invoices match the current filters."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-cc-border">
            <table className="w-full md:min-w-[640px] max-md:block">
              <thead className="max-md:hidden">
                <tr className="border-b border-cc-border bg-cc-soft text-left">
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-cc-muted">
                    Invoice
                  </th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-cc-muted">
                    Recipient
                  </th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-cc-muted">
                    Date
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-[0.14em] text-cc-muted">
                    Amount
                  </th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-cc-muted">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="max-md:block">
                {paged.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-cc-border last:border-b-0 max-md:grid max-md:grid-cols-2 max-md:py-2"
                  >
                    <td className="px-4 py-2.5 text-sm font-bold text-cc-text">
                      <button
                        className="min-h-10 text-left text-cc-plum underline underline-offset-4"
                        onClick={() => setSelectedInvoice(inv)}
                        aria-label={`View invoice ${inv.invoice_number}`}
                      >
                        {inv.invoice_number}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-sm font-medium text-cc-text">
                      <span className="break-words">{inv.recipient_name}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm font-medium text-cc-muted">
                      <span className="block text-xs text-cc-muted md:hidden">
                        Created
                      </span>
                      {inv.created_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-sm font-semibold text-cc-text">
                      {cents(inv.total_cents, inv.currency)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${statusTone(inv.status)}`}
                      >
                        {overdueDays(inv) > 0
                          ? `${overdueDays(inv)} days overdue`
                          : inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-medium text-cc-muted">
            {isError
              ? "History unavailable"
              : isLoading
                ? "Loading invoices..."
                : `${filtered.length} of ${invoices.length} invoices`}
          </p>
          {filtered.length > REVENUE_LEDGER_PAGE_SIZE && (
            <div className="flex items-center gap-3">
              <p className="text-xs font-medium text-cc-muted">
                Page {clampedPage} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="min-h-10 px-3 text-sm"
                  disabled={clampedPage <= 1}
                  onClick={() =>
                    setPage((p) => Math.max(1, Math.min(p, totalPages) - 1))
                  }
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  className="min-h-10 px-3 text-sm"
                  disabled={clampedPage >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

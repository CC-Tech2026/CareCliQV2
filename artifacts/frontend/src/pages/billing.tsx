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
  planManagementTypeLabel,
} from "@/services/coordinatorService";
import {
  resolveNdisPrice,
  type NdisPriceResolution,
} from "@/services/ndisService";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { SectionInfo } from "@/components/ui/section-info";
import { useReAuth } from "@/hooks/useReAuth";
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

// ── Design tokens — aligned with Dashboard ────────────────────────────────────
const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

interface Invoice {
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
  const { requireReAuth, modal } = useReAuth();
  const isCoordinator = user?.role === "support_coordinator";
  const isManagingDirector = user?.role === "managing_director";
  const canInvoice = isCoordinator || isManagingDirector;
  const priceRequest = useRef(0);

  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceFilter, setInvoiceFilter] = useState("all");
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
    generate_from_verified_tasks: false,
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
    try {
      const period = await getParticipantCurrentBillingPeriod(value);
      const lockedType =
        period.open_period?.locked_plan_management_type ??
        period.current_plan_management_type;
      const routed = routingRecipient(participant, lockedType);
      setForm((prev) => ({
        ...prev,
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
        participant_id: value,
        recipient_name: routed.recipient_name,
        recipient_email: routed.recipient_email,
      }));
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

  async function loadBilling() {
    setLoading(true);
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

  const filteredInvoices = invoices.filter(
    (invoice) =>
      (invoiceFilter === "all" || invoice.status === invoiceFilter) &&
      `${invoice.invoice_number} ${invoice.recipient_name} ${invoice.recipient_email || ""}`
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
      <div className="mx-auto w-full max-w-[1440px] space-y-6 pb-10">
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
        <KpiGrid className="sm:grid-cols-3 lg:grid-cols-3">
          <KpiCard
            label={translate("billing.stat.invoices")}
            value={invoices.length}
            icon={<FileText />}
          />
          <KpiCard
            label={translate("billing.stat.outstanding")}
            value={cents(totalOutstanding)}
            tone={totalOutstanding > 0 ? "warning" : "neutral"}
            icon={<Clock />}
          />
          <KpiCard
            label={translate("billing.stat.paid")}
            value={cents(totalPaid)}
            tone="success"
            icon={<Check />}
          />
        </KpiGrid>

        {/* ── Main grid: form + register ─────────────────────────────────────── */}
        <div
          className={
            showInvoiceForm
              ? "grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]"
              : "min-w-0"
          }
        >
          {/* Invoice form */}
          {showInvoiceForm && (
            <div id="invoice-draft-form">
              <Card title={translate("billing.issueInvoice")}>
                <div className="space-y-4">
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
                        onChange={(e) =>
                          setForm({
                            ...form,
                            generate_from_verified_tasks: e.target.checked,
                            item_code: e.target.checked ? "" : form.item_code,
                          })
                        }
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
                  <div>
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
              </Card>
            </div>
          )}

          {/* Invoice register + revenue */}
          <div className="min-w-0 space-y-6">
            <Card
              title={translate("billing.invoiceRegister")}
              action={
                invoices.length > 0 ? (
                  <span className="rounded-lg px-3 py-1 text-xs font-semibold bg-cc-soft text-cc-plum">
                    {translateParams("billing.registerTotal", {
                      count: String(invoices.length),
                    })}
                  </span>
                ) : undefined
              }
            >
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
                  {Array.from(
                    new Set(invoices.map((invoice) => invoice.status)),
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
                {filteredInvoices.length} of {invoices.length} invoices
              </p>
              {invoices.length > 0 && filteredInvoices.length === 0 ? (
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
              {invoices.length === 0 ? (
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
                  {filteredInvoices.map((invoice) => (
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
                      <div className="min-w-[140px] flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-cc-text">
                            {invoice.recipient_name}
                          </p>
                          <span
                            className={`rounded-lg border px-2.5 py-0.5 text-[11px] font-bold ${statusTone(invoice.status)}`}
                          >
                            {invoice.status}
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
                                {cents(item.line_total_cents, invoice.currency)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </details>
                      {/* Actions */}
                      <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-cc-soft/40 p-2">
                        {invoice.status === "draft" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg text-sm min-h-10 h-auto px-3 py-2"
                            disabled={busyInvoice !== null}
                            onClick={() => invoiceAction(invoice, "finalize")}
                          >
                            {translate("billing.action.finalize")}
                          </Button>
                        )}
                        {["finalized", "issued"].includes(invoice.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg text-sm min-h-10 h-auto px-3 py-2"
                            disabled={busyInvoice !== null}
                            onClick={() => invoiceAction(invoice, "mark-sent")}
                          >
                            {translate("billing.action.markSent")}
                          </Button>
                        )}
                        {!["paid", "void", "cancelled"].includes(
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
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {canInvoice && <RevenueReportPanel />}
          </div>
        </div>

        <details className="rounded-2xl border border-cc-border bg-white p-4">
          <summary className="cursor-pointer py-2 text-sm font-semibold text-cc-text">
            NDIS pricing catalogue
          </summary>
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
          </div>
        </details>
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

function RevenueReportPanel() {
  const { translate, translateParams } = useAccessibility();
  const { data, isLoading } = useOrgQuery(["billing", "revenue-report"], {
    queryFn: getRevenueReport,
  });

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
        {isLoading ? (
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
                              style={{ width: `${paidPct}%` }}
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
      </div>
    </section>
  );
}

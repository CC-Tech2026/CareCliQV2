import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, TrendingUp, Zap, Settings, Lock } from "lucide-react";
import { useGetParticipants } from "@workspace/api-client-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getRevenueReport, getParticipantCurrentBillingPeriod, planManagementTypeLabel } from "@/services/coordinatorService";
import { resolveNdisPrice, type NdisPriceResolution } from "@/services/ndisService";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { NdisPriceEditor } from "@/components/NdisPriceEditor";
import { NdisScheduleLoader } from "@/components/NdisScheduleLoader";

// ── Design tokens — aligned with Dashboard ────────────────────────────────────
const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

interface Subscription {
  plan_name: string; status: string; billing_email?: string | null;
  seats: number; price_cents: number; currency: string;
  renewal_date?: string | null; payment_provider?: string | null; notes?: string | null;
}

interface Invoice {
  id: string; invoice_number: string; recipient_name: string;
  recipient_email?: string | null; status: string; due_date?: string | null;
  total_cents: number; currency: string; created_at: string;
  line_items: Array<{ description: string; quantity: number; unit_amount_cents: number; line_total_cents: number }>;
}

function cents(value?: number | null, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format((value || 0) / 100);
}

function statusTone(status: string) {
  if (status === "paid")      return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "finalized" || status === "issued" || status === "sent")
                               return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "cancelled" || status === "void")
                               return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-600 border-slate-200"; // draft
}

// ── Shared card component ─────────────────────────────────────────────────────
function Card({ title, children, action }: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-cc-border bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-cc-border px-5 py-3.5">
        <h2 className="text-[11px] font-black uppercase tracking-[0.12em] text-cc-muted">{title}</h2>
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
  const canInvoice = user?.role === "support_coordinator" || user?.role === "allied_health";

  const [loading,            setLoading           ] = useState(true);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [creatingInvoice,    setCreatingInvoice   ] = useState(false);
  const [subscription,       setSubscription      ] = useState<Subscription | null>(null);
  const [invoices,           setInvoices          ] = useState<Invoice[]>([]);
  const [resolvingPrice,     setResolvingPrice    ] = useState(false);
  const [resolvedPrice,      setResolvedPrice     ] = useState<NdisPriceResolution | null>(null);
  const [showPriceEditor,    setShowPriceEditor   ] = useState(false);
  const [showScheduleLoader, setShowScheduleLoader] = useState(false);

  const [form, setForm] = useState({
    participant_id: "",
    item_code: "", recipient_name: "", recipient_email: "",
    description: translate("billing.defaultDescription"), quantity: "1",
    unit_amount: "120", due_date: "",
  });

  const participantsQuery = useGetParticipants();
  const participants = useMemo(() => {
    const raw = participantsQuery.data;
    if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
    if (raw && typeof raw === "object" && Array.isArray((raw as { data?: unknown }).data)) {
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
        recipient_email: String(participant.case_manager_email || participant.case_manager_phone || ""),
      };
    }
    return {
      recipient_name: String(participant.full_name || ""),
      recipient_email: String(participant.email || ""),
    };
  }

  async function onParticipantChange(value: string) {
    if (value === "__none__") {
      setForm((prev) => ({ ...prev, participant_id: "", recipient_name: "", recipient_email: "" }));
      return;
    }
    const participant = participants.find((p) => String(p.id) === value);
    if (!participant) {
      setForm((prev) => ({ ...prev, participant_id: value }));
      return;
    }
    try {
      const period = await getParticipantCurrentBillingPeriod(value);
      const lockedType = period.open_period?.locked_plan_management_type ?? period.current_plan_management_type;
      const routed = routingRecipient(participant, lockedType);
      setForm((prev) => ({
        ...prev,
        participant_id: value,
        recipient_name: routed.recipient_name,
        recipient_email: routed.recipient_email,
      }));
    } catch {
      const routed = routingRecipient(participant, String(participant.plan_management_type || ""));
      setForm((prev) => ({
        ...prev,
        participant_id: value,
        recipient_name: routed.recipient_name,
        recipient_email: routed.recipient_email,
      }));
    }
  }

  const totalOutstanding = useMemo(
    () => invoices.filter(inv => !["paid", "void"].includes(inv.status)).reduce((s, inv) => s + inv.total_cents, 0),
    [invoices],
  );
  const totalPaid = useMemo(
    () => invoices.filter(inv => inv.status === "paid").reduce((s, inv) => s + inv.total_cents, 0),
    [invoices],
  );

  async function loadBilling() {
    setLoading(true);
    try {
      const r = await apiFetch("/api/billing/invoices");
      if (!r.ok) throw new Error("Could not load invoices.");
      setInvoices(await r.json());
      if (isCoordinator) {
        const s = await apiFetch("/api/billing/subscription");
        if (!s.ok) throw new Error("Could not load subscription.");
        setSubscription(await s.json());
      }
    } catch (err) {
      toast({ title: translate("billing.toast.unavailable"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function resolveItemPrice(itemCode: string) {
    if (!itemCode.trim()) {
      setResolvedPrice(null);
      return;
    }
    setResolvingPrice(true);
    try {
      const resolved = await resolveNdisPrice(itemCode, new Date().toISOString().split("T")[0], "national");
      setResolvedPrice(resolved);
      // Auto-populate unit_amount with resolved price in dollars
      setForm(prev => ({
        ...prev,
        unit_amount: (resolved.effective_price / 100).toFixed(2),
      }));
    } catch (err) {
      // If resolution fails, just clear the resolved price. Allow user to continue with manual entry.
      toast({ title: translate("billing.toast.priceLookup"), description: translateParams("billing.toast.priceNotFound", { message: (err as Error).message }), variant: "destructive" });
      setResolvedPrice(null);
      setForm(prev => ({ ...prev, unit_amount: "120" })); // Reset to default
    } finally {
      setResolvingPrice(false);
    }
  }

  useEffect(() => { if (canInvoice) void loadBilling(); }, [canInvoice, isCoordinator]);

  async function saveSubscription() {
    if (!subscription) return;
    setSavingSubscription(true);
    try {
      const res = await requireReAuth(() => apiFetch("/api/billing/subscription", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription),
      }));
      if (!res) return;
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || "Could not save."); }
      setSubscription(await res.json());
      toast({ title: translate("billing.toast.subscriptionSaved") });
    } catch (err) {
      toast({ title: translate("billing.toast.saveFailed"), description: (err as Error).message, variant: "destructive" });
    } finally { setSavingSubscription(false); }
  }

  async function createInvoice() {
    setCreatingInvoice(true);
    try {
      const res = await apiFetch("/api/billing/invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participant_id: form.participant_id || null,
          recipient_name: form.recipient_name,
          recipient_email: form.recipient_email || null,
          due_date: form.due_date || null,
          status: "draft",
          line_items: [{ 
            description: form.description, 
            quantity: Number(form.quantity || 1), 
            unit_amount: Number(form.unit_amount || 0),
            item_code: isCoordinator && form.item_code?.trim() ? form.item_code : null,
          }],
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || "Could not create invoice."); }
      const inv = await res.json();
      setInvoices(prev => [inv, ...prev]);
      setForm(prev => ({ ...prev, participant_id: "", recipient_name: "", recipient_email: "", item_code: "" }));
      setResolvedPrice(null);
      toast({ title: translate("billing.toast.draftCreated"), description: inv.invoice_number });
    } catch (err) {
      toast({ title: translate("billing.toast.invoiceFailed"), description: (err as Error).message, variant: "destructive" });
    } finally { setCreatingInvoice(false); }
  }

  async function markPaid(invoice: Invoice) {
    try {
      const res = await requireReAuth(() => apiFetch(`/api/billing/invoices/${invoice.id}/mark-paid`, { method: "POST" }));
      if (!res) return;
      if (!res.ok) throw new Error("Could not mark paid.");
      const updated = await res.json();
      setInvoices(prev => prev.map(i => i.id === updated.id ? updated : i));
      toast({ title: translate("billing.toast.markedPaid"), description: updated.invoice_number });
    } catch (err) {
      toast({ title: translate("billing.toast.updateFailed"), description: (err as Error).message, variant: "destructive" });
    }
  }

  async function invoiceAction(invoice: Invoice, action: "finalize" | "mark-sent" | "cancel" | "pdf") {
    try {
      const res = await requireReAuth(() => apiFetch(`/api/billing/invoices/${invoice.id}/${action}`, { method: "POST" }));
      if (!res) return;
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || "Action failed."); }
      const updated = await res.json();
      setInvoices(prev => prev.map(i => i.id === updated.id ? updated : i));
      toast({ title: translate("billing.toast.invoiceUpdated"), description: updated.invoice_number });
      if (action === "pdf" && updated.pdf_url) window.open(updated.pdf_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: translate("billing.toast.actionFailed"), description: (err as Error).message, variant: "destructive" });
    }
  }

  if (!canInvoice) {
    return (
      <div className="space-y-2 py-10">
        <h1 className="text-xl font-black text-cc-plum">{translate("billing.title")}</h1>
        <p className="text-sm font-medium text-cc-muted">{translate("billing.restricted")}</p>
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

  const liveTotal = Number(form.quantity || 0) * Number(form.unit_amount || 0) * 100;

  return (
    <>
      {modal}
      <div className="space-y-6 pb-10">

        {/* ── Page header ───────────────────────────────────────────────────── */}
        <div>
          <p className="hidden text-cc-muted">
            {user?.role === "allied_health" ? translate("billing.role.alliedHealth") : translate("billing.role.coordinator")}
          </p>
          <h1 className="text-xl font-black tracking-tight text-cc-plum">
            {translate("billing.title")}
          </h1>
        </div>

        {/* ── Inline stat strip ─────────────────────────────────────────────── */}
        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-cc-border bg-white px-5 py-4"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-cc-text">{invoices.length}</span>
            <span className="text-sm font-medium text-cc-muted">{translate("billing.stat.invoices")}</span>
          </div>
          <div className="h-4 w-px bg-cc-border" />
          <div className="flex items-center gap-2">
            <span className={`text-sm font-black ${totalOutstanding > 0 ? "text-amber-600" : "text-cc-text"}`}>
              {cents(totalOutstanding)}
            </span>
            <span className="text-sm font-medium text-cc-muted">{translate("billing.stat.outstanding")}</span>
          </div>
          <div className="h-4 w-px bg-cc-border" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-emerald-700">{cents(totalPaid)}</span>
            <span className="text-sm font-medium text-cc-muted">{translate("billing.stat.paid")}</span>
          </div>
        </div>

        {/* ── Subscription management (coordinator only) ────────────────────── */}
        {isCoordinator && subscription && (
          <Card
            title={translate("billing.subscription")}
            action={
              <button
                onClick={saveSubscription}
                disabled={savingSubscription}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black text-white bg-cc-plum shadow-sm transition hover:opacity-90 disabled:opacity-60"
              >
                {savingSubscription ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                {translate("common.save")}
              </button>
            }
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.plan")}</Label>
                <select
                  title={translate("billing.plan")}
                  value={subscription.plan_name}
                  onChange={e => setSubscription({ ...subscription, plan_name: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-lg border border-cc-border px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#E8457A]/20"
                >
                  {["starter", "team", "pro", "enterprise"].map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.status")}</Label>
                <select
                  title={translate("billing.status")}
                  value={subscription.status}
                  onChange={e => setSubscription({ ...subscription, status: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-lg border border-cc-border px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#E8457A]/20"
                >
                  {["trialing", "active", "past_due", "cancelled", "manual_review"].map(s => (
                    <option key={s} value={s}>{s.replace("_", " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.seats")}</Label>
                <Input type="number" min={1} value={subscription.seats} onChange={e => setSubscription({ ...subscription, seats: Number(e.target.value) })} className="mt-1.5 rounded-lg border-cc-border" />
              </div>
              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.monthly")}</Label>
                <Input type="number" min={0} value={(subscription.price_cents || 0) / 100} onChange={e => setSubscription({ ...subscription, price_cents: Math.round(Number(e.target.value || 0) * 100) })} className="mt-1.5 rounded-lg border-cc-border" />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.billingEmail")}</Label>
                <Input value={subscription.billing_email || ""} onChange={e => setSubscription({ ...subscription, billing_email: e.target.value })} className="mt-1.5 rounded-lg border-cc-border" />
              </div>
              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.renewalDate")}</Label>
                <Input type="date" value={subscription.renewal_date || ""} onChange={e => setSubscription({ ...subscription, renewal_date: e.target.value })} className="mt-1.5 rounded-lg border-cc-border" />
              </div>
              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.provider")}</Label>
                <Input value={subscription.payment_provider || "manual"} readOnly className="mt-1.5 rounded-lg border-cc-border bg-cc-soft" />
              </div>
            </div>
          </Card>
        )}

        {/* NDIS Pricing Administration — Coordinator Only */}
        {isCoordinator && (
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
                  className="flex-1 rounded-full px-4 py-2.5 text-sm font-bold text-white bg-cc-plum transition hover:opacity-90"
                >
                  {translate("billing.loadSchedule")}
                </button>
                <button
                  onClick={() => setShowPriceEditor(true)}
                  className="flex-1 rounded-full px-4 py-2.5 text-sm font-bold text-white bg-cc-coral transition hover:opacity-90"
                >
                  {translate("billing.editItemPrice")}
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Main grid: form + register ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6">

          {/* Invoice form */}
          <Card title={user?.role === "allied_health" ? translate("billing.newInvoice") : translate("billing.issueInvoice")}>
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.participant")}</Label>
                <Select
                  value={form.participant_id || "__none__"}
                  onValueChange={onParticipantChange}
                >
                  <SelectTrigger className="mt-1.5 rounded-lg border-cc-border" data-testid="select-billing-participant">
                    <SelectValue placeholder={translate("billing.participantPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{translate("billing.participantPlaceholder")}</SelectItem>
                    {participants.map((p) => (
                      <SelectItem key={String(p.id)} value={String(p.id)}>
                        {String(p.full_name ?? "Participant")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.participant_id && (
                <div className="rounded-lg border border-cc-border bg-cc-soft px-3 py-2.5 space-y-2" role="status">
                  <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-cc-muted">
                    <Lock className="h-3.5 w-3.5" />
                    {translate("billing.lockedRouting")}
                  </div>
                  {billingPeriodQuery.isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-cc-plum" />
                  ) : (
                    <>
                      <p className="text-xs text-cc-muted">{translate("billing.lockedRoutingHint")}</p>
                      <div className="grid grid-cols-1 gap-1.5 text-sm">
                        <p>
                          <span className="font-semibold text-cc-muted">{translate("billing.currentPlanType")}: </span>
                          <span className="font-bold text-cc-text">
                            {planManagementTypeLabel(billingPeriodQuery.data?.current_plan_management_type, translate)}
                          </span>
                        </p>
                        <p>
                          <span className="font-semibold text-cc-muted">{translate("billing.lockedPlanType")}: </span>
                          <span className="font-bold text-cc-text">
                            {planManagementTypeLabel(
                              billingPeriodQuery.data?.open_period?.locked_plan_management_type
                                ?? billingPeriodQuery.data?.current_plan_management_type,
                              translate,
                            )}
                          </span>
                        </p>
                      </div>
                      {billingPeriodQuery.data?.type_differs_from_lock && (
                        <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                          {billingPeriodQuery.data.message ?? translate("billing.routingMismatch")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.recipientName")}</Label>
                <Input value={form.recipient_name} onChange={e => setForm({ ...form, recipient_name: e.target.value })} className="mt-1.5 rounded-lg border-cc-border" placeholder={translate("billing.recipientNamePlaceholder")} />
              </div>
              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.recipientEmail")} <span className="font-medium">({translate("common.optional")})</span></Label>
                <Input type="email" value={form.recipient_email} onChange={e => setForm({ ...form, recipient_email: e.target.value })} className="mt-1.5 rounded-lg border-cc-border" />
              </div>
              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.description")}</Label>
                <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1.5 rounded-lg border-cc-border" />
              </div>

              {/* NDIS Item Code Picker — Coordinator Only */}
              {isCoordinator && (
                <div>
                  <Label className="text-xs font-bold flex items-center gap-1.5 text-cc-muted">
                    {translate("billing.ndisItemCode")} <span className="font-normal">({translate("common.optional")})</span>
                  </Label>
                  <div className="flex gap-2 mt-1.5">
                    <Input 
                      value={form.item_code} 
                      onChange={e => setForm({ ...form, item_code: e.target.value })}
                      onBlur={e => resolveItemPrice(e.target.value)}
                      className="mt-0 rounded-lg flex-1 border-cc-border" 
                      placeholder={translate("billing.ndisItemCodePlaceholder")}
                    />
                    {resolvingPrice && <Loader2 className="w-5 h-5 animate-spin mt-1.5 text-cc-plum" />}
                  </div>
                  {resolvedPrice && (
                    <div className="mt-2 rounded-lg px-3 py-2 text-xs bg-emerald-50 border border-emerald-200 flex items-center gap-1.5 text-emerald-700">
                      <Zap className="w-3.5 h-3.5" />
                      <span className="font-medium">
                        {translateParams("billing.priceResolved", {
                          name: resolvedPrice.name,
                          price: (resolvedPrice.effective_price / 100).toFixed(2),
                          source: translate(resolvedPrice.effective_price_source === "calculated_multiplier" ? "billing.priceSource.calculated" : "billing.priceSource.explicit"),
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div>
                  <Label className="text-xs font-bold text-cc-muted">{translate("billing.quantity")}</Label>
                  <Input type="number" min={0.1} step={0.1} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="mt-1.5 rounded-lg border-cc-border" />
                </div>
                <div>
                  <Label className="text-xs font-bold flex items-center justify-between text-cc-muted">
                    {translate("billing.unitAmount")} 
                    {resolvedPrice && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{translate("billing.resolved")}</span>}
                  </Label>
                  <Input type="number" min={0} step={0.01} value={form.unit_amount} onChange={e => setForm({ ...form, unit_amount: e.target.value })} className="mt-1.5 rounded-lg border-cc-border" />
                </div>
              </div>

              {/* Running total */}
              <div className="rounded-lg px-4 py-3 flex items-center justify-between bg-cc-soft border border-cc-border">
                <span className="text-xs font-black uppercase tracking-[0.15em] text-cc-muted">{translate("billing.invoiceTotal")}</span>
                <span className="text-lg font-black text-cc-text">{cents(liveTotal)}</span>
              </div>

              <div>
                <Label className="text-xs font-bold text-cc-muted">{translate("billing.dueDate")} <span className="font-medium">({translate("common.optional")})</span></Label>
                <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="mt-1.5 rounded-lg border-cc-border" />
              </div>

              <button
                onClick={createInvoice}
                disabled={creatingInvoice || !form.recipient_name.trim() || !form.description.trim()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full py-3 text-sm font-black text-white bg-cc-plum shadow-sm transition hover:opacity-95 disabled:opacity-50"
              >
                {creatingInvoice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {translate("billing.createDraft")}
              </button>
            </div>
          </Card>

          {/* Invoice register + revenue */}
          <div className="space-y-6">
            <Card title={translate("billing.invoiceRegister")} action={
              invoices.length > 0
                ? <span className="rounded-full px-3 py-1 text-xs font-black bg-cc-soft text-cc-plum">{translateParams("billing.registerTotal", { count: String(invoices.length) })}</span>
                : undefined
            }>
              {invoices.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm font-black text-cc-text">{translate("billing.noInvoices")}</p>
                  <p className="mt-1 text-sm font-medium text-cc-muted">
                    {translate("billing.noInvoicesHint")}
                  </p>
                </div>
              ) : (
                <div className="divide-y border-cc-border">
                  {invoices.map(invoice => (
                    <div key={invoice.id} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                      {/* Initials circle */}
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-black text-white bg-cc-plum">
                        {invoice.recipient_name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-black text-cc-text">{invoice.recipient_name}</p>
                          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusTone(invoice.status)}`}>
                            {invoice.status}
                          </span>
                        </div>
                        <p className="text-xs font-medium mt-0.5 truncate text-cc-muted">
                          {invoice.invoice_number}{invoice.due_date ? ` · ${translateParams("billing.due", { date: invoice.due_date })}` : ""}
                        </p>
                      </div>

                      {/* Amount */}
                      <p className="text-sm font-black shrink-0 text-cc-text">
                        {cents(invoice.total_cents, invoice.currency)}
                      </p>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {invoice.status === "draft" && (
                          <Button variant="outline" size="sm" className="rounded-full text-xs h-7 px-3" onClick={() => invoiceAction(invoice, "finalize")}>{translate("billing.action.finalize")}</Button>
                        )}
                        {["finalized", "issued"].includes(invoice.status) && (
                          <Button variant="outline" size="sm" className="rounded-full text-xs h-7 px-3" onClick={() => invoiceAction(invoice, "mark-sent")}>{translate("billing.action.markSent")}</Button>
                        )}
                        {!["paid", "void", "cancelled"].includes(invoice.status) && (
                          <Button variant="outline" size="sm" className="rounded-full text-xs h-7 px-3" onClick={() => markPaid(invoice)}>{translate("billing.action.paid")}</Button>
                        )}
                        <Button variant="ghost" size="sm" className="rounded-full text-xs h-7 px-3" onClick={() => invoiceAction(invoice, "pdf")}>{translate("billing.action.pdf")}</Button>
                        {!["paid", "void", "cancelled"].includes(invoice.status) && (
                          <Button variant="ghost" size="sm" className="rounded-full text-xs h-7 px-3 text-red-500" onClick={() => invoiceAction(invoice, "cancel")}>{translate("billing.action.cancel")}</Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {isCoordinator && <RevenueReportPanel />}
          </div>
        </div>

        {/* Modals — Coordinator Only */}
        {showPriceEditor && <NdisPriceEditor onClose={() => setShowPriceEditor(false)} />}
        {showScheduleLoader && <NdisScheduleLoader onClose={() => setShowScheduleLoader(false)} onSuccess={() => loadBilling()} />}
      </div>
    </>
  );
}

function RevenueReportPanel() {
  const { translate, translateParams } = useAccessibility();
  const { data, isLoading } = useOrgQuery(["billing", "revenue-report"], { queryFn: getRevenueReport });

  function fmt(value?: number | null, currency = "AUD") {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format((value || 0) / 100);
  }

  return (
    <section className="rounded-lg border border-cc-border bg-white shadow-sm">
      <div className="px-6 py-4 border-b border-cc-border flex items-center justify-between gap-4">
        <h2 className="text-lg font-black text-cc-text">{translate("billing.revenueReport")}</h2>
        <TrendingUp size={18} className="text-cc-muted" />
      </div>
      <div className="p-6 space-y-5">
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm font-medium text-cc-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> {translate("billing.revenue.loading")}
          </div>
        ) : !data ? (
          <p className="text-sm font-medium text-cc-muted">{translate("billing.revenue.noData")}</p>
        ) : (
          <>
            {/* Top-line stats */}
            <div className="grid grid-cols-3 gap-4">
              {([
                { labelKey: "billing.revenue.totalBilled",  value: fmt(data.total_billed_cents),      color: "text-cc-text"       },
                { labelKey: "billing.revenue.totalPaid",    value: fmt(data.total_paid_cents),        color: "text-emerald-600"  },
                { labelKey: "billing.revenue.outstanding",   value: fmt(data.total_outstanding_cents), color: (data.total_outstanding_cents ?? 0) > 0 ? "text-amber-600" : "text-cc-text" },
              ] as const).map(({ labelKey, value, color }) => (
                <div key={labelKey} className="rounded-lg p-4 bg-cc-soft border border-cc-border">
                  <p className="text-[11px] font-black uppercase tracking-[0.15em] text-cc-muted">{translate(labelKey)}</p>
                  <p className={`mt-2 text-base font-black ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Monthly breakdown */}
            {data.monthly && data.monthly.length > 0 && (
              <div>
                <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-cc-muted">{translate("billing.revenue.monthlyBreakdown")}</p>
                <div className="divide-y rounded-lg border border-cc-border overflow-hidden">
                  {data.monthly.slice(0, 6).map(m => {
                    const billed   = m.billed ?? 0;
                    const paid     = m.paid   ?? 0;
                    const paidPct  = billed > 0 ? Math.round((paid / billed) * 100) : 0;
                    return (
                      <div key={m.month} className="flex items-center gap-4 px-4 py-3 hover:bg-[#F8F6FE] transition-colors">
                        <p className="text-sm font-black w-20 shrink-0 text-cc-text">{m.month}</p>
                        <div className="flex-1 min-w-0">
                          <div className="h-1.5 overflow-hidden rounded-full bg-[#EDE3FC]">
                            <div className="h-full rounded-full bg-emerald-600" style={{ width: `${paidPct}%` }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-black text-cc-text">{fmt(billed)}</p>
                          <p className="text-[10px] font-medium text-cc-muted">{translateParams("billing.revenue.invCount", { count: String(m.count), pct: String(paidPct) })}</p>
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

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, TrendingUp, Zap, Settings } from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getRevenueReport } from "@/services/coordinatorService";
import { resolveNdisPrice, type NdisPriceResolution } from "@/services/ndisService";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <section className="rounded-xl border bg-white" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between gap-4 border-b px-5 py-3.5" style={{ borderColor: BORDER }}>
        <h2 className="text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export default function Billing() {
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
    item_code: "", recipient_name: "", recipient_email: "",
    description: "NDIS support service", quantity: "1",
    unit_amount: "120", due_date: "",
  });

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
      toast({ title: "Billing unavailable", description: (err as Error).message, variant: "destructive" });
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
      toast({ title: "Price lookup", description: `Item code not found: ${(err as Error).message}`, variant: "destructive" });
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
      toast({ title: "Subscription saved" });
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally { setSavingSubscription(false); }
  }

  async function createInvoice() {
    setCreatingInvoice(true);
    try {
      const res = await apiFetch("/api/billing/invoices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      setForm(prev => ({ ...prev, recipient_name: "", recipient_email: "", item_code: "" }));
      setResolvedPrice(null);
      toast({ title: "Draft invoice created", description: inv.invoice_number });
    } catch (err) {
      toast({ title: "Invoice failed", description: (err as Error).message, variant: "destructive" });
    } finally { setCreatingInvoice(false); }
  }

  async function markPaid(invoice: Invoice) {
    try {
      const res = await requireReAuth(() => apiFetch(`/api/billing/invoices/${invoice.id}/mark-paid`, { method: "POST" }));
      if (!res) return;
      if (!res.ok) throw new Error("Could not mark paid.");
      const updated = await res.json();
      setInvoices(prev => prev.map(i => i.id === updated.id ? updated : i));
      toast({ title: "Marked paid", description: updated.invoice_number });
    } catch (err) {
      toast({ title: "Update failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  async function invoiceAction(invoice: Invoice, action: "finalize" | "mark-sent" | "cancel" | "pdf") {
    try {
      const res = await requireReAuth(() => apiFetch(`/api/billing/invoices/${invoice.id}/${action}`, { method: "POST" }));
      if (!res) return;
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || "Action failed."); }
      const updated = await res.json();
      setInvoices(prev => prev.map(i => i.id === updated.id ? updated : i));
      toast({ title: "Invoice updated", description: updated.invoice_number });
      if (action === "pdf" && updated.pdf_url) window.open(updated.pdf_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    }
  }

  if (!canInvoice) {
    return (
      <div className="mx-auto max-w-2xl space-y-2 py-10">
        <h1 className="text-xl font-black" style={{ color: PLUM }}>Billing & Invoicing</h1>
        <p className="text-sm font-medium" style={{ color: MUTED }}>Available to support coordinators and allied health professionals only.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[360px] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: PLUM }} />
      </div>
    );
  }

  const liveTotal = Number(form.quantity || 0) * Number(form.unit_amount || 0) * 100;

  return (
    <>
      {modal}
      <div className="mx-auto max-w-7xl space-y-6 pb-10">

        {/* ── Page header ───────────────────────────────────────────────────── */}
        <div>
          <p className="hidden" style={{ color: MUTED }}>
            {user?.role === "allied_health" ? "Allied Health" : "Support Coordination"}
          </p>
          <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>
            Billing & Invoicing
          </h1>
        </div>

        {/* ── Inline stat strip ─────────────────────────────────────────────── */}
        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-white px-5 py-4"
          style={{ borderColor: BORDER }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-black" style={{ color: TEXT }}>{invoices.length}</span>
            <span className="text-sm font-medium" style={{ color: MUTED }}>total invoices</span>
          </div>
          <div className="h-4 w-px" style={{ background: BORDER }} />
          <div className="flex items-center gap-2">
            <span className="text-sm font-black" style={{ color: totalOutstanding > 0 ? "#D97706" : TEXT }}>
              {cents(totalOutstanding)}
            </span>
            <span className="text-sm font-medium" style={{ color: MUTED }}>outstanding</span>
          </div>
          <div className="h-4 w-px" style={{ background: BORDER }} />
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-emerald-700">{cents(totalPaid)}</span>
            <span className="text-sm font-medium" style={{ color: MUTED }}>paid</span>
          </div>
        </div>

        {/* ── Subscription management (coordinator only) ────────────────────── */}
        {isCoordinator && subscription && (
          <Card
            title="Subscription"
            action={
              <button
                onClick={saveSubscription}
                disabled={savingSubscription}
                className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-black text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                style={{ background: PLUM }}
              >
                {savingSubscription ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save
              </button>
            }
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Plan</Label>
                <select
                  value={subscription.plan_name}
                  onChange={e => setSubscription({ ...subscription, plan_name: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-lg border px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3730A3]/20"
                  style={{ borderColor: BORDER }}
                >
                  {["starter", "team", "pro", "enterprise"].map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Status</Label>
                <select
                  value={subscription.status}
                  onChange={e => setSubscription({ ...subscription, status: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-lg border px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#3730A3]/20"
                  style={{ borderColor: BORDER }}
                >
                  {["trialing", "active", "past_due", "cancelled", "manual_review"].map(s => (
                    <option key={s} value={s}>{s.replace("_", " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Seats</Label>
                <Input type="number" min={1} value={subscription.seats} onChange={e => setSubscription({ ...subscription, seats: Number(e.target.value) })} className="mt-1.5 rounded-lg" style={{ borderColor: BORDER }} />
              </div>
              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Monthly ($)</Label>
                <Input type="number" min={0} value={(subscription.price_cents || 0) / 100} onChange={e => setSubscription({ ...subscription, price_cents: Math.round(Number(e.target.value || 0) * 100) })} className="mt-1.5 rounded-lg" style={{ borderColor: BORDER }} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Billing email</Label>
                <Input value={subscription.billing_email || ""} onChange={e => setSubscription({ ...subscription, billing_email: e.target.value })} className="mt-1.5 rounded-lg" style={{ borderColor: BORDER }} />
              </div>
              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Renewal date</Label>
                <Input type="date" value={subscription.renewal_date || ""} onChange={e => setSubscription({ ...subscription, renewal_date: e.target.value })} className="mt-1.5 rounded-lg" style={{ borderColor: BORDER }} />
              </div>
              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Provider</Label>
                <Input value={subscription.payment_provider || "manual"} readOnly className="mt-1.5 rounded-lg" style={{ borderColor: BORDER, background: SOFT }} />
              </div>
            </div>
          </Card>
        )}

        {/* NDIS Pricing Administration — Coordinator Only */}
        {isCoordinator && (
          <Card 
            title="NDIS Pricing"
            action={<Settings size={18} style={{ color: MUTED }} />}
          >
            <div className="space-y-3">
              <p className="text-xs font-medium" style={{ color: MUTED }}>
                Manage pricing schedules and individual item prices for NDIS invoicing.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => setShowScheduleLoader(true)}
                  className="flex-1 rounded-full px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
                  style={{ background: PLUM }}
                >
                  Load Annual Schedule
                </button>
                <button
                  onClick={() => setShowPriceEditor(true)}
                  className="flex-1 rounded-full px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90"
                  style={{ background: CORAL }}
                >
                  Edit Item Price
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* ── Main grid: form + register ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6">

          {/* Invoice form */}
          <Card title={user?.role === "allied_health" ? "New Invoice" : "Issue Invoice"}>
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Recipient name</Label>
                <Input value={form.recipient_name} onChange={e => setForm({ ...form, recipient_name: e.target.value })} className="mt-1.5 rounded-lg" placeholder="e.g. Jane Smith" style={{ borderColor: BORDER }} />
              </div>
              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Recipient email <span className="font-medium">(optional)</span></Label>
                <Input type="email" value={form.recipient_email} onChange={e => setForm({ ...form, recipient_email: e.target.value })} className="mt-1.5 rounded-lg" style={{ borderColor: BORDER }} />
              </div>
              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Description</Label>
                <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1.5 rounded-lg" style={{ borderColor: BORDER }} />
              </div>

              {/* NDIS Item Code Picker — Coordinator Only */}
              {isCoordinator && (
                <div>
                  <Label className="text-xs font-bold flex items-center gap-1.5" style={{ color: MUTED }}>
                    NDIS Item Code <span className="font-normal">(optional)</span>
                  </Label>
                  <div className="flex gap-2 mt-1.5">
                    <Input 
                      value={form.item_code} 
                      onChange={e => setForm({ ...form, item_code: e.target.value })}
                      onBlur={e => resolveItemPrice(e.target.value)}
                      className="mt-0 rounded-lg flex-1" 
                      placeholder="e.g. 01_011_0107_1_1"
                      style={{ borderColor: BORDER }} 
                    />
                    {resolvingPrice && <Loader2 className="w-5 h-5 animate-spin mt-1.5" style={{ color: PLUM }} />}
                  </div>
                  {resolvedPrice && (
                    <div className="mt-2 rounded-lg px-3 py-2 text-xs bg-emerald-50 border border-emerald-200 flex items-center gap-1.5" style={{ color: "#059669" }}>
                      <Zap className="w-3.5 h-3.5" />
                      <span className="font-medium">
                        {resolvedPrice.name} · ${(resolvedPrice.effective_price / 100).toFixed(2)}/h ({resolvedPrice.effective_price_source === "calculated_multiplier" ? "national + multiplier" : "explicit"})
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div>
                  <Label className="text-xs font-bold" style={{ color: MUTED }}>Quantity</Label>
                  <Input type="number" min={0.1} step={0.1} value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} className="mt-1.5 rounded-lg" style={{ borderColor: BORDER }} />
                </div>
                <div>
                  <Label className="text-xs font-bold flex items-center justify-between" style={{ color: MUTED }}>
                    Unit amount ($) 
                    {resolvedPrice && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Resolved</span>}
                  </Label>
                  <Input type="number" min={0} step={0.01} value={form.unit_amount} onChange={e => setForm({ ...form, unit_amount: e.target.value })} className="mt-1.5 rounded-lg" style={{ borderColor: BORDER }} />
                </div>
              </div>

              {/* Running total */}
              <div className="rounded-lg px-4 py-3 flex items-center justify-between" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
                <span className="text-xs font-black uppercase tracking-[0.15em]" style={{ color: MUTED }}>Invoice total</span>
                <span className="text-lg font-black" style={{ color: TEXT }}>{cents(liveTotal)}</span>
              </div>

              <div>
                <Label className="text-xs font-bold" style={{ color: MUTED }}>Due date <span className="font-medium">(optional)</span></Label>
                <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="mt-1.5 rounded-lg" style={{ borderColor: BORDER }} />
              </div>

              <button
                onClick={createInvoice}
                disabled={creatingInvoice || !form.recipient_name.trim() || !form.description.trim()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full py-3 text-sm font-black text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
                style={{ background: PLUM }}
              >
                {creatingInvoice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create Draft Invoice
              </button>
            </div>
          </Card>

          {/* Invoice register + revenue */}
          <div className="space-y-6">
            <Card title="Invoice Register" action={
              invoices.length > 0
                ? <span className="rounded-full px-3 py-1 text-xs font-black" style={{ background: SOFT, color: PLUM }}>{invoices.length} total</span>
                : undefined
            }>
              {invoices.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-sm font-black" style={{ color: TEXT }}>No invoices yet</p>
                  <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
                    Draft an invoice on the left and it will appear here.
                  </p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "#EEEAFB" }}>
                  {invoices.map(invoice => (
                    <div key={invoice.id} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                      {/* Initials circle */}
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: PLUM }}>
                        {invoice.recipient_name.split(" ").map(p => p[0]).join("").slice(0, 2).toUpperCase()}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-black" style={{ color: TEXT }}>{invoice.recipient_name}</p>
                          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusTone(invoice.status)}`}>
                            {invoice.status}
                          </span>
                        </div>
                        <p className="text-xs font-medium mt-0.5 truncate" style={{ color: MUTED }}>
                          {invoice.invoice_number}{invoice.due_date ? ` · Due ${invoice.due_date}` : ""}
                        </p>
                      </div>

                      {/* Amount */}
                      <p className="text-sm font-black shrink-0" style={{ color: TEXT }}>
                        {cents(invoice.total_cents, invoice.currency)}
                      </p>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {invoice.status === "draft" && (
                          <Button variant="outline" size="sm" className="rounded-full text-xs h-7 px-3" onClick={() => invoiceAction(invoice, "finalize")}>Finalize</Button>
                        )}
                        {["finalized", "issued"].includes(invoice.status) && (
                          <Button variant="outline" size="sm" className="rounded-full text-xs h-7 px-3" onClick={() => invoiceAction(invoice, "mark-sent")}>Mark sent</Button>
                        )}
                        {!["paid", "void", "cancelled"].includes(invoice.status) && (
                          <Button variant="outline" size="sm" className="rounded-full text-xs h-7 px-3" onClick={() => markPaid(invoice)}>Paid</Button>
                        )}
                        <Button variant="ghost" size="sm" className="rounded-full text-xs h-7 px-3" onClick={() => invoiceAction(invoice, "pdf")}>PDF</Button>
                        {!["paid", "void", "cancelled"].includes(invoice.status) && (
                          <Button variant="ghost" size="sm" className="rounded-full text-xs h-7 px-3 text-red-500" onClick={() => invoiceAction(invoice, "cancel")}>Cancel</Button>
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
  const { data, isLoading } = useOrgQuery(["billing", "revenue-report"], { queryFn: getRevenueReport });

  function fmt(value?: number | null, currency = "AUD") {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format((value || 0) / 100);
  }

  return (
    <section className="rounded-lg border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <div className="px-6 py-4 border-b flex items-center justify-between gap-4" style={{ borderColor: BORDER }}>
        <h2 className="text-lg font-black" style={{ color: TEXT }}>Revenue Report</h2>
        <TrendingUp size={18} style={{ color: MUTED }} />
      </div>
      <div className="p-6 space-y-5">
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm font-medium" style={{ color: MUTED }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !data ? (
          <p className="text-sm font-medium" style={{ color: MUTED }}>No revenue data available.</p>
        ) : (
          <>
            {/* Top-line stats */}
            <div className="grid grid-cols-3 gap-4">
              {([
                { label: "Total Billed",  value: fmt(data.total_billed_cents),      color: TEXT       },
                { label: "Total Paid",    value: fmt(data.total_paid_cents),        color: "#16A34A"  },
                { label: "Outstanding",   value: fmt(data.total_outstanding_cents), color: (data.total_outstanding_cents ?? 0) > 0 ? "#D97706" : TEXT },
              ] as const).map(({ label, value, color }) => (
                <div key={label} className="rounded-lg p-4" style={{ background: SOFT, border: `1px solid ${BORDER}` }}>
                  <p className="text-[11px] font-black uppercase tracking-[0.15em]" style={{ color: MUTED }}>{label}</p>
                  <p className="mt-2 text-base font-black" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Monthly breakdown */}
            {data.monthly && data.monthly.length > 0 && (
              <div>
                <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>Monthly Breakdown</p>
                <div className="divide-y rounded-lg border overflow-hidden" style={{ borderColor: BORDER }}>
                  {data.monthly.slice(0, 6).map(m => {
                    const billed   = m.billed ?? 0;
                    const paid     = m.paid   ?? 0;
                    const paidPct  = billed > 0 ? Math.round((paid / billed) * 100) : 0;
                    return (
                      <div key={m.month} className="flex items-center gap-4 px-4 py-3 hover:bg-[#F8F6FE] transition-colors">
                        <p className="text-sm font-black w-20 shrink-0" style={{ color: TEXT }}>{m.month}</p>
                        <div className="flex-1 min-w-0">
                          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "#EEEAFB" }}>
                            <div className="h-full rounded-full" style={{ width: `${paidPct}%`, background: "#16A34A" }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-black" style={{ color: TEXT }}>{fmt(billed)}</p>
                          <p className="text-[10px] font-medium" style={{ color: MUTED }}>{m.count} inv · {paidPct}% paid</p>
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

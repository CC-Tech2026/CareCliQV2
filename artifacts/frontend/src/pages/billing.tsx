import { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, FileText, Loader2, Plus, ReceiptText, TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getRevenueReport } from "@/services/coordinatorService";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#EBE5F6";
const CARD_SHADOW = "0 2px 12px rgba(85,51,204,0.05), 0 1px 3px rgba(0,0,0,0.03)";

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

// ── Shared card panel component ────────────────────────────────────────────────
function Panel({ label, children, icon: Icon }: {
  label: string;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <section
      className="bg-white rounded-2xl overflow-hidden"
      style={{ border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
    >
      <div
        className="px-5 py-3 border-b flex items-center gap-2"
        style={{
          background: "linear-gradient(to right, rgba(85,51,204,0.05), transparent)",
          borderColor: BORDER,
        }}
      >
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: PLUM }} />}
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: PLUM }}>{label}</p>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

// ── Invoice status badge ───────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string }> = {
    draft:     { color: MUTED,      bg: "rgba(122,106,158,0.1)"  },
    finalized: { color: "#2563EB",  bg: "rgba(37,99,235,0.08)"   },
    issued:    { color: "#D97706",  bg: "rgba(245,158,11,0.08)"  },
    sent:      { color: "#D97706",  bg: "rgba(245,158,11,0.08)"  },
    paid:      { color: "#16A34A",  bg: "rgba(22,163,74,0.08)"   },
    void:      { color: MUTED,      bg: "rgba(122,106,158,0.08)" },
    cancelled: { color: "#DC2626",  bg: "rgba(239,68,68,0.08)"   },
  };
  const cfg = map[status] ?? map.draft;
  return (
    <span
      className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {status}
    </span>
  );
}

export default function Billing() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { requireReAuth, modal } = useReAuth();
  const isCoordinator = user?.role === "support_coordinator";
  const canInvoice = user?.role === "support_coordinator" || user?.role === "allied_health";
  const [loading, setLoading] = useState(true);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const [invoiceForm, setInvoiceForm] = useState({
    recipient_name: "", recipient_email: "",
    description: "NDIS support service", quantity: "1",
    unit_amount: "120", due_date: "", notes: "",
  });

  const totalOutstanding = useMemo(
    () => invoices.filter(inv => !["paid", "void"].includes(inv.status)).reduce((sum, inv) => sum + inv.total_cents, 0),
    [invoices],
  );
  const totalPaid = useMemo(
    () => invoices.filter(inv => inv.status === "paid").reduce((sum, inv) => sum + inv.total_cents, 0),
    [invoices],
  );

  async function loadBilling() {
    setLoading(true);
    try {
      const invoiceRes = await apiFetch("/api/billing/invoices");
      if (!invoiceRes.ok) throw new Error("Could not load invoices.");
      setInvoices(await invoiceRes.json());

      if (isCoordinator) {
        const subRes = await apiFetch("/api/billing/subscription");
        if (!subRes.ok) throw new Error("Could not load subscription.");
        setSubscription(await subRes.json());
      }
    } catch (error) {
      toast({
        title: "Billing unavailable",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canInvoice) void loadBilling();
  }, [canInvoice, isCoordinator]);

  async function saveSubscription() {
    if (!subscription) return;
    setSavingSubscription(true);
    try {
      const res = await requireReAuth(() => apiFetch("/api/billing/subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription),
      }));
      if (!res) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Could not save subscription.");
      }
      setSubscription(await res.json());
      toast({ title: "Subscription saved" });
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setSavingSubscription(false);
    }
  }

  async function createInvoice() {
    setCreatingInvoice(true);
    try {
      const res = await apiFetch("/api/billing/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_name: invoiceForm.recipient_name,
          recipient_email: invoiceForm.recipient_email || null,
          due_date: invoiceForm.due_date || null,
          notes: invoiceForm.notes || null,
          status: "draft",
          line_items: [{
            description: invoiceForm.description,
            quantity: Number(invoiceForm.quantity || 1),
            unit_amount: Number(invoiceForm.unit_amount || 0),
          }],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Could not create invoice.");
      }
      const invoice = await res.json();
      setInvoices(prev => [invoice, ...prev]);
      setInvoiceForm(prev => ({ ...prev, recipient_name: "", recipient_email: "", notes: "" }));
      toast({ title: "Invoice draft created", description: invoice.invoice_number });
    } catch (error) {
      toast({ title: "Invoice failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setCreatingInvoice(false);
    }
  }

  async function markPaid(invoice: Invoice) {
    try {
      const res = await requireReAuth(() => apiFetch(`/api/billing/invoices/${invoice.id}/mark-paid`, { method: "POST" }));
      if (!res) return;
      if (!res.ok) throw new Error("Could not mark invoice paid.");
      const updated = await res.json();
      setInvoices(prev => prev.map(item => item.id === updated.id ? updated : item));
      toast({ title: "Invoice marked paid", description: updated.invoice_number });
    } catch (error) {
      toast({ title: "Update failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  }

  async function invoiceAction(invoice: Invoice, action: "finalize" | "mark-sent" | "cancel" | "pdf") {
    try {
      const res = await requireReAuth(() => apiFetch(`/api/billing/invoices/${invoice.id}/${action}`, { method: "POST" }));
      if (!res) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Invoice action failed.");
      }
      const updated = await res.json();
      setInvoices(prev => prev.map(item => item.id === updated.id ? updated : item));
      toast({ title: "Invoice updated", description: updated.invoice_number });
      if (action === "pdf" && updated.pdf_url) window.open(updated.pdf_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({ title: "Invoice action failed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  }

  if (!canInvoice) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold" style={{ color: TEXT }}>Billing</h1>
        <p className="mt-2" style={{ color: MUTED }}>Billing and invoicing are available to support coordinators and allied health professionals.</p>
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

  return (
    <>
      {modal}
      <div className="max-w-6xl mx-auto space-y-6">

        {/* ── Page header banner ───────────────────────────────────────────── */}
        <div
          className="rounded-2xl px-6 py-4 flex items-center justify-between gap-4"
          style={{
            background: "linear-gradient(135deg, rgba(85,51,204,0.07) 0%, rgba(240,48,96,0.03) 100%)",
            border: "1px solid rgba(85,51,204,0.1)",
          }}
        >
          <div className="flex items-center gap-4 min-w-0">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(85,51,204,0.1)" }}
            >
              <CreditCard className="h-5 w-5" style={{ color: PLUM }} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[18px] font-bold tracking-tight" style={{ color: TEXT }}>Billing & Invoicing</h1>
              <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>
                Issue and manage NDIS support invoices — records persist after reload
              </p>
            </div>
          </div>

          {/* Quick stat pills */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <div className="rounded-xl bg-white px-4 py-2.5 text-center" style={{ border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Invoices</p>
              <p className="text-[18px] font-black leading-none mt-0.5" style={{ color: TEXT }}>{invoices.length}</p>
            </div>
            <div className="rounded-xl bg-white px-4 py-2.5 text-center" style={{ border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Outstanding</p>
              <p className="text-[18px] font-black leading-none mt-0.5" style={{ color: totalOutstanding > 0 ? "#D97706" : TEXT }}>{cents(totalOutstanding)}</p>
            </div>
            <div className="rounded-xl bg-white px-4 py-2.5 text-center" style={{ border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: MUTED }}>Paid</p>
              <p className="text-[18px] font-black leading-none mt-0.5" style={{ color: "#16A34A" }}>{cents(totalPaid)}</p>
            </div>
          </div>
        </div>

        {/* ── Subscription management (coordinator only) ───────────────────── */}
        {isCoordinator && subscription && (
          <Panel label="Subscription Management" icon={CreditCard}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Plan</Label>
                <select
                  value={subscription.plan_name}
                  onChange={e => setSubscription({ ...subscription, plan_name: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-xl border px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#5533CC]/20"
                  style={{ borderColor: BORDER }}
                >
                  <option value="starter">Starter</option>
                  <option value="team">Team</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Status</Label>
                <select
                  value={subscription.status}
                  onChange={e => setSubscription({ ...subscription, status: e.target.value })}
                  className="mt-1.5 h-10 w-full rounded-xl border px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#5533CC]/20"
                  style={{ borderColor: BORDER }}
                >
                  <option value="trialing">Trialing</option>
                  <option value="active">Active</option>
                  <option value="past_due">Past due</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="manual_review">Manual review</option>
                </select>
              </div>
              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Seats</Label>
                <Input
                  type="number" min={1}
                  value={subscription.seats}
                  onChange={e => setSubscription({ ...subscription, seats: Number(e.target.value) })}
                  className="mt-1.5 rounded-xl"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Monthly amount</Label>
                <Input
                  type="number" min={0}
                  value={(subscription.price_cents || 0) / 100}
                  onChange={e => setSubscription({ ...subscription, price_cents: Math.round(Number(e.target.value || 0) * 100) })}
                  className="mt-1.5 rounded-xl"
                />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Billing email</Label>
                <Input
                  value={subscription.billing_email || ""}
                  onChange={e => setSubscription({ ...subscription, billing_email: e.target.value })}
                  className="mt-1.5 rounded-xl"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Renewal date</Label>
                <Input
                  type="date"
                  value={subscription.renewal_date || ""}
                  onChange={e => setSubscription({ ...subscription, renewal_date: e.target.value })}
                  className="mt-1.5 rounded-xl"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Provider</Label>
                <Input value={subscription.payment_provider || "manual"} readOnly className="mt-1.5 rounded-xl bg-[#F8F6FE]" />
              </div>
            </div>
            <div className="flex justify-end pt-4 border-t mt-4" style={{ borderColor: BORDER }}>
              <Button onClick={saveSubscription} disabled={savingSubscription} className="gap-2 rounded-xl">
                {savingSubscription ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save Subscription
              </Button>
            </div>
          </Panel>
        )}

        {/* ── Main content grid ────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">

          {/* Issue Invoice form */}
          <Panel label={user?.role === "allied_health" ? "Independent Invoice" : "Issue Invoice"} icon={Plus}>
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Recipient name</Label>
                <Input
                  value={invoiceForm.recipient_name}
                  onChange={e => setInvoiceForm({ ...invoiceForm, recipient_name: e.target.value })}
                  className="mt-1.5 rounded-xl"
                  placeholder="e.g. Jane Smith"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Recipient email</Label>
                <Input
                  type="email"
                  value={invoiceForm.recipient_email}
                  onChange={e => setInvoiceForm({ ...invoiceForm, recipient_email: e.target.value })}
                  className="mt-1.5 rounded-xl"
                  placeholder="optional"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Line item description</Label>
                <Input
                  value={invoiceForm.description}
                  onChange={e => setInvoiceForm({ ...invoiceForm, description: e.target.value })}
                  className="mt-1.5 rounded-xl"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs font-semibold" style={{ color: MUTED }}>Quantity</Label>
                  <Input type="number" min={0.1} step={0.1} value={invoiceForm.quantity} onChange={e => setInvoiceForm({ ...invoiceForm, quantity: e.target.value })} className="mt-1.5 rounded-xl" />
                </div>
                <div>
                  <Label className="text-xs font-semibold" style={{ color: MUTED }}>Unit amount ($)</Label>
                  <Input type="number" min={0} step={0.01} value={invoiceForm.unit_amount} onChange={e => setInvoiceForm({ ...invoiceForm, unit_amount: e.target.value })} className="mt-1.5 rounded-xl" />
                </div>
              </div>

              {/* Live total preview */}
              <div
                className="rounded-xl px-4 py-3 flex items-center justify-between"
                style={{ background: "rgba(85,51,204,0.05)", border: `1px solid ${BORDER}` }}
              >
                <span className="text-[12px] font-semibold" style={{ color: MUTED }}>Invoice total</span>
                <span className="text-[16px] font-black" style={{ color: TEXT }}>
                  {cents(Number(invoiceForm.quantity || 0) * Number(invoiceForm.unit_amount || 0) * 100)}
                </span>
              </div>

              <div>
                <Label className="text-xs font-semibold" style={{ color: MUTED }}>Due date</Label>
                <Input type="date" value={invoiceForm.due_date} onChange={e => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} className="mt-1.5 rounded-xl" />
              </div>
              <Button
                onClick={createInvoice}
                disabled={creatingInvoice || !invoiceForm.recipient_name.trim() || !invoiceForm.description.trim()}
                className="w-full gap-2 rounded-xl h-11"
                style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
              >
                {creatingInvoice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create Draft Invoice
              </Button>
            </div>
          </Panel>

          {/* Invoice register */}
          <div className="space-y-6">
            <Panel label="Invoice Register" icon={FileText}>
              {invoices.length === 0 ? (
                <div className="min-h-[220px] flex flex-col items-center justify-center text-center gap-3">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: "rgba(85,51,204,0.06)" }}>
                    <ReceiptText className="h-6 w-6" style={{ color: "rgba(85,51,204,0.4)" }} />
                  </div>
                  <p className="font-bold text-[14px]" style={{ color: TEXT }}>No invoices yet</p>
                  <p className="text-[13px] max-w-[260px]" style={{ color: MUTED }}>Issued invoices will appear here and persist after reload.</p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: BORDER }}>
                  {invoices.map(invoice => (
                    <div key={invoice.id} className="py-3.5 flex items-center gap-4">
                      <div
                        className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: "rgba(85,51,204,0.07)", color: PLUM }}
                      >
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-bold" style={{ color: TEXT }}>{invoice.invoice_number}</p>
                          <StatusBadge status={invoice.status} />
                        </div>
                        <p className="text-[12px] truncate mt-0.5" style={{ color: MUTED }}>
                          {invoice.recipient_name}{invoice.due_date ? ` · Due ${invoice.due_date}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[14px] font-black" style={{ color: TEXT }}>{cents(invoice.total_cents, invoice.currency)}</p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
                        {invoice.status === "draft" && (
                          <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => invoiceAction(invoice, "finalize")}>Finalize</Button>
                        )}
                        {["finalized", "issued"].includes(invoice.status) && (
                          <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => invoiceAction(invoice, "mark-sent")}>Mark sent</Button>
                        )}
                        {!["paid", "void", "cancelled"].includes(invoice.status) && (
                          <Button variant="outline" size="sm" className="rounded-lg text-xs gap-1" onClick={() => markPaid(invoice)}>
                            <CreditCard className="h-3 w-3" /> Paid
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="rounded-lg text-xs" onClick={() => invoiceAction(invoice, "pdf")}>PDF</Button>
                        {!["paid", "void", "cancelled"].includes(invoice.status) && (
                          <Button variant="ghost" size="sm" className="rounded-lg text-xs text-[#F03060]" onClick={() => invoiceAction(invoice, "cancel")}>Cancel</Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {/* Revenue Reporting — Coordinator only */}
            {isCoordinator && <RevenueReportPanel />}
          </div>
        </div>
      </div>
    </>
  );
}

function RevenueReportPanel() {
  const { data, isLoading } = useQuery({ queryKey: ["billing", "revenue-report"], queryFn: getRevenueReport });

  function cents(value?: number | null, currency = "AUD") {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format((value || 0) / 100);
  }

  return (
    <section
      className="bg-white rounded-2xl overflow-hidden"
      style={{ border: `1px solid ${BORDER}`, boxShadow: CARD_SHADOW }}
    >
      <div
        className="px-5 py-3 border-b flex items-center gap-2"
        style={{
          background: "linear-gradient(to right, rgba(85,51,204,0.05), transparent)",
          borderColor: BORDER,
        }}
      >
        <TrendingUp className="h-3.5 w-3.5 shrink-0" style={{ color: PLUM }} />
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: PLUM }}>Revenue Reporting</p>
      </div>
      <div className="p-5 space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-[13px]" style={{ color: MUTED }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading revenue data…
          </div>
        ) : !data ? (
          <p className="text-[13px]" style={{ color: MUTED }}>No revenue data available.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total Billed",  value: cents(data.total_billed_cents),      color: TEXT,      bg: "rgba(85,51,204,0.05)" },
                { label: "Total Paid",    value: cents(data.total_paid_cents),        color: "#16A34A", bg: "rgba(22,163,74,0.06)"  },
                { label: "Outstanding",   value: cents(data.total_outstanding_cents), color: (data.total_outstanding_cents ?? 0) > 0 ? "#D97706" : TEXT, bg: (data.total_outstanding_cents ?? 0) > 0 ? "rgba(245,158,11,0.07)" : "rgba(85,51,204,0.05)" },
              ].map(({ label, value, color, bg }) => (
                <div key={label} className="rounded-xl p-3.5" style={{ background: bg, border: `1px solid ${BORDER}` }}>
                  <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>{label}</p>
                  <p className="text-[15px] font-black leading-none" style={{ color }}>{value}</p>
                </div>
              ))}
            </div>

            {data.monthly && data.monthly.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: MUTED }}>Monthly Breakdown</p>
                <div className="rounded-xl border overflow-hidden divide-y" style={{ borderColor: BORDER }}>
                  {data.monthly.slice(0, 6).map(m => {
                    const billed = m.billed ?? 0;
                    const paid   = m.paid   ?? 0;
                    const paidPct = billed > 0 ? Math.round((paid / billed) * 100) : 0;
                    return (
                      <div key={m.month} className="flex items-center gap-4 px-4 py-3 hover:bg-[#F8F6FE] transition-colors">
                        <p className="text-[13px] font-bold w-20 shrink-0" style={{ color: TEXT }}>{m.month}</p>
                        <div className="flex-1 min-w-0">
                          <div className="h-1.5 rounded-full w-full" style={{ background: BORDER }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${paidPct}%`, background: "#16A34A" }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-[13px] font-black" style={{ color: TEXT }}>{cents(billed)}</p>
                          <p className="text-[10px]" style={{ color: MUTED }}>{m.count} inv · {paidPct}% paid</p>
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

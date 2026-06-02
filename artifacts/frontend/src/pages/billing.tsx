import { useEffect, useMemo, useState } from "react";
import { Check, CreditCard, FileText, Loader2, Plus, ReceiptText } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "rgba(232,213,232,0.7)";

interface Subscription {
  plan_name: string;
  status: string;
  billing_email?: string | null;
  seats: number;
  price_cents: number;
  currency: string;
  renewal_date?: string | null;
  payment_provider?: string | null;
  notes?: string | null;
}

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
  line_items: Array<{ description: string; quantity: number; unit_amount_cents: number; line_total_cents: number }>;
}

function cents(value?: number | null, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format((value || 0) / 100);
}

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
      <div className="px-5 pt-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: MUTED }}>{label}</p>
      </div>
      <div className="p-5 pt-3">{children}</div>
    </section>
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
    recipient_name: "",
    recipient_email: "",
    description: "NDIS support service",
    quantity: "1",
    unit_amount: "120",
    due_date: "",
    notes: "",
  });

  const totalOutstanding = useMemo(
    () => invoices.filter((invoice) => !["paid", "void"].includes(invoice.status)).reduce((sum, invoice) => sum + invoice.total_cents, 0),
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
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
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
      setInvoices((prev) => [invoice, ...prev]);
      setInvoiceForm((prev) => ({ ...prev, recipient_name: "", recipient_email: "", notes: "" }));
      toast({ title: "Invoice draft created", description: invoice.invoice_number });
    } catch (error) {
      toast({
        title: "Invoice failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
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
      setInvoices((prev) => prev.map((item) => item.id === updated.id ? updated : item));
      toast({ title: "Invoice marked paid", description: updated.invoice_number });
    } catch (error) {
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
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
      setInvoices((prev) => prev.map((item) => item.id === updated.id ? updated : item));
      toast({ title: "Invoice updated", description: updated.invoice_number });
      if (action === "pdf" && updated.pdf_url) window.open(updated.pdf_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Invoice action failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
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
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-black tracking-tight" style={{ color: TEXT }}>Billing & Invoicing</h1>
          <p className="text-[14px] mt-1" style={{ color: MUTED }}>
            Manage subscription records and issue persisted invoices without fake payment states.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 min-w-[260px]">
          <div className="rounded-2xl bg-white px-4 py-3" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
            <p className="text-[11px] uppercase font-bold" style={{ color: MUTED }}>Invoices</p>
            <p className="text-xl font-black" style={{ color: TEXT }}>{invoices.length}</p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3" style={{ boxShadow: "0 1px 4px rgba(84,34,105,0.06), 0 0 0 1px rgba(232,213,232,0.5)" }}>
            <p className="text-[11px] uppercase font-bold" style={{ color: MUTED }}>Outstanding</p>
            <p className="text-xl font-black" style={{ color: TEXT }}>{cents(totalOutstanding)}</p>
          </div>
        </div>
      </div>

      {isCoordinator && subscription && (
        <Panel label="Subscription Management">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label className="text-xs">Plan</Label>
              <select
                value={subscription.plan_name}
                onChange={(e) => setSubscription({ ...subscription, plan_name: e.target.value })}
                className="mt-1 h-10 w-full rounded-lg border px-3 text-sm bg-white"
                style={{ borderColor: BORDER }}
              >
                <option value="starter">Starter</option>
                <option value="team">Team</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <select
                value={subscription.status}
                onChange={(e) => setSubscription({ ...subscription, status: e.target.value })}
                className="mt-1 h-10 w-full rounded-lg border px-3 text-sm bg-white"
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
              <Label className="text-xs">Seats</Label>
              <Input
                type="number"
                min={1}
                value={subscription.seats}
                onChange={(e) => setSubscription({ ...subscription, seats: Number(e.target.value) })}
                className="mt-1 rounded-lg"
              />
            </div>
            <div>
              <Label className="text-xs">Monthly amount</Label>
              <Input
                type="number"
                min={0}
                value={(subscription.price_cents || 0) / 100}
                onChange={(e) => setSubscription({ ...subscription, price_cents: Math.round(Number(e.target.value || 0) * 100) })}
                className="mt-1 rounded-lg"
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Billing email</Label>
              <Input
                value={subscription.billing_email || ""}
                onChange={(e) => setSubscription({ ...subscription, billing_email: e.target.value })}
                className="mt-1 rounded-lg"
              />
            </div>
            <div>
              <Label className="text-xs">Renewal date</Label>
              <Input
                type="date"
                value={subscription.renewal_date || ""}
                onChange={(e) => setSubscription({ ...subscription, renewal_date: e.target.value })}
                className="mt-1 rounded-lg"
              />
            </div>
            <div>
              <Label className="text-xs">Provider</Label>
              <Input value={subscription.payment_provider || "manual"} readOnly className="mt-1 rounded-lg bg-slate-50" />
            </div>
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={saveSubscription} disabled={savingSubscription} className="gap-2">
              {savingSubscription ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save Subscription
            </Button>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">
        <Panel label={user?.role === "allied_health" ? "Independent Invoice" : "Issue Invoice"}>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Recipient name</Label>
              <Input value={invoiceForm.recipient_name} onChange={(e) => setInvoiceForm({ ...invoiceForm, recipient_name: e.target.value })} className="mt-1 rounded-lg" />
            </div>
            <div>
              <Label className="text-xs">Recipient email</Label>
              <Input type="email" value={invoiceForm.recipient_email} onChange={(e) => setInvoiceForm({ ...invoiceForm, recipient_email: e.target.value })} className="mt-1 rounded-lg" />
            </div>
            <div>
              <Label className="text-xs">Line item</Label>
              <Input value={invoiceForm.description} onChange={(e) => setInvoiceForm({ ...invoiceForm, description: e.target.value })} className="mt-1 rounded-lg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Quantity</Label>
                <Input type="number" min={0.1} step={0.1} value={invoiceForm.quantity} onChange={(e) => setInvoiceForm({ ...invoiceForm, quantity: e.target.value })} className="mt-1 rounded-lg" />
              </div>
              <div>
                <Label className="text-xs">Unit amount</Label>
                <Input type="number" min={0} step={0.01} value={invoiceForm.unit_amount} onChange={(e) => setInvoiceForm({ ...invoiceForm, unit_amount: e.target.value })} className="mt-1 rounded-lg" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Due date</Label>
              <Input type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} className="mt-1 rounded-lg" />
            </div>
            <Button
              onClick={createInvoice}
              disabled={creatingInvoice || !invoiceForm.recipient_name.trim() || !invoiceForm.description.trim()}
              className="w-full gap-2"
              style={{ background: `linear-gradient(135deg, ${CORAL} 0%, ${PLUM} 100%)` }}
            >
              {creatingInvoice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create Draft Invoice
            </Button>
          </div>
        </Panel>

        <Panel label="Invoice Register">
          {invoices.length === 0 ? (
            <div className="min-h-[220px] flex flex-col items-center justify-center text-center">
              <ReceiptText className="h-10 w-10 mb-3" style={{ color: "rgba(122,106,158,0.45)" }} />
              <p className="font-semibold" style={{ color: TEXT }}>No invoices yet</p>
              <p className="text-sm mt-1" style={{ color: MUTED }}>Issued invoices will persist here and remain available after reload.</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "rgba(232,213,232,0.5)" }}>
              {invoices.map((invoice) => (
                <div key={invoice.id} className="py-3 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(85,51,204,0.08)", color: PLUM }}>
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{invoice.invoice_number}</p>
                    <p className="text-xs truncate" style={{ color: MUTED }}>{invoice.recipient_name} • {invoice.status}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black" style={{ color: TEXT }}>{cents(invoice.total_cents, invoice.currency)}</p>
                    <p className="text-[11px]" style={{ color: MUTED }}>{invoice.due_date ? `Due ${invoice.due_date}` : "No due date"}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {invoice.status === "draft" && (
                      <Button variant="outline" size="sm" onClick={() => invoiceAction(invoice, "finalize")}>Finalize</Button>
                    )}
                    {["finalized", "issued"].includes(invoice.status) && (
                      <Button variant="outline" size="sm" onClick={() => invoiceAction(invoice, "mark-sent")}>Mark sent</Button>
                    )}
                    {!["paid", "void", "cancelled"].includes(invoice.status) && (
                      <Button variant="outline" size="sm" onClick={() => markPaid(invoice)} className="gap-1.5">
                        <CreditCard className="h-3.5 w-3.5" /> Mark paid
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => invoiceAction(invoice, "pdf")}>PDF</Button>
                    {!["paid", "void", "cancelled"].includes(invoice.status) && (
                      <Button variant="ghost" size="sm" className="text-[#F03060]" onClick={() => invoiceAction(invoice, "cancel")}>Cancel</Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
    </>
  );
}

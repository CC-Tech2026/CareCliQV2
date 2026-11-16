import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { SectionInfo } from "@/components/ui/section-info";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useReAuth } from "@/hooks/useReAuth";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-fetch";

const SETTING_KEY = ["billing", "plan-manager-auto-email"];
const PATH = "/api/billing/plan-manager-auto-email";

export type AutoEmailInvoice = {
  id: string;
  status: string;
  invoice_number: string;
  recipient_name?: string | null;
  plan_management_type?: string | null;
  auto_email_error?: string | null;
};

async function readSetting(): Promise<{ enabled: boolean }> {
  const res = await apiFetch(PATH);
  if (!res.ok) throw new Error("Couldn't load the setting.");
  return res.json();
}

export function usePlanManagerAutoEmail() {
  return useOrgQuery(SETTING_KEY, { queryFn: readSetting, staleTime: 60_000, retry: false });
}

/** One line above the invoice register: approving a plan-managed invoice
 *  emails it to the plan manager straight away, when this is on. */
export function PlanManagerAutoEmailSetting() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { requireReAuth, modal } = useReAuth();
  const setting = usePlanManagerAutoEmail();
  const [saving, setSaving] = useState(false);
  if (setting.isError) return null;
  const enabled = setting.data?.enabled ?? false;

  const change = async (next: boolean) => {
    setSaving(true);
    try {
      const res = await requireReAuth(() =>
        apiFetch(PATH, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        }),
      );
      if (!res) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || "Couldn't save the setting.");
      }
      qc.setQueryData(SETTING_KEY, await res.json());
      toast({
        title: next ? "Plan managers get invoices on approval" : "Invoices wait for you to press Email",
      });
    } catch (err) {
      toast({ title: "Couldn't change it", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cc-border bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Mail className="h-4 w-4 shrink-0 text-cc-muted" aria-hidden="true" />
        <label htmlFor="plan-manager-auto-email" className="text-sm font-medium text-cc-text">
          Email plan managers when an invoice is approved
        </label>
        <SectionInfo
          text={
            "For plan-managed participants, approving an invoice emails it with its PDF to the plan manager on the invoice, " +
            "the same email as pressing Email, and marks it sent. If it can't go (no email address, or the send fails), " +
            "the invoice stays approved and is listed here to send by hand. NDIA-managed invoices are still claimed, and " +
            "self-managed ones still wait for you."
          }
        />
      </div>
      <Switch
        id="plan-manager-auto-email"
        checked={enabled}
        disabled={saving || setting.isLoading}
        onCheckedChange={(next) => void change(next)}
      />
      {modal}
    </div>
  );
}

function stuck(invoices: AutoEmailInvoice[]) {
  return invoices.filter((invoice) => invoice.auto_email_error && ["finalized", "issued"].includes(invoice.status));
}

/** Approved plan-managed invoices that didn't go to the plan manager on
 *  their own, gathered at the top of the register so none sit unsent. */
export function PlanManagerEmailNeedsAttention({
  invoices,
  onOpen,
}: {
  invoices: AutoEmailInvoice[];
  onOpen: (invoice: AutoEmailInvoice) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = stuck(invoices);
  if (!rows.length) return null;
  const shown = showAll ? rows : rows.slice(0, 3);
  return (
    <section
      aria-label="Not emailed to the plan manager"
      className="rounded-2xl border bg-white p-4"
      style={{ borderColor: "var(--cc-danger-border, #FECACA)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {rows.length === 1
            ? "1 approved invoice wasn't emailed to the plan manager"
            : `${rows.length} approved invoices weren't emailed to the plan manager`}
        </p>
        <p className="text-[12px] text-cc-muted">Open one to fix the cause and press Email.</p>
      </div>
      <ul className="mt-3 divide-y divide-cc-border">
        {shown.map((invoice) => (
          <li key={invoice.id} className="py-2.5">
            <button type="button" onClick={() => onOpen(invoice)} className="text-[13px] font-semibold hover:underline">
              {invoice.invoice_number}
            </button>
            {invoice.recipient_name && <span className="text-[13px] text-cc-muted"> · {invoice.recipient_name}</span>}
            <p className="text-[13px]" style={{ color: "var(--cc-danger-text)" }}>{invoice.auto_email_error}</p>
          </li>
        ))}
      </ul>
      {rows.length > 3 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-[13px] font-medium text-cc-muted hover:underline">
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

/** On the invoice itself: why it didn't go to the plan manager on its own. */
export function InvoiceAutoEmailLine({ invoice }: { invoice: AutoEmailInvoice }) {
  if (!invoice.auto_email_error || !["finalized", "issued"].includes(invoice.status)) return null;
  return (
    <div className="rounded-xl border border-cc-border p-3">
      <p className="font-medium">Plan manager email</p>
      <p className="text-[13px]" style={{ color: "var(--cc-danger-text)" }}>{invoice.auto_email_error}</p>
    </div>
  );
}

/** The toast after approving: whether it also went to the plan manager. */
export function approvalToast(updated: AutoEmailInvoice & { recipient_email?: string | null }) {
  if (updated.status === "sent") {
    return {
      title: "Approved and emailed",
      description: `${updated.invoice_number} to ${updated.recipient_email ?? updated.recipient_name ?? "the plan manager"}`,
    };
  }
  if (updated.auto_email_error) {
    return { title: "Approved, but not emailed", description: updated.auto_email_error, variant: "destructive" as const };
  }
  return null;
}

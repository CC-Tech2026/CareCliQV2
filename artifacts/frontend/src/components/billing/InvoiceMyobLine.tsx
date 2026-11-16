import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { getMyobSummary, sendInvoiceToMyob } from "@/services/myobService";

const SENDABLE = new Set(["finalized", "issued", "sent", "overdue"]);
const STATUS_WORDS: Record<string, string> = {
  Open: "awaiting payment",
  Closed: "paid",
  Deleted: "deleted there",
};

export type InvoiceMyobFields = {
  id: string;
  status: string;
  invoice_number?: string | null;
  myob_invoice_uid?: string | null;
  myob_invoice_number?: string | null;
  myob_status?: string | null;
  myob_sync_error?: string | null;
};

/** Where the invoice is in MYOB, when MYOB is connected: sent (its MYOB
 *  number and state), couldn't be sent (and why), or waiting, with Send to MYOB.
 *  Renders nothing for organisations that don't use MYOB. */
export function InvoiceMyobLine({ invoice }: { invoice: InvoiceMyobFields }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);
  const summary = useOrgQuery(["integrations", "myob", "summary"], {
    queryFn: getMyobSummary,
    staleTime: 60_000,
    retry: false,
  });
  if (!summary.data?.connected && !invoice.myob_invoice_uid) return null;
  const canSend = summary.data?.connected && SENDABLE.has(invoice.status);
  const send = async () => {
    setSending(true);
    try {
      const result = await sendInvoiceToMyob(invoice.id);
      toast({ title: result.message });
    } catch (err) {
      toast({ title: "Couldn't send to MYOB", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSending(false);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("billing") });
    }
  };
  const state = invoice.myob_status ? STATUS_WORDS[invoice.myob_status] ?? invoice.myob_status.toLowerCase() : null;
  const theirNumber = invoice.myob_invoice_number && invoice.myob_invoice_number !== invoice.invoice_number
    ? ` as ${invoice.myob_invoice_number}`
    : "";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-cc-border p-3">
      <div className="min-w-0">
        <p className="font-medium">MYOB</p>
        {invoice.myob_sync_error ? (
          <p className="text-[13px]" style={{ color: "var(--cc-danger-text)" }}>{invoice.myob_sync_error}</p>
        ) : invoice.myob_invoice_uid ? (
          <p className="text-[13px] text-cc-muted">
            In MYOB{theirNumber}{state ? `, ${state}` : ""}{summary.data?.business_name ? ` (${summary.data.business_name})` : ""}.
          </p>
        ) : (
          <p className="text-[13px] text-cc-muted">
            {SENDABLE.has(invoice.status) ? "Not in MYOB yet." : invoice.status === "draft" ? "Goes to MYOB once it's approved." : "Not sent to MYOB."}
          </p>
        )}
      </div>
      {canSend && invoice.myob_status !== "Closed" && (
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-cc-border px-3 text-[13px] font-medium transition-colors hover:bg-cc-soft disabled:opacity-60"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {invoice.myob_invoice_uid || invoice.myob_sync_error ? "Send again" : "Send to MYOB"}
        </button>
      )}
    </div>
  );
}

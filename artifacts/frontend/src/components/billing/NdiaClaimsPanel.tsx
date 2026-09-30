import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, Search, Send, CheckCircle2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { apiFetch } from "@/lib/api-fetch";
import { formatAppDate } from "@/lib/datetime";

export type ClaimRow = {
  invoice_id: string;
  invoice_number: string;
  participant_id: string | null;
  participant_name: string;
  support_item: string | null;
  quantity_label: string;
  total_cents: number;
  status: string;
  problems: string[];
  claim_submitted_at: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  batch: { id: string; batch_number: string; created_at: string } | null;
};

type ClaimsResponse = {
  ready: ClaimRow[];
  submitted: ClaimRow[];
  paid: ClaimRow[];
  drafts_awaiting_review: number;
  registration_number_missing: boolean;
};

type Tab = "ready" | "submitted" | "paid";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "ready", label: "Ready to claim" },
  { key: "submitted", label: "Submitted" },
  { key: "paid", label: "Paid" },
];

const AVATAR = ["#8B7FD1", "#C7853D", "#E8457A", "#D9A441", "#4E9A76", "#3B4A63"];
const money = (cents: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(cents / 100);
const initials = (name: string) =>
  name.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase() || "?";
function colour(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR[hash % AVATAR.length];
}

async function json<T>(res: Response | undefined): Promise<T | undefined> {
  if (!res) return undefined; // re-auth cancelled
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "Something went wrong.");
  }
  return res.json();
}

function saveFile(name: string, content: BlobPart, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function StatusPill({ row, tab }: { row: ClaimRow; tab: Tab }) {
  const [label, fg, bg] =
    tab === "paid"
      ? ["Paid", "var(--cc-status-success)", "var(--cc-status-success-bg)"]
      : tab === "submitted"
        ? ["Submitted", "var(--cc-plum)", "var(--cc-soft)"]
        : row.problems.length
          ? ["Needs fixing", "var(--cc-status-danger)", "var(--cc-status-danger-bg)"]
          : ["Ready", "var(--cc-status-info)", "var(--cc-status-info-bg)"];
  return (
    <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: fg, background: bg }}>
      {label}
    </span>
  );
}

/** NDIA-managed invoices: pick the ones ready to claim, submit them as one
 * bulk payment request file for the provider portal, then record the
 * remittance when the NDIA pays. */
export function NdiaClaimsPanel({
  onChanged,
  heading,
}: {
  onChanged?: () => void;
  /** Shows the panel as a titled card (Financial Governance). */
  heading?: string;
}) {
  const { toast } = useToast();
  const { requireReAuth, modal } = useReAuth();
  const [tab, setTab] = useState<Tab>("ready");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentDate, setPaymentDate] = useState("");
  const [reference, setReference] = useState("");
  const [search, setSearch] = useState("");
  const query = useOrgQuery<ClaimsResponse>(["billing", "ndia-claims"], {
    queryFn: async () => (await json<ClaimsResponse>(await apiFetch("/api/billing/claims")))!,
  });

  const q = search.trim().toLowerCase();
  const rows = (query.data?.[tab] ?? []).filter(
    (r) =>
      !q ||
      r.participant_name.toLowerCase().includes(q) ||
      r.invoice_number.toLowerCase().includes(q) ||
      (r.support_item ?? "").toLowerCase().includes(q),
  );
  const totals = useMemo(
    () =>
      Object.fromEntries(
        TABS.map((t) => [
          t.key,
          (query.data?.[t.key] ?? [])
            .filter((r) => t.key !== "ready" || r.problems.length === 0)
            .reduce((sum, r) => sum + r.total_cents, 0),
        ]),
      ) as Record<Tab, number>,
    [query.data],
  );
  const selectable = useMemo(
    () => rows.filter((r) => tab === "submitted" || (tab === "ready" && r.problems.length === 0)),
    [rows, tab],
  );
  const chosen = rows.filter((r) => selected.has(r.invoice_id));
  const chosenTotal = chosen.reduce((sum, r) => sum + r.total_cents, 0);

  const switchTab = (next: Tab) => {
    setTab(next);
    setSearch("");
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toFix = (query.data?.ready ?? []).filter((r) => r.problems.length > 0).length;
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.invoice_id));
  // Esc clears the selection.
  useEffect(() => {
    if (!selected.size) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !paying) setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, paying]);
  const refresh = () => {
    setSelected(new Set());
    void query.refetch();
    onChanged?.();
  };

  const submit = async () => {
    setBusy(true);
    try {
      const result = await json<{ file_name: string; csv: string; invoice_count: number }>(
        await requireReAuth(() =>
          apiFetch("/api/billing/claims/batches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invoice_ids: [...selected] }),
          }),
        ),
      );
      if (!result) return;
      saveFile(result.file_name, result.csv);
      toast({
        title: `${result.invoice_count} invoice${result.invoice_count === 1 ? "" : "s"} submitted`,
        description: "Upload the downloaded file in the NDIS provider portal under Payment requests → Bulk upload.",
      });
      refresh();
      setTab("submitted");
    } catch (err) {
      toast({ title: "Claim not submitted", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async () => {
    setBusy(true);
    try {
      const result = await json<{ paid: number }>(
        await requireReAuth(() =>
          apiFetch("/api/billing/claims/paid", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invoice_ids: [...selected], payment_date: paymentDate || null, reference: reference || null }),
          }),
        ),
      );
      if (!result) return;
      toast({ title: `${result.paid} claim${result.paid === 1 ? "" : "s"} marked paid` });
      setPaying(false);
      setReference("");
      refresh();
    } catch (err) {
      toast({ title: "Couldn't mark paid", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const rejected = async (row: ClaimRow) => {
    const reason = window.prompt(`Why did the NDIA reject ${row.invoice_number}?`);
    if (!reason) return;
    try {
      await json(
        await apiFetch(`/api/billing/claims/${encodeURIComponent(row.invoice_id)}/rejected`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        }),
      );
      toast({ title: "Back in Ready to claim", description: "Fix the invoice, then claim it again." });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't update the claim", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  const downloadBatch = async (batchId: string) => {
    try {
      const res = await apiFetch(`/api/billing/claims/batches/${encodeURIComponent(batchId)}/file`);
      if (!res.ok) throw new Error("The claim file couldn't be downloaded.");
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "ndia-bulk-claim.csv";
      saveFile(name, await res.blob());
    } catch (err) {
      toast({ title: "Download failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  return (
    <section
      className={heading ? "space-y-4 rounded-3xl border border-cc-border bg-cc-surface p-4 sm:p-6" : "space-y-4"}
      aria-label={heading ?? "NDIA claims"}
    >
      {modal}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {heading && <h2 className="text-lg font-bold text-cc-text">{heading}</h2>}
          <p className="max-w-xl text-sm text-cc-muted">
            {heading
              ? "Create, review and claim invoices from delivered sessions."
              : "Finalised invoices for NDIA-managed participants. Submit them together as one bulk payment request, then record the remittance when the NDIA pays."}
          </p>
        </div>
        <div role="tablist" aria-label="Claim status" className="flex rounded-xl border border-cc-border bg-cc-soft p-1">
          {TABS.map((t) => {
            const count = query.data?.[t.key].length;
            return (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={tab === t.key}
                onClick={() => switchTab(t.key)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{
                  background: tab === t.key ? "var(--cc-surface)" : "transparent",
                  color: tab === t.key ? "var(--cc-text)" : "var(--cc-muted)",
                  boxShadow: tab === t.key ? "0 1px 2px rgba(0,0,0,0.08)" : undefined,
                }}
              >
                {t.label}
                {count !== undefined && (
                  <span
                    className="rounded-full px-1.5 text-[10px] tabular-nums"
                    style={{ background: tab === t.key ? "var(--cc-soft)" : "transparent" }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {query.data && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-cc-muted">
            <span className="font-bold tabular-nums text-cc-text">{money(totals[tab])}</span>{" "}
            {tab === "ready" ? "ready to claim" : tab === "submitted" ? "awaiting NDIA payment" : "paid by the NDIA"}
            {tab === "ready" && toFix > 0 && (
              <span style={{ color: "var(--cc-status-danger)" }}> · {toFix} need{toFix === 1 ? "s" : ""} fixing first</span>
            )}
          </p>
          <label className="relative ml-auto w-full sm:w-64">
            <span className="sr-only">Search claims</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cc-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Participant, invoice or item"
              className="h-9 rounded-xl pl-8 text-[13px]"
            />
          </label>
        </div>
      )}

      {query.data?.registration_number_missing && (
        <p role="alert" className="flex items-center gap-2 rounded-xl p-3 text-sm" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)" }}>
          <AlertTriangle size={15} /> Add your NDIS registration number before claiming.
          <a href="/settings?section=provider" className="ml-auto font-semibold underline">Organisation details</a>
        </p>
      )}
      {tab === "ready" && !!query.data?.drafts_awaiting_review && (
        <p className="text-xs text-cc-muted">
          {query.data.drafts_awaiting_review} NDIA-managed draft invoice
          {query.data.drafts_awaiting_review === 1 ? " needs" : "s need"} reviewing and finalising before
          {query.data.drafts_awaiting_review === 1 ? " it appears" : " they appear"} here.
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-cc-border bg-cc-surface">
        {query.isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-cc-plum" /></div>
        ) : query.isError ? (
          <div role="alert" className="p-6 text-sm text-cc-text">
            Claims couldn't be loaded.{" "}
            <Button variant="link" className="px-1" onClick={() => void query.refetch()}>Try again</Button>
          </div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-cc-muted">
            {q
              ? "No claims match your search."
              : tab === "ready"
                ? "Nothing ready to claim. Finalised NDIA-managed invoices appear here."
                : tab === "submitted"
                  ? "No claims waiting on payment."
                  : "No paid claims yet."}
          </p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-cc-border bg-cc-soft text-left text-[11px] uppercase tracking-wide text-cc-muted">
                <th className="w-10 px-4 py-3">
                  {tab !== "paid" && (
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-[#E8457A] disabled:cursor-not-allowed"
                      aria-label="Select all"
                      checked={allSelected}
                      disabled={selectable.length === 0}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.invoice_id)))}
                    />
                  )}
                </th>
                <th className="px-2 py-3 font-semibold">Participant</th>
                <th className="px-2 py-3 font-semibold">Support item</th>
                <th className="px-2 py-3 text-right font-semibold">Qty</th>
                <th className="px-2 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const canSelect = selectable.includes(row);
                const on = selected.has(row.invoice_id);
                return (
                  <tr
                    key={row.invoice_id}
                    className={`border-b border-cc-border last:border-b-0 align-top transition-colors ${canSelect ? "cursor-pointer hover:bg-cc-soft/60" : ""}`}
                    style={{ background: on ? "rgba(232,69,122,0.06)" : undefined }}
                    onClick={(e) => {
                      // The whole row selects, except its own buttons and links.
                      if (!canSelect || (e.target as HTMLElement).closest("button, a, input")) return;
                      toggle(row.invoice_id);
                    }}
                  >
                    <td className="px-4 py-3.5">
                      {tab !== "paid" && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-[#E8457A] disabled:cursor-not-allowed"
                          aria-label={`Select ${row.participant_name} ${row.invoice_number}`}
                          checked={on}
                          disabled={!canSelect}
                          onChange={() => toggle(row.invoice_id)}
                        />
                      )}
                    </td>
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: colour(row.participant_name) }}>
                          {initials(row.participant_name)}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-cc-text">{row.participant_name}</p>
                          <p className="text-[11px] text-cc-muted">
                            {row.invoice_number}
                            {row.batch ? ` · ${row.batch.batch_number}` : ""}
                            {tab === "paid" && row.paid_at ? ` · paid ${formatAppDate(row.paid_at)}` : ""}
                            {tab === "paid" && row.payment_reference ? ` · ${row.payment_reference}` : ""}
                          </p>
                          {tab === "ready" && row.problems.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-[11px]" style={{ color: "var(--cc-status-danger)" }}>
                              {row.problems.slice(0, 3).map((p) => <li key={p}>{p}</li>)}
                              <li>
                                <a href="/billing" className="font-semibold underline">Fix invoice</a>
                              </li>
                            </ul>
                          )}
                          {tab === "submitted" && (
                            <div className="mt-1 flex flex-wrap gap-3 text-[11px]">
                              {row.batch && (
                                <button type="button" className="inline-flex items-center gap-1 font-semibold text-cc-plum" onClick={() => void downloadBatch(row.batch!.id)}>
                                  <Download size={11} /> Claim file
                                </button>
                              )}
                              <button type="button" className="inline-flex items-center gap-1 font-semibold text-cc-muted" onClick={() => void rejected(row)}>
                                <Undo2 size={11} /> Claim rejected
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3.5">
                      {row.support_item ? (
                        <span className="rounded-md bg-cc-soft px-1.5 py-0.5 font-mono text-[11px] text-cc-muted">{row.support_item}</span>
                      ) : (
                        <span className="text-cc-muted">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3.5 text-right tabular-nums text-cc-text">{row.quantity_label}</td>
                    <td className="px-2 py-3.5 text-right font-semibold tabular-nums text-cc-text">{money(row.total_cents)}</td>
                    <td className="px-4 py-3.5 text-right"><StatusPill row={row} tab={tab} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {chosen.length > 0 && (
        <div
          className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-white shadow-xl sm:px-5"
          style={{ background: "#1E1B2E" }}
          role="region"
          aria-label="Selected claims"
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10"
              aria-label="Clear selection"
              title="Clear selection (Esc)"
            >
              <X size={15} />
            </button>
            <p className="text-sm font-semibold" aria-live="polite">
              {chosen.length} invoice{chosen.length === 1 ? "" : "s"} selected ·{" "}
              <span className="tabular-nums">{money(chosenTotal)}</span>
            </p>
          </div>
          {tab === "ready" ? (
            <Button className="gap-2 rounded-xl text-white hover:opacity-90" style={{ background: "#E8457A" }} disabled={busy} onClick={submit}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Submit bulk claim
            </Button>
          ) : (
            <Button className="gap-2 rounded-xl text-white hover:opacity-90" style={{ background: "#0F7B57" }} disabled={busy} onClick={() => setPaying(true)}>
              <CheckCircle2 size={15} /> Mark paid
            </Button>
          )}
        </div>
      )}

      <Dialog open={paying} onOpenChange={setPaying}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record NDIA payment</DialogTitle>
            <DialogDescription>
              {chosen.length} claim{chosen.length === 1 ? "" : "s"} · {money(chosenTotal)}. Use the details from the NDIA remittance.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-xs text-cc-muted">Payment date</span>
              <Input type="date" value={paymentDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaymentDate(e.target.value)} />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs text-cc-muted">Remittance reference</span>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaying(false)}>Cancel</Button>
            <Button onClick={markPaid} disabled={busy}>{busy ? "Saving…" : "Mark paid"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

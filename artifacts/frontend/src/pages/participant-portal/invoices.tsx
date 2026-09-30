import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Download, FileArchive, Loader2, TriangleAlert } from "lucide-react";
import { ParticipantPortalShell } from "@/components/participant-portal/ParticipantPortalShell";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { useToast } from "@/hooks/use-toast";
import {
  downloadAllInvoices,
  downloadInvoicePdf,
  listMyInvoices,
  type ParticipantInvoice,
} from "@/services/participantPortalService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

// The backend only returns issued, sent, overdue and paid invoices.
type Bucket = "paid" | "awaiting" | "overdue";

function bucketOf(status: string): Bucket {
  if (status === "paid") return "paid";
  if (status === "overdue") return "overdue";
  return "awaiting";
}

// Translucent tints so tiles and pills read on light and dark surfaces;
// labels keep a strong accent for contrast.
const BUCKETS: Record<Bucket, { label: string; accent: string; tint: string; icon: typeof Clock }> = {
  paid: { label: "Paid", accent: "#1F7A4D", tint: "rgba(31, 122, 77, 0.12)", icon: CheckCircle2 },
  awaiting: { label: "Awaiting payment", accent: "#B45309", tint: "rgba(180, 83, 9, 0.12)", icon: Clock },
  overdue: { label: "Overdue", accent: "#C0392B", tint: "rgba(192, 57, 43, 0.12)", icon: TriangleAlert },
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function formatShortDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

function StatusPill({ status }: { status: string }) {
  const b = BUCKETS[bucketOf(status)];
  return (
    <span className="inline-flex rounded-lg px-2.5 py-1 text-[11px] font-black" style={{ background: b.tint, color: b.accent }}>
      {bucketOf(status) === "awaiting" ? "Awaiting payment" : b.label}
    </span>
  );
}

function DownloadButton({ busy, label, onClick }: { busy: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title="Download PDF"
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-bold transition-colors hover:bg-black/5 disabled:opacity-60"
      style={{ color: PLUM }}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
      <span className="hidden md:inline">Download</span>
    </button>
  );
}

export default function ParticipantInvoicesPage() {
  const { participantId } = useViewingParticipant();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<ParticipantInvoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);

  async function downloadOne(invoice: ParticipantInvoice) {
    if (!participantId) return;
    setDownloadingId(invoice.id);
    try {
      await downloadInvoicePdf(participantId, invoice);
    } catch (e) {
      toast({ title: "Couldn't download invoice", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  }

  async function downloadAll() {
    if (!participantId || !invoices?.length) return;
    setZipping(true);
    try {
      await downloadAllInvoices(participantId, invoices);
    } catch (e) {
      toast({ title: "Couldn't download invoices", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setZipping(false);
    }
  }

  useEffect(() => {
    if (!participantId) return;
    let cancelled = false;
    setInvoices(null);
    setLoadError(null);
    listMyInvoices(participantId)
      .then((data) => { if (!cancelled) setInvoices(data); })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load invoices.");
        setInvoices([]);
      });
    return () => { cancelled = true; };
  }, [participantId]);

  const totals: Record<Bucket, { count: number; amount: number }> = {
    paid: { count: 0, amount: 0 },
    awaiting: { count: 0, amount: 0 },
    overdue: { count: 0, amount: 0 },
  };
  for (const inv of invoices ?? []) {
    const t = totals[bucketOf(inv.status)];
    t.count += 1;
    t.amount += Number(inv.total_amount) || 0;
  }

  return (
    <ParticipantPortalShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: TEXT }}>Invoices</h1>
          <p className="mt-1 text-[13px]" style={{ color: MUTED }}>Billing for the supports you've received.</p>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 rounded-2xl border p-4" style={{ borderColor: AMBER, background: AMBER_SOFT }}>
            <AlertTriangle size={15} style={{ color: AMBER }} className="shrink-0" />
            <p className="text-[12px] font-bold" style={{ color: AMBER }}>Couldn't load invoices: {loadError}</p>
          </div>
        )}

        {/* ── Summary tiles ─────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(BUCKETS) as Bucket[]).map((key) => {
            const b = BUCKETS[key];
            const Icon = b.icon;
            return (
              <div key={key} className="flex items-center gap-3 rounded-2xl p-4" style={{ background: b.tint }}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: b.accent }}>
                  <Icon size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-bold" style={{ color: MUTED }}>{b.label}</p>
                  <p className="text-[20px] font-black leading-tight" style={{ color: TEXT }}>
                    {invoices === null ? "—" : totals[key].count}
                  </p>
                  {invoices !== null && totals[key].count > 0 && (
                    <p className="text-[11px] font-semibold" style={{ color: MUTED }}>{money.format(totals[key].amount)}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Invoice list ──────────────────────────────────────── */}
        <section className="rounded-2xl border p-4 sm:p-6" style={{ borderColor: BORDER }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[16px] font-black" style={{ color: TEXT }}>All invoices</h2>
            {invoices && invoices.length > 0 && (
              <button
                type="button"
                onClick={downloadAll}
                disabled={zipping}
                className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-bold transition-colors hover:bg-black/5 disabled:opacity-60"
                style={{ borderColor: BORDER, color: PLUM }}
              >
                {zipping ? <Loader2 size={15} className="animate-spin" /> : <FileArchive size={15} />}
                {zipping ? "Preparing zip…" : "Download all (.zip)"}
              </button>
            )}
          </div>

          {invoices === null ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg" style={{ background: SOFT }} />)}
            </div>
          ) : invoices.length === 0 ? (
            <p className="py-8 text-center text-[13px]" style={{ color: MUTED }}>No invoices yet.</p>
          ) : (
            <>
              {/* Desktop / tablet: table */}
              <table className="hidden w-full text-left sm:table">
                <thead>
                  <tr className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>
                    <th className="pb-3 font-black">Invoice</th>
                    <th className="pb-3 font-black">Period</th>
                    <th className="pb-3 font-black">Date</th>
                    <th className="pb-3 font-black">Amount</th>
                    <th className="pb-3 font-black">Status</th>
                    <th className="pb-3"><span className="sr-only">Download</span></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-t text-[13px]" style={{ borderColor: BORDER }}>
                      <td className="py-3.5 pr-3 font-bold" style={{ color: TEXT }}>{inv.invoice_number}</td>
                      <td className="py-3.5 pr-3" style={{ color: MUTED }}>
                        {formatShortDate(inv.period_start)} – {formatDate(inv.period_end)}
                      </td>
                      <td className="py-3.5 pr-3 font-semibold" style={{ color: TEXT }}>{formatDate(inv.invoice_date)}</td>
                      <td className="py-3.5 pr-3 font-black" style={{ color: TEXT }}>{money.format(Number(inv.total_amount) || 0)}</td>
                      <td className="py-3.5 pr-3"><StatusPill status={inv.status} /></td>
                      <td className="py-3.5 text-right">
                        <DownloadButton
                          busy={downloadingId === inv.id}
                          label={`Download invoice ${inv.invoice_number}`}
                          onClick={() => downloadOne(inv)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Phones: stacked rows */}
              <ul className="space-y-2 sm:hidden">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: SOFT }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold" style={{ color: TEXT }}>{inv.invoice_number}</p>
                      <p className="text-[11px]" style={{ color: MUTED }}>{formatDate(inv.invoice_date)}</p>
                      <div className="mt-1.5"><StatusPill status={inv.status} /></div>
                    </div>
                    <p className="text-[14px] font-black" style={{ color: TEXT }}>{money.format(Number(inv.total_amount) || 0)}</p>
                    <DownloadButton
                      busy={downloadingId === inv.id}
                      label={`Download invoice ${inv.invoice_number}`}
                      onClick={() => downloadOne(inv)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </ParticipantPortalShell>
  );
}

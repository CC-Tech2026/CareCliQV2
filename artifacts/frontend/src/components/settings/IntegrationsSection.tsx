/**
 * Settings > Integrations (managing directors): a directory of the systems
 * CareCliQ connects to, one equal tile each, with the detail a click away.
 *
 * - Xero: Connect goes straight to Xero (and back to
 *   /integrations/xero/callback); Manage opens a side panel with the
 *   organisation, how syncing is going, recent invoices, settings and
 *   Disconnect.
 * - API and webhooks: keys and webhooks for systems such as CORA Workforce
 *   (ApiAccessPanel).
 * - Suggest an integration: opens Improvements & Feedback.
 *
 * The Xero logo is Xero's official wordmark (public/integrations/XERO),
 * never redrawn or recoloured: the Xero Blue version, light and dark mode alike,
 * wider than Xero's 40px minimum and with clear space round it. Xero's colours
 * appear only in that file. The wordmark is the tile's name, so it isn't
 * written out again beside it.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, RefreshCw, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidePanel } from "@/components/layout/SidePanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { formatAppDate, formatAppTime } from "@/lib/datetime";
import { ApiAccessPanel } from "./ApiAccessPanel";
import { MyobTile } from "./MyobIntegration";
import {
  dismissEarlierXero,
  disconnectXero,
  getApiOverview,
  getXeroOptions,
  getXeroStatus,
  saveXeroSettings,
  sendEarlierToXero,
  startXeroConnect,
  syncXeroNow,
  type XeroSettings,
  type XeroStatus,
} from "@/services/integrationsService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const PURPLE = "var(--cc-brand-purple)";
const PURPLE_SOFT = "var(--cc-brand-purple-soft)";
/** Xero's official wordmark, in Xero Blue. */
const XERO_WORDMARK = "/integrations/XERO/Xero%20Wordmark%20Blue.svg";

function when(iso?: string | null) {
  if (!iso) return null;
  return `${formatAppDate(iso, null, { day: "numeric", month: "short" })}, ${formatAppTime(iso)}`;
}

function money(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

export type TileStatus = "connected" | "available" | "attention" | "soon" | "unavailable";

const STATUS_LOOK: Record<TileStatus, { label: string; fg: string; bg: string; dot?: string }> = {
  connected: { label: "Connected", fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)", dot: "var(--cc-status-success)" },
  attention: { label: "Needs attention", fg: "var(--cc-danger-text)", bg: "var(--cc-status-danger-bg)", dot: "var(--cc-danger-text)" },
  available: { label: "Not connected", fg: MUTED, bg: "var(--cc-soft)" },
  soon: { label: "Coming soon", fg: MUTED, bg: "var(--cc-soft)" },
  unavailable: { label: "Not switched on", fg: MUTED, bg: "var(--cc-soft)" },
};

function StatusPill({ status }: { status: TileStatus }) {
  const look = STATUS_LOOK[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: look.fg, background: look.bg }}>
      {look.dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: look.dot }} />}
      {look.label}
    </span>
  );
}

/** Xero's wordmark, at the tile's logo height. */
function XeroWordmark() {
  return (
    <span className="flex h-11 shrink-0 items-center">
      <img src={XERO_WORDMARK} alt="" width={71} height={20} className="block h-5 w-auto" />
    </span>
  );
}

/** A square logo slot: the official logo when it's been added, otherwise the name. */
export function LogoSlot({ src, name, icon }: { src?: string; name: string; icon?: ReactNode }) {
  const [failed, setFailed] = useState(!src);
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-cc-border bg-cc-surface">
      {icon ? icon : failed ? (
        <span className="text-[12px] font-semibold tracking-tight" style={{ color: TEXT }}>{name}</span>
      ) : (
        <img src={src} alt="" className="h-7 w-7 object-contain" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

export function IntegrationTile({
  logo, name, category, description, status, detail, action, logoIsName = false,
}: {
  logo: ReactNode;
  /** The logo is a wordmark that already says the name, so it isn't written again. */
  logoIsName?: boolean;
  name: string;
  category: string;
  description: string;
  status: TileStatus;
  /** One short line under the description, e.g. which Xero organisation. */
  detail?: ReactNode;
  action: ReactNode;
}) {
  return (
    <article className="flex min-h-[220px] flex-col rounded-xl border border-cc-border bg-cc-surface p-5">
      <div className="flex items-start justify-between gap-3">
        {logo}
        <StatusPill status={status} />
      </div>
      {logoIsName ? (
        <h3 className="sr-only">{name}</h3>
      ) : (
        <h3 className="mt-4 text-[15px] font-semibold" style={{ color: TEXT }}>{name}</h3>
      )}
      <p className={`text-xs ${logoIsName ? "mt-4" : ""}`} style={{ color: MUTED }}>{category}</p>
      <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed" style={{ color: MUTED }}>{description}</p>
      {detail && <p className="mt-2 truncate text-xs" style={{ color: TEXT }}>{detail}</p>}
      <div className="mt-auto pt-4">{action}</div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Xero: the Manage panel
// ---------------------------------------------------------------------------

/** The state of one invoice in Xero, in words, with its colour. */
function xeroState(row: NonNullable<XeroStatus["recent"]>[number]) {
  if (row.error) return { label: "Couldn't send", fg: "var(--cc-danger-text)", bg: "var(--cc-status-danger-bg)" };
  switch (row.xero_status) {
    case "PAID": return { label: "Paid in Xero", fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" };
    case "AUTHORISED": return { label: "Awaiting payment", fg: PURPLE, bg: PURPLE_SOFT };
    case "DRAFT":
    case "SUBMITTED": return { label: "Draft in Xero", fg: MUTED, bg: "var(--cc-soft)" };
    case "VOIDED":
    case "DELETED": return { label: "Voided in Xero", fg: MUTED, bg: "var(--cc-soft)" };
    default: return { label: "In Xero", fg: PURPLE, bg: PURPLE_SOFT };
  }
}

export function PanelHeading({ children }: { children: ReactNode }) {
  return <h4 className="text-[13px] font-semibold" style={{ color: TEXT }}>{children}</h4>;
}

function XeroPanel({
  open, onOpenChange, status, onReconnect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: XeroStatus;
  onReconnect: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("integrations") });
  const [draft, setDraft] = useState<XeroSettings>(status.settings);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [answeringEarlier, setAnsweringEarlier] = useState<"send" | "skip" | null>(null);
  useEffect(() => setDraft(status.settings), [status.settings]);

  const optionsQuery = useOrgQuery(["integrations", "xero", "options"], {
    queryFn: getXeroOptions,
    enabled: open && status.connected,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncXeroNow();
      const parts = [
        result.sent ? `${result.sent} sent` : null,
        result.paid ? `${result.paid} marked paid` : null,
        result.failed ? `${result.failed} couldn't be sent` : null,
      ].filter(Boolean);
      toast({ title: parts.length ? `Xero: ${parts.join(", ")}` : "Everything is up to date with Xero" });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't sync with Xero", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await saveXeroSettings(draft);
      toast({ title: "Xero settings saved" });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't save the Xero settings", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const answerEarlier = async (answer: "send" | "skip") => {
    setAnsweringEarlier(answer);
    try {
      if (answer === "send") {
        const result = await sendEarlierToXero();
        toast({
          title: result.failed
            ? `${result.sent} sent to Xero, ${result.failed} need attention`
            : `${result.sent} ${result.sent === 1 ? "invoice" : "invoices"} sent to Xero`,
        });
      } else {
        await dismissEarlierXero();
        toast({ title: "Only invoices approved from now on will go to Xero" });
      }
      refresh();
    } catch (err) {
      toast({ title: "Couldn't do that", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setAnsweringEarlier(null);
    }
  };
  const disconnect = async () => {
    try {
      await disconnectXero();
      toast({ title: "Xero disconnected", description: "Invoices already in Xero stay there." });
      onOpenChange(false);
      refresh();
    } catch (err) {
      toast({ title: "Couldn't disconnect Xero", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(status.settings);
  const accounts = optionsQuery.data?.accounts ?? [];
  const taxRates = optionsQuery.data?.tax_rates ?? [];
  // Keep the saved choice listed even before (or without) Xero's lists.
  const accountChoices = accounts.some((a) => a.code === draft.sales_account_code)
    ? accounts
    : [{ code: draft.sales_account_code, name: "" }, ...accounts];
  const taxChoices = taxRates.some((t) => t.type === draft.tax_type)
    ? taxRates
    : [{ type: draft.tax_type, name: draft.tax_type === "EXEMPTOUTPUT" ? "GST Free Income" : draft.tax_type }, ...taxRates];
  const recent = status.recent ?? [];
  const banks = optionsQuery.data?.bank_accounts ?? [];
  const bankChoices =
    draft.payment_account_id && !banks.some((b) => b.id === draft.payment_account_id)
      ? [{ id: draft.payment_account_id, code: null, name: draft.payment_account_name || "Saved account" }, ...banks]
      : banks;
  const earlier = status.earlier;

  return (
    <>
      <SidePanel
        open={open}
        onOpenChange={onOpenChange}
        eyebrow="Accounting"
        title="Xero"
        description={
          <>
            Connected to <span className="font-semibold text-cc-text">{status.tenant_name || "your Xero organisation"}</span>
            {status.connected_by_name ? ` by ${status.connected_by_name}` : ""}
            {status.connected_at ? ` on ${formatAppDate(status.connected_at)}` : ""}.
          </>
        }
        footer={
          <>
            <Button variant="ghost" className="mr-auto" style={{ color: "var(--cc-danger-text)" }} onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
            <Button onClick={save} disabled={!dirty || saving} className="gap-1.5" style={{ background: "var(--cc-cta)", color: "#fff" }}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Xero settings
            </Button>
          </>
        }
      >
        {status.last_error && (
          <div role="alert" className="flex gap-2.5 rounded-lg px-4 py-3 text-sm" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-danger-text)" }}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">{status.last_error}</p>
              {/reconnect/i.test(status.last_error) && (
                <button type="button" onClick={onReconnect} className="mt-1 font-semibold underline underline-offset-2">
                  Reconnect Xero
                </button>
              )}
            </div>
          </div>
        )}

        {earlier && earlier.count > 0 && (
          <section className="space-y-3 rounded-xl border border-cc-border p-4" aria-label="Invoices from before you connected">
            <PanelHeading>
              {earlier.count === 1
                ? "1 invoice from before you connected isn't in Xero"
                : `${earlier.count} invoices from before you connected aren't in Xero`}
            </PanelHeading>
            <p className="text-[13px]" style={{ color: MUTED }}>
              {money(earlier.total_cents)} in all, approved before {status.connected_at ? formatAppDate(status.connected_at) : "you connected"}.
              Send them if Xero should have them too. Leave them out if they're already in your books.
            </p>
            <ul className="space-y-1 text-[13px]">
              {earlier.invoices.slice(0, 5).map((row) => (
                <li key={row.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="font-medium tabular-nums">{row.invoice_number}</span>
                    {row.payer ? <span style={{ color: MUTED }}> · {row.payer}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums">{money(row.total_cents)}</span>
                </li>
              ))}
              {earlier.count > 5 && <li style={{ color: MUTED }}>and {earlier.count - 5} more</li>}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="gap-1.5"
                disabled={answeringEarlier !== null}
                onClick={() => void answerEarlier("send")}
                style={{ background: "var(--cc-cta)", color: "#fff" }}
              >
                {answeringEarlier === "send" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Send them to Xero
              </Button>
              <Button size="sm" variant="outline" disabled={answeringEarlier !== null} onClick={() => void answerEarlier("skip")}>
                Leave them out
              </Button>
            </div>
          </section>
        )}

        {/* How syncing is going */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <PanelHeading>Syncing</PanelHeading>
            <Button variant="outline" size="sm" onClick={sync} disabled={syncing} className="gap-1.5">
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync now
            </Button>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-cc-border rounded-xl border border-cc-border">
            {[
              { label: "In Xero", value: status.counts?.in_xero ?? 0 },
              { label: "Waiting to send", value: status.counts?.waiting ?? 0 },
              { label: "Need attention", value: status.counts?.failed ?? 0, danger: true },
            ].map((s) => (
              <div key={s.label} className="px-4 py-3">
                <dd className="text-xl font-semibold tabular-nums" style={{ color: s.danger && s.value > 0 ? "var(--cc-danger-text)" : TEXT }}>{s.value}</dd>
                <dt className="text-xs" style={{ color: MUTED }}>{s.label}</dt>
              </div>
            ))}
          </dl>
          <p className="text-xs" style={{ color: MUTED }}>
            {status.last_payment_check_at
              ? `Payments last checked ${when(status.last_payment_check_at)}. Xero is checked every 30 minutes, and whenever someone opens Billing.`
              : "Payments are checked every 30 minutes, and whenever someone opens Billing."}
          </p>
        </section>

        {/* Recent invoices */}
        <section className="space-y-3">
          <PanelHeading>Recent invoices</PanelHeading>
          {recent.length === 0 ? (
            <p className="text-sm" style={{ color: MUTED }}>Nothing sent yet. Approved invoices will appear here.</p>
          ) : (
            <ul className="divide-y divide-cc-border rounded-xl border border-cc-border">
              {recent.map((row) => {
                const state = xeroState(row);
                return (
                  <li key={row.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium tabular-nums" style={{ color: TEXT }}>{row.invoice_number}</p>
                        <p className="truncate text-xs" style={{ color: MUTED }}>
                          {row.payer || "No payer"}{row.at ? ` · ${when(row.at)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[13px] font-semibold tabular-nums" style={{ color: TEXT }}>{money(row.total_cents, row.currency)}</span>
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: state.fg, background: state.bg }}>{state.label}</span>
                      </div>
                    </div>
                    {row.error && <p className="mt-1.5 text-xs" style={{ color: "var(--cc-danger-text)" }}>{row.error}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Settings */}
        <section className="space-y-4">
          <PanelHeading>How invoices arrive in Xero</PanelHeading>
          <div className="space-y-1.5">
            <Label htmlFor="xero-account" className="text-[13px]">Sales account</Label>
            <Select value={draft.sales_account_code} onValueChange={(v) => setDraft({ ...draft, sales_account_code: v })}>
              <SelectTrigger id="xero-account"><SelectValue /></SelectTrigger>
              <SelectContent>
                {accountChoices.map((a) => (
                  <SelectItem key={a.code} value={a.code}>{a.name ? `${a.code} · ${a.name}` : a.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs" style={{ color: MUTED }}>
              {optionsQuery.isLoading ? "Loading your Xero accounts..." : optionsQuery.isError ? "Couldn't load your Xero accounts." : "Where the invoice lines are recorded."}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xero-tax" className="text-[13px]">Tax rate</Label>
            <Select value={draft.tax_type} onValueChange={(v) => setDraft({ ...draft, tax_type: v })}>
              <SelectTrigger id="xero-tax"><SelectValue /></SelectTrigger>
              <SelectContent>
                {taxChoices.map((t) => (
                  <SelectItem key={t.type} value={t.type}>{t.name || t.type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs" style={{ color: MUTED }}>NDIS supports are usually GST-free.</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium" style={{ color: TEXT }}>In Xero, invoices arrive</p>
            <div role="radiogroup" aria-label="In Xero, invoices arrive" className="inline-flex rounded-lg border border-cc-border p-1">
              {([
                { value: "AUTHORISED", label: "Approved" },
                { value: "DRAFT", label: "As drafts" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={draft.invoice_status === opt.value}
                  onClick={() => setDraft({ ...draft, invoice_status: opt.value })}
                  className="h-8 rounded-md px-3 text-sm font-medium transition-colors"
                  style={draft.invoice_status === opt.value ? { background: PURPLE_SOFT, color: PURPLE } : { color: MUTED }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-xs" style={{ color: MUTED }}>
              {draft.invoice_status === "AUTHORISED"
                ? "Ready to receive payments as soon as they arrive."
                : "Someone approves each one in Xero before it can be paid."}
            </p>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium" style={{ color: TEXT }}>Send each invoice when it's approved</p>
              <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                Off: invoices go only when you press Send to Xero on the invoice, or Sync now.
              </p>
            </div>
            <Switch aria-label="Send each invoice when it's approved" checked={draft.auto_send} onCheckedChange={(v) => setDraft({ ...draft, auto_send: v })} />
          </div>
          <p className="text-xs" style={{ color: MUTED }}>Cancelling an invoice here voids it in Xero.</p>
        </section>

        <section className="space-y-4">
          <PanelHeading>Payments</PanelHeading>
          <p className="text-[13px]" style={{ color: MUTED }}>
            Payments recorded in Xero mark the invoice paid here. Pressing Mark paid here records the payment in Xero too,
            so it's only ever entered once.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="xero-bank" className="text-[13px]">Bank account for payments marked here</Label>
            <Select
              value={draft.payment_account_id || "auto"}
              onValueChange={(v) => {
                const bank = bankChoices.find((b) => b.id === v);
                setDraft({
                  ...draft,
                  payment_account_id: v === "auto" ? null : v,
                  payment_account_name: v === "auto" ? null : bank?.name ?? null,
                });
              }}
            >
              <SelectTrigger id="xero-bank"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  {banks.length === 1 ? `${banks[0].name} (your only bank account)` : "Choose an account"}
                </SelectItem>
                {bankChoices.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.code ? `${b.code} · ${b.name}` : b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs" style={{ color: banks.length > 1 && !draft.payment_account_id ? "var(--cc-danger-text)" : MUTED }}>
              {optionsQuery.isLoading
                ? "Loading your Xero bank accounts..."
                : banks.length > 1 && !draft.payment_account_id
                  ? "You have more than one bank account in Xero. Choose one, or payments marked here won't reach Xero."
                  : "The account the money is paid into, so it matches in bank reconciliation."}
            </p>
          </div>
        </section>
      </SidePanel>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Xero?</AlertDialogTitle>
            <AlertDialogDescription>
              New invoices will stop going to Xero, and payments in Xero won't be picked up. Invoices already in Xero stay
              there. You can connect again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction onClick={() => void disconnect()} style={{ background: "var(--cc-danger-text)", color: "#fff" }}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function XeroTile({ status }: { status: XeroStatus }) {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const connect = async () => {
    setConnecting(true);
    try {
      const { url } = await startXeroConnect();
      window.location.assign(url);
    } catch (err) {
      setConnecting(false);
      toast({ title: "Couldn't start connecting to Xero", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };
  const tileStatus: TileStatus = status.connected
    ? status.last_error || (status.counts?.failed ?? 0) > 0 ? "attention" : "connected"
    : status.available ? "available" : "unavailable";

  return (
    <>
      <IntegrationTile
        logo={<XeroWordmark />}
        logoIsName
        name="Xero"
        category="Accounting"
        description="Approved invoices go to Xero on their own, and payments sync both ways."
        status={tileStatus}
        detail={
          status.connected ? (
            status.earlier?.count ? (
              <>{status.earlier.count} older {status.earlier.count === 1 ? "invoice needs" : "invoices need"} your answer. Open Manage.</>
            ) : (
              <>Connected to <span className="font-semibold">{status.tenant_name || "your Xero organisation"}</span></>
            )
          ) : undefined
        }
        action={
          status.connected ? (
            <Button variant="outline" size="sm" onClick={() => setPanelOpen(true)}>Manage</Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!status.available || connecting}
              onClick={connect}
              style={{ background: "var(--cc-cta)", color: "#fff" }}
              title={status.available ? undefined : "Xero isn't switched on for this CareCliQ account yet. Contact CareCliQ support."}
            >
              {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
              Connect to Xero
            </Button>
          )
        }
      />
      {status.connected && (
        <XeroPanel open={panelOpen} onOpenChange={setPanelOpen} status={status} onReconnect={connect} />
      )}
    </>
  );
}

function ApiTile() {
  const [open, setOpen] = useState(false);
  const query = useOrgQuery(["integrations", "api"], { queryFn: getApiOverview, staleTime: 30_000, retry: false });
  const keys = (query.data?.keys ?? []).filter((k) => !k.revoked_at).length;
  const hooks = query.data?.webhooks ?? [];
  const failing = hooks.some((h) => h.active && h.failure_count > 0);
  const status: TileStatus = failing ? "attention" : keys || hooks.length ? "connected" : "available";
  const detail = keys || hooks.length
    ? `${keys} ${keys === 1 ? "key" : "keys"} · ${hooks.length} ${hooks.length === 1 ? "webhook" : "webhooks"}`
    : undefined;
  return (
    <>
      <IntegrationTile
        logo={<LogoSlot name="API" icon={<Webhook className="h-5 w-5" style={{ color: PURPLE }} />} />}
        name="API and webhooks"
        category="For developers"
        description="Let systems such as CORA Workforce read your workers, credentials and training, and hear about changes."
        status={query.isError ? "unavailable" : status}
        detail={detail}
        action={
          <Button size="sm" variant="outline" disabled={!query.data} onClick={() => setOpen(true)}>
            {keys || hooks.length ? "Manage" : "Set up"}
          </Button>
        }
      />
      {query.data && <ApiAccessPanel open={open} onOpenChange={setOpen} overview={query.data} />}
    </>
  );
}

export function IntegrationsSection({ onSuggest }: { onSuggest?: () => void } = {}) {
  const statusQuery = useOrgQuery(["integrations", "xero"], { queryFn: getXeroStatus, staleTime: 30_000 });
  return (
    <div className="space-y-5">
      <div className="border-b border-cc-border pb-4">
        <h2 className="text-[22px] font-semibold tracking-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
          Integrations
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed" style={{ color: MUTED }}>
          Connect CareCliQ to the other systems your organisation uses, so the same work isn't entered twice.
        </p>
      </div>

      {statusQuery.isError && (
        <p role="alert" className="rounded-lg px-4 py-3 text-sm" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-danger-text)" }}>
          Couldn't load your integrations. {statusQuery.error instanceof Error ? statusQuery.error.message : ""}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statusQuery.isLoading ? (
          <div className="flex min-h-[220px] items-center justify-center gap-2 rounded-xl border border-cc-border bg-cc-surface text-sm" style={{ color: MUTED }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Xero...
          </div>
        ) : statusQuery.data ? (
          <XeroTile status={statusQuery.data} />
        ) : null}

        <MyobTile />

        <ApiTile />

        <article className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-cc-border p-5 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: PURPLE_SOFT, color: PURPLE }}>
            <Plus className="h-5 w-5" />
          </span>
          <h3 className="mt-3 text-[15px] font-semibold" style={{ color: TEXT }}>Need another integration?</h3>
          <p className="mt-1 max-w-[16rem] text-[13px] leading-relaxed" style={{ color: MUTED }}>
            Tell us which system you use and we'll look at connecting it.
          </p>
          {onSuggest && (
            <Button variant="ghost" size="sm" className="mt-2" style={{ color: PURPLE }} onClick={onSuggest}>
              Suggest an integration
            </Button>
          )}
        </article>
      </div>
    </div>
  );
}

/**
 * Settings > Integrations: the MYOB tile and its own Manage page
 * (?section=integrations&integration=myob).
 *
 * MYOB Business (AccountRight) works like Xero: approved invoices go to MYOB
 * as service sales invoices, and invoices paid in MYOB are marked paid here.
 * An organisation uses one of the two, so while Xero is connected the tile
 * says to disconnect Xero first.
 *
 * MYOB's logo isn't bundled yet, so the tile shows the name in the logo slot.
 * When MYOB's official logo is added (public/integrations/MYOB), pass it as
 * LogoSlot's src, unaltered.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import {
  disconnectMyob,
  getMyobOptions,
  getMyobStatus,
  saveMyobSettings,
  startMyobConnect,
  syncMyobNow,
  type MyobSettings,
  type MyobStatus,
} from "@/services/myobService";
import { IntegrationTile, LogoSlot } from "./IntegrationsSection";
import { DisconnectRow, IntegrationPage, PanelHeading } from "./IntegrationPage";
import { myobTileStatus } from "./integrationStatus";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const PURPLE = "var(--cc-brand-purple)";
const PURPLE_SOFT = "var(--cc-brand-purple-soft)";

function when(iso?: string | null) {
  if (!iso) return null;
  return `${formatAppDate(iso, null, { day: "numeric", month: "short" })}, ${formatAppTime(iso)}`;
}

function money(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(cents / 100);
}

function myobState(row: NonNullable<MyobStatus["recent"]>[number]) {
  if (row.error) return { label: "Needs attention", fg: "var(--cc-danger-text)", bg: "var(--cc-status-danger-bg)" };
  switch (row.myob_status) {
    case "Closed": return { label: "Paid in MYOB", fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" };
    case "Open": return { label: "Awaiting payment", fg: PURPLE, bg: PURPLE_SOFT };
    case "Deleted": return { label: "Deleted in MYOB", fg: MUTED, bg: "var(--cc-soft)" };
    default: return { label: "In MYOB", fg: PURPLE, bg: PURPLE_SOFT };
  }
}

/** Starts the MYOB sign-in; MYOB sends the director back to /integrations/myob/callback. */
function useMyobConnect() {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState(false);
  const connect = async () => {
    setConnecting(true);
    try {
      const { url } = await startMyobConnect();
      window.location.assign(url);
    } catch (err) {
      setConnecting(false);
      toast({ title: "Couldn't start connecting to MYOB", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };
  return { connect, connecting };
}

/** Connected MYOB's own page inside Settings > Integrations. */
export function MyobManageRoute({ status, onBack }: { status: MyobStatus; onBack: () => void }) {
  const { connect } = useMyobConnect();
  return <MyobManagePage status={status} onReconnect={connect} onBack={onBack} />;
}

function MyobManagePage({
  status, onReconnect, onBack,
}: {
  status: MyobStatus;
  onReconnect: () => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("integrations") });
  const [draft, setDraft] = useState<MyobSettings>(status.settings);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  useEffect(() => setDraft(status.settings), [status.settings]);

  const optionsQuery = useOrgQuery(["integrations", "myob", "options"], {
    queryFn: getMyobOptions,
    enabled: status.connected,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await syncMyobNow();
      const parts = [
        result.sent ? `${result.sent} sent` : null,
        result.paid ? `${result.paid} marked paid` : null,
        result.failed ? `${result.failed} couldn't be sent` : null,
      ].filter(Boolean);
      toast({ title: parts.length ? `MYOB: ${parts.join(", ")}` : "Everything is up to date with MYOB" });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't sync with MYOB", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await saveMyobSettings(draft);
      toast({ title: "MYOB settings saved" });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't save the MYOB settings", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const disconnect = async () => {
    try {
      await disconnectMyob();
      toast({ title: "MYOB disconnected", description: "Invoices already in MYOB stay there." });
      onBack();
      refresh();
    } catch (err) {
      toast({ title: "Couldn't disconnect MYOB", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(status.settings);
  const accounts = optionsQuery.data?.accounts ?? [];
  const taxCodes = optionsQuery.data?.tax_codes ?? [];
  // Keep the saved choice listed even before (or without) MYOB's lists.
  const accountChoices = draft.income_account_uid && !accounts.some((a) => a.uid === draft.income_account_uid)
    ? [{ uid: draft.income_account_uid, label: draft.income_account_name || "Saved account" }, ...accounts]
    : accounts;
  const taxChoices = draft.tax_code_uid && !taxCodes.some((t) => t.uid === draft.tax_code_uid)
    ? [{ uid: draft.tax_code_uid, code: "", label: draft.tax_code_name || "Saved tax code" }, ...taxCodes]
    : taxCodes;
  const needsChoices = !status.settings.income_account_uid || !status.settings.tax_code_uid;
  const recent = status.recent ?? [];

  return (
    <>
      <IntegrationPage
        onBack={onBack}
        status={myobTileStatus(status)}
        title="MYOB"
        subtitle={
          <>
            Accounting · Connected to <span className="font-semibold text-cc-text">{status.business_name || "your MYOB company file"}</span>
            {status.connected_by_name ? ` by ${status.connected_by_name}` : ""}
            {status.connected_at ? ` on ${formatAppDate(status.connected_at)}` : ""}.
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
                  Reconnect MYOB
                </button>
              )}
            </div>
          </div>
        )}
        {needsChoices && (
          <p role="status" className="rounded-lg px-4 py-3 text-sm" style={{ background: "var(--cc-status-warning-bg)", color: TEXT }}>
            Choose the income account and tax code below, then save. Invoices wait until both are set.
          </p>
        )}

        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <div className="min-w-0 space-y-5">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <PanelHeading>Syncing</PanelHeading>
                <Button variant="outline" size="sm" onClick={sync} disabled={syncing} className="gap-1.5">
                  {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Sync now
                </Button>
              </div>
              <dl className="grid grid-cols-3 divide-x divide-cc-border rounded-xl border border-cc-border bg-cc-surface">
                {[
                  { label: "In MYOB", value: status.counts?.in_myob ?? 0 },
                  { label: "Waiting to send", value: status.counts?.waiting ?? 0 },
                  { label: "Couldn't be sent", value: status.counts?.failed ?? 0, danger: true },
                ].map((s) => (
                  <div key={s.label} className="px-4 py-3">
                    <dd className="text-xl font-semibold tabular-nums" style={{ color: s.danger && s.value > 0 ? "var(--cc-danger-text)" : TEXT }}>{s.value}</dd>
                    <dt className="text-xs" style={{ color: MUTED }}>{s.label}</dt>
                  </div>
                ))}
              </dl>
              <p className="text-xs" style={{ color: MUTED }}>
                {status.last_payment_check_at
                  ? `Payments last checked ${when(status.last_payment_check_at)}. MYOB is checked every 30 minutes.`
                  : "Payments are checked every 30 minutes, or press Sync now."}
              </p>
            </section>

            <section className="space-y-3">
              <PanelHeading>Recent invoices</PanelHeading>
              {recent.length === 0 ? (
                <p className="text-sm" style={{ color: MUTED }}>Nothing sent yet. Approved invoices will appear here.</p>
              ) : (
                <ul className="divide-y divide-cc-border rounded-xl border border-cc-border bg-cc-surface">
                  {recent.map((row) => {
                    const state = myobState(row);
                    return (
                      <li key={row.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium tabular-nums" style={{ color: TEXT }}>
                              {row.invoice_number}
                              {row.myob_number && row.myob_number !== row.invoice_number ? ` · MYOB ${row.myob_number}` : ""}
                            </p>
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
          </div>

          <div className="space-y-5 rounded-xl border border-cc-border bg-cc-surface p-5">
            <section className="space-y-4">
              <PanelHeading>How invoices arrive in MYOB</PanelHeading>
              <div className="space-y-1.5">
                <Label htmlFor="myob-account" className="text-[13px]">Income account</Label>
                <Select
                  value={draft.income_account_uid ?? undefined}
                  onValueChange={(v) => setDraft({ ...draft, income_account_uid: v, income_account_name: accountChoices.find((a) => a.uid === v)?.label ?? null })}
                >
                  <SelectTrigger id="myob-account"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                  <SelectContent>
                    {accountChoices.map((a) => (
                      <SelectItem key={a.uid} value={a.uid}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs" style={{ color: MUTED }}>
                  {optionsQuery.isLoading ? "Loading your MYOB accounts..." : optionsQuery.isError ? "Couldn't load your MYOB accounts." : "Where the invoice lines are recorded."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="myob-tax" className="text-[13px]">Tax code</Label>
                <Select
                  value={draft.tax_code_uid ?? undefined}
                  onValueChange={(v) => setDraft({ ...draft, tax_code_uid: v, tax_code_name: taxChoices.find((t) => t.uid === v)?.label ?? null })}
                >
                  <SelectTrigger id="myob-tax"><SelectValue placeholder="Choose a tax code" /></SelectTrigger>
                  <SelectContent>
                    {taxChoices.map((t) => (
                      <SelectItem key={t.uid} value={t.uid}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs" style={{ color: MUTED }}>NDIS supports are usually GST-free (FRE).</p>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[13px] font-medium" style={{ color: TEXT }}>Send each invoice when it's approved</p>
                  <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                    Off: invoices go only when you press Send to MYOB on the invoice, or Sync now.
                  </p>
                </div>
                <Switch aria-label="Send each invoice when it's approved" checked={draft.auto_send} onCheckedChange={(v) => setDraft({ ...draft, auto_send: v })} />
              </div>
              <p className="text-xs" style={{ color: MUTED }}>
                MYOB numbers invoices itself when a CareCliQ number is longer than 13 characters. The CareCliQ number is
                always in the invoice's Customer PO field. Cancelling an invoice here deletes it in MYOB, unless it's been paid there.
              </p>
            </section>
            <div className="flex items-center justify-end gap-3 border-t border-cc-border pt-4">
              {dirty && <span className="mr-auto text-xs" style={{ color: MUTED }}>Unsaved changes</span>}
              <Button onClick={save} disabled={!dirty || saving} className="gap-1.5" style={{ background: "var(--cc-cta)", color: "#fff" }}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save MYOB settings
              </Button>
            </div>
          </div>
        </div>

        <DisconnectRow name="MYOB" onDisconnect={() => setConfirmDisconnect(true)} />
      </IntegrationPage>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect MYOB?</AlertDialogTitle>
            <AlertDialogDescription>
              New invoices will stop going to MYOB, and payments in MYOB won't be picked up. Invoices already in MYOB stay
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

export function MyobTile({ onManage }: { onManage: () => void }) {
  const query = useOrgQuery(["integrations", "myob"], { queryFn: getMyobStatus, staleTime: 30_000, retry: false });
  const { connect, connecting } = useMyobConnect();
  const status = query.data;

  // Hidden until MYOB is switched on for the server (MYOB_CLIENT_ID and
  // MYOB_CLIENT_SECRET set). An organisation already connected still sees it.
  if (!status || (!status.available && !status.connected)) return null;

  const tileStatus = myobTileStatus(status);
  const blocked = Boolean(status?.blocked_by_xero);
  const detail = status?.connected
    ? <>Connected to <span className="font-semibold">{status.business_name || "your MYOB company file"}</span></>
    : blocked
      ? "Xero is connected. Disconnect Xero to use MYOB instead."
      : undefined;

  return (
    <IntegrationTile
        logo={<LogoSlot name="MYOB" />}
        name="MYOB"
        category="Accounting"
        description="Approved invoices go to MYOB automatically, and invoices paid there are marked paid here."
        status={tileStatus}
        detail={detail}
        action={
          status?.connected ? (
            <Button variant="outline" size="sm" onClick={onManage}>Manage</Button>
          ) : (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!status?.available || blocked || connecting}
              onClick={connect}
              style={{ background: "var(--cc-cta)", color: "#fff" }}
              title={
                !status?.available
                  ? "MYOB isn't switched on for this CareCliQ account yet. Contact CareCliQ support."
                  : blocked ? "Disconnect Xero first: invoices go to one accounting system." : undefined
              }
            >
              {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
              Connect to MYOB
            </Button>
          )
        }
    />
  );
}

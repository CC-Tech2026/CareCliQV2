/**
 * Settings > Integrations: the Employment Hero Payroll tile and its own page
 * (?section=integrations&integration=employment-hero).
 *
 * Approved timesheets go to Employment Hero for the pay run, so wages aren't
 * typed in twice. Built for providers with no IT help: connecting is a
 * sign-in, workers are matched to employees by email or name, and the only
 * thing ever asked is who someone is when two employees share a name.
 *
 * Employment Hero's logo isn't bundled, so the tile shows the name in the
 * logo slot.
 */
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  chooseEmploymentHeroBusiness,
  chooseEmploymentHeroEmployee,
  disconnectEmploymentHero,
  getEmploymentHeroOptions,
  getEmploymentHeroStatus,
  saveEmploymentHeroSettings,
  sendEmploymentHeroNow,
  startEmploymentHeroConnect,
  type EmploymentHeroAttention,
  type EmploymentHeroSettings,
  type EmploymentHeroStatus,
} from "@/services/employmentHeroService";
import { IntegrationTile, LogoSlot } from "./IntegrationsSection";
import { DisconnectRow, IntegrationPage, PanelHeading } from "./IntegrationPage";
import { employmentHeroTileStatus } from "./integrationStatus";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const NAME = "Employment Hero";
const NO_WORK_TYPE = "none";

export const EMPLOYMENT_HERO_QUERY = ["integrations", "employment-hero"] as const;

function when(iso?: string | null) {
  if (!iso) return null;
  return `${formatAppDate(iso, null, { day: "numeric", month: "short" })}, ${formatAppTime(iso)}`;
}

/** Starts the Employment Hero sign-in; it sends the director back to /integrations/employment-hero/callback. */
function useEmploymentHeroConnect() {
  const { toast } = useToast();
  const [connecting, setConnecting] = useState(false);
  const connect = async () => {
    setConnecting(true);
    try {
      const { url } = await startEmploymentHeroConnect();
      window.location.assign(url);
    } catch (err) {
      setConnecting(false);
      toast({ title: "Couldn't start connecting to Employment Hero", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };
  return { connect, connecting };
}

export function EmploymentHeroTile({ onManage }: { onManage: () => void }) {
  const query = useOrgQuery(EMPLOYMENT_HERO_QUERY, { queryFn: getEmploymentHeroStatus, staleTime: 30_000, retry: false });
  const { connect, connecting } = useEmploymentHeroConnect();
  const status = query.data;

  // Hidden until Employment Hero is switched on for CareCliQ. An organisation
  // already connected still sees it.
  if (!status || (!status.available && !status.connected)) return null;

  const detail = status.connected
    ? status.needs_business
      ? "Choose which payroll business is yours."
      : <>Connected to <span className="font-semibold">{status.business_name || "your payroll"}</span></>
    : undefined;

  return (
    <IntegrationTile
      logo={<LogoSlot name="EH" />}
      name={NAME}
      category="Payroll"
      description="Approved timesheets go to Employment Hero Payroll for the pay run. Award rates are worked out there."
      status={employmentHeroTileStatus(status)}
      detail={detail}
      action={
        status.connected ? (
          <Button variant="outline" size="sm" onClick={onManage}>Manage</Button>
        ) : (
          <Button size="sm" className="gap-1.5" disabled={connecting} onClick={connect} style={{ background: "var(--cc-cta)", color: "#fff" }}>
            {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
            Connect to {NAME}
          </Button>
        )
      }
    />
  );
}

/** Connected Employment Hero's own page inside Settings > Integrations. */
export function EmploymentHeroManageRoute({ status, onBack }: { status: EmploymentHeroStatus; onBack: () => void }) {
  const { connect } = useEmploymentHeroConnect();
  return <EmploymentHeroManagePage status={status} onReconnect={connect} onBack={onBack} />;
}

function useRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("integrations") });
}

/** When the login sees several payroll businesses: pick this organisation's by name. */
function ChooseBusiness({ status }: { status: EmploymentHeroStatus }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [choice, setChoice] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!choice) return;
    setSaving(true);
    try {
      const next = await chooseEmploymentHeroBusiness(Number(choice));
      toast({ title: `Timesheets will go to ${next.business_name}` });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't choose that business", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="space-y-3 rounded-xl border border-cc-border bg-cc-surface p-5">
      <PanelHeading>Which payroll business is yours?</PanelHeading>
      <p className="text-sm" style={{ color: MUTED }}>
        Your Employment Hero login can see more than one business. Timesheets wait until you choose.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1 space-y-1.5">
          <Label htmlFor="eh-business" className="text-[13px]">Payroll business</Label>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger id="eh-business"><SelectValue placeholder="Choose a business" /></SelectTrigger>
            <SelectContent>
              {(status.businesses ?? []).map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={save} disabled={!choice || saving} className="gap-1.5" style={{ background: "var(--cc-cta)", color: "#fff" }}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Use this business
        </Button>
      </div>
    </section>
  );
}

/** "Who is Sam Lee in Employment Hero?" with the employees to pick from. */
function ChooseEmployee({ item, employees }: { item: EmploymentHeroAttention; employees: Array<{ id: number; name: string }> }) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [choice, setChoice] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const name = item.worker_name || "This worker";
  const save = async () => {
    if (!choice || !item.worker_id) return;
    setSaving(true);
    try {
      const employee = employees.find((e) => String(e.id) === choice);
      await chooseEmploymentHeroEmployee(item.worker_id, Number(choice), employee?.name);
      toast({ title: `${name}'s timesheets are on their way to ${NAME}` });
      refresh();
    } catch (err) {
      toast({ title: "Couldn't save that", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[14rem] flex-1 space-y-1.5">
        <Label htmlFor={`eh-worker-${item.worker_id}`} className="text-[13px]">Who is {name} in {NAME}?</Label>
        <SearchableSelect
          id={`eh-worker-${item.worker_id}`}
          value={choice ?? ""}
          onValueChange={setChoice}
          options={employees.map((e) => ({ value: String(e.id), label: e.name, keywords: String(e.id) }))}
          placeholder="Choose the employee"
          searchPlaceholder="Search employees by name"
          emptyText="No employee matches"
        />
      </div>
      <Button variant="outline" onClick={save} disabled={!choice || saving} className="gap-1.5">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Save
      </Button>
    </div>
  );
}

function EmploymentHeroManagePage({
  status, onReconnect, onBack,
}: {
  status: EmploymentHeroStatus;
  onReconnect: () => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const refresh = useRefresh();
  const [draft, setDraft] = useState<EmploymentHeroSettings>(status.settings);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  useEffect(() => setDraft(status.settings), [status.settings]);

  const optionsQuery = useOrgQuery([...EMPLOYMENT_HERO_QUERY, "options", String(status.business_id ?? "")], {
    queryFn: getEmploymentHeroOptions,
    enabled: status.connected && !status.needs_business,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const attention = status.attention ?? [];
  // One question per worker, however many of their shifts are waiting.
  const unmatched = useMemo(() => {
    const seen = new Map<string, { item: EmploymentHeroAttention; shifts: number }>();
    for (const item of attention) {
      if (!item.needs_employee || !item.worker_id) continue;
      const hit = seen.get(item.worker_id);
      if (hit) hit.shifts += 1;
      else seen.set(item.worker_id, { item, shifts: 1 });
    }
    return [...seen.values()];
  }, [attention]);
  const otherProblems = attention.filter((a) => !a.needs_employee);

  const sendNow = async () => {
    setSending(true);
    try {
      const { result } = await sendEmploymentHeroNow();
      const parts = [
        result.sent ? `${result.sent} sent` : null,
        result.failed ? `${result.failed} still waiting` : null,
      ].filter(Boolean);
      toast({ title: parts.length ? `${NAME}: ${parts.join(", ")}` : `Every approved timesheet is in ${NAME}` });
      refresh();
    } catch (err) {
      toast({ title: `Couldn't send to ${NAME}`, description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await saveEmploymentHeroSettings(draft);
      toast({ title: `${NAME} settings saved` });
      refresh();
    } catch (err) {
      toast({ title: `Couldn't save the ${NAME} settings`, description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const disconnect = async () => {
    try {
      await disconnectEmploymentHero();
      toast({ title: `${NAME} disconnected`, description: `Timesheets already in ${NAME} stay there.` });
      onBack();
      refresh();
    } catch (err) {
      toast({ title: `Couldn't disconnect ${NAME}`, description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(status.settings);
  const workTypes = optionsQuery.data?.work_types ?? [];
  const employees = optionsQuery.data?.employees ?? [];
  const workTypeChoices = draft.sleepover_work_type_id && !workTypes.some((w) => w.id === draft.sleepover_work_type_id)
    ? [{ id: draft.sleepover_work_type_id, name: draft.sleepover_work_type_name || "Saved work type" }, ...workTypes]
    : workTypes;

  return (
    <>
      <IntegrationPage
        onBack={onBack}
        status={employmentHeroTileStatus(status)}
        title={NAME}
        subtitle={
          status.needs_business ? (
            <>Payroll · Connected. Choose your payroll business below.</>
          ) : (
            <>
              Payroll · Connected to <span className="font-semibold text-cc-text">{status.business_name || "your payroll"}</span>
              {status.connected_at ? ` on ${formatAppDate(status.connected_at)}` : ""}.
            </>
          )
        }
      >
        {status.last_error && (
          <div role="alert" className="flex gap-2.5 rounded-lg px-4 py-3 text-sm" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-danger-text)" }}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">{status.last_error}</p>
              {/reconnect/i.test(status.last_error) && (
                <button type="button" onClick={onReconnect} className="mt-1 font-semibold underline underline-offset-2">
                  Reconnect {NAME}
                </button>
              )}
            </div>
          </div>
        )}

        {status.needs_business ? (
          <ChooseBusiness status={status} />
        ) : (
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <div className="min-w-0 space-y-5">
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <PanelHeading>Timesheets</PanelHeading>
                  <Button variant="outline" size="sm" onClick={sendNow} disabled={sending} className="gap-1.5">
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Send now
                  </Button>
                </div>
                <dl className="grid grid-cols-2 divide-x divide-cc-border rounded-xl border border-cc-border bg-cc-surface">
                  {[
                    { label: `In ${NAME}`, value: status.counts?.sent ?? 0 },
                    { label: "Waiting for you", value: status.counts?.failed ?? 0, danger: true },
                  ].map((s) => (
                    <div key={s.label} className="px-4 py-3">
                      <dd className="text-xl font-semibold tabular-nums" style={{ color: s.danger && s.value > 0 ? "var(--cc-danger-text)" : TEXT }}>{s.value}</dd>
                      <dt className="text-xs" style={{ color: MUTED }}>{s.label}</dt>
                    </div>
                  ))}
                </dl>
                <p className="text-xs" style={{ color: MUTED }}>
                  Each timesheet goes when a coordinator approves it.
                  {status.last_sync_at ? ` Last checked ${when(status.last_sync_at)}.` : ""} Anything waiting is tried again every 30 minutes.
                </p>
              </section>

              {unmatched.length > 0 && (
                <section className="space-y-3">
                  <PanelHeading>Who is who in {NAME}</PanelHeading>
                  <p className="text-sm" style={{ color: MUTED }}>
                    These workers couldn't be matched by email or name. Choose who they are once, and their timesheets go straight away.
                  </p>
                  <ul className="divide-y divide-cc-border rounded-xl border border-cc-border bg-cc-surface">
                    {unmatched.map(({ item, shifts }) => (
                      <li key={item.worker_id} className="space-y-2 px-4 py-3">
                        <p className="text-[13px]" style={{ color: MUTED }}>
                          {shifts === 1 ? "1 approved timesheet waiting" : `${shifts} approved timesheets waiting`}
                        </p>
                        {optionsQuery.isLoading ? (
                          <p className="text-sm" style={{ color: MUTED }}>Loading your {NAME} employees...</p>
                        ) : (
                          <ChooseEmployee item={item} employees={employees} />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {otherProblems.length > 0 && (
                <section className="space-y-3">
                  <PanelHeading>Needs a look</PanelHeading>
                  <ul className="divide-y divide-cc-border rounded-xl border border-cc-border bg-cc-surface">
                    {otherProblems.map((item) => (
                      <li key={item.shift_id} className="px-4 py-3">
                        <p className="text-[13px] font-medium" style={{ color: TEXT }}>
                          {item.worker_name || "Shift"}{item.start_time ? ` · ${when(item.start_time)}` : ""}
                        </p>
                        <p className="mt-0.5 text-xs" style={{ color: item.status === "paid" ? MUTED : "var(--cc-danger-text)" }}>{item.message}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <div className="space-y-5 rounded-xl border border-cc-border bg-cc-surface p-5">
              <section className="space-y-4">
                <PanelHeading>How timesheets arrive</PanelHeading>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: TEXT }}>Send each timesheet when it's approved</p>
                    <p className="mt-0.5 text-xs" style={{ color: MUTED }}>Off: they go only when you press Send now.</p>
                  </div>
                  <Switch aria-label="Send each timesheet when it's approved" checked={draft.auto_send} onCheckedChange={(v) => setDraft({ ...draft, auto_send: v })} />
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: TEXT }}>Ready for the pay run</p>
                    <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                      They arrive approved, because a coordinator approved them here. Off: they arrive as submitted, to approve in {NAME}.
                    </p>
                  </div>
                  <Switch aria-label="Arrive approved, ready for the pay run" checked={draft.send_approved} onCheckedChange={(v) => setDraft({ ...draft, send_approved: v })} />
                </div>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[13px] font-medium" style={{ color: TEXT }}>Breaks are unpaid meal breaks</p>
                    <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                      Breaks workers take in the app go with the timesheet. Off: they're marked as paid rest breaks. On: as unpaid meal breaks, so {NAME} takes them off the paid time.
                    </p>
                  </div>
                  <Switch aria-label="Breaks are unpaid meal breaks" checked={!!draft.breaks_unpaid} onCheckedChange={(v) => setDraft({ ...draft, breaks_unpaid: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eh-send-from" className="text-[13px]">Send shifts worked from</Label>
                  <Input
                    id="eh-send-from"
                    type="date"
                    value={draft.send_from ?? ""}
                    onChange={(e) => setDraft({ ...draft, send_from: e.target.value || null })}
                  />
                  <p className="text-xs" style={{ color: MUTED }}>
                    Earlier shifts aren't sent, so pay already entered by hand isn't entered twice.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="eh-sleepover" className="text-[13px]">Sleepovers are paid as</Label>
                  <Select
                    value={draft.sleepover_work_type_id ? String(draft.sleepover_work_type_id) : NO_WORK_TYPE}
                    onValueChange={(v) => {
                      const id = v === NO_WORK_TYPE ? null : Number(v);
                      setDraft({ ...draft, sleepover_work_type_id: id, sleepover_work_type_name: workTypeChoices.find((w) => w.id === id)?.name ?? null });
                    }}
                  >
                    <SelectTrigger id="eh-sleepover"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_WORK_TYPE}>Not chosen yet</SelectItem>
                      {workTypeChoices.map((w) => (
                        <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs" style={{ color: MUTED }}>
                    {optionsQuery.isError
                      ? `Couldn't load your ${NAME} work types.`
                      : "Picked for you when there is one. Shifts with a sleepover wait until it's chosen, so the sleep time isn't paid as ordinary hours."}
                  </p>
                </div>
                <p className="text-xs" style={{ color: MUTED }}>
                  {NAME} works out the pay from the start and finish times, using your award settings there (weekends, evenings,
                  public holidays). Reversing an approval here takes the timesheet back out, unless it's already been paid.
                </p>
              </section>
              <div className="flex items-center justify-end gap-3 border-t border-cc-border pt-4">
                {dirty && <span className="mr-auto text-xs" style={{ color: MUTED }}>Unsaved changes</span>}
                <Button onClick={save} disabled={!dirty || saving} className="gap-1.5" style={{ background: "var(--cc-cta)", color: "#fff" }}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save settings
                </Button>
              </div>
            </div>
          </div>
        )}

        <DisconnectRow
          name={NAME}
          detail={`New timesheets stop going to ${NAME}. Timesheets already there stay there.`}
          onDisconnect={() => setConfirmDisconnect(true)}
        />
      </IntegrationPage>

      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {NAME}?</AlertDialogTitle>
            <AlertDialogDescription>
              Approved timesheets will stop going to {NAME}, and you'll need to enter them there yourself. Timesheets
              already in {NAME} stay there. You can connect again at any time.
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

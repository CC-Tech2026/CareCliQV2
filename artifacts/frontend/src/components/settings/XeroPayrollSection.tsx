/**
 * Xero page > Payroll: approved hours go to Xero Payroll as draft
 * timesheets (services/xero_payroll_service.py on the server).
 *
 * Three states, top to bottom:
 * 1. No payroll access yet: one button that signs in to Xero again with
 *    payroll ticked.
 * 2. Access, set it up: which Xero pay item weekday, Saturday, Sunday,
 *    public holiday and sleepover hours go under (picked by name where it
 *    can), whether breaks are unpaid, and the switch to turn it on.
 * 3. Staff: who each worker is in Xero, matched by email or name; the
 *    director picks anyone who couldn't be matched.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getXeroPayroll, getXeroPayrollOptions, linkXeroEmployee, saveXeroPayroll, startXeroPayrollConnect,
  type XeroPayItemKey,
} from "@/services/xeroPayrollService";
import { PanelHeading } from "./IntegrationPage";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const DANGER = "var(--cc-danger-text)";
const NOT_SET = "__none__";

const PAY_ITEMS: { key: XeroPayItemKey; label: string; hint?: string }[] = [
  { key: "weekday", label: "Weekday hours", hint: "Not chosen: each person's own ordinary pay item." },
  { key: "saturday", label: "Saturday hours" },
  { key: "sunday", label: "Sunday hours" },
  { key: "public_holiday", label: "Public holiday hours" },
  { key: "sleepover", label: "Sleepovers", hint: "One for each sleepover, on the night it starts." },
];

type Draft = { rates: Record<XeroPayItemKey, string | null>; breaks_unpaid: boolean; enabled: boolean };

export function XeroPayrollSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const statusQuery = useOrgQuery(["xero-payroll"], { queryFn: getXeroPayroll });
  const status = statusQuery.data;
  const optionsQuery = useOrgQuery(["xero-payroll-options"], {
    queryFn: getXeroPayrollOptions,
    enabled: !!status?.has_access,
  });
  const options = optionsQuery.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Start from what's saved, filling unchosen pay items with the ones found by name.
  useEffect(() => {
    if (!status || (status.has_access && !options)) return;
    const rates = { ...status.rates };
    for (const item of PAY_ITEMS) {
      if (!rates[item.key] && item.key !== "weekday" && options?.suggested[item.key]) rates[item.key] = options.suggested[item.key] ?? null;
    }
    setDraft({ rates, breaks_unpaid: status.breaks_unpaid, enabled: status.enabled });
  }, [status, options]);

  const rateName = useMemo(() => new Map((options?.earnings_rates ?? []).map((r) => [r.id, r.name])), [options]);
  const dirty = !!draft && !!status && (
    draft.enabled !== status.enabled || draft.breaks_unpaid !== status.breaks_unpaid ||
    PAY_ITEMS.some((i) => (draft.rates[i.key] ?? null) !== (status.rates[i.key] ?? null))
  );
  const missing = draft ? PAY_ITEMS.filter((i) => ["saturday", "sunday", "public_holiday"].includes(i.key) && !draft.rates[i.key]) : [];
  const unmatched = (options?.workers ?? []).filter((w) => !w.employee_id);

  async function allowAccess() {
    setBusy("connect");
    try {
      const { url } = await startXeroPayrollConnect();
      window.location.assign(url);
    } catch (err) {
      toast({ title: "Couldn't open Xero", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
      setBusy(null);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    try {
      const names = Object.fromEntries(PAY_ITEMS.map((i) => [i.key, draft.rates[i.key] ? rateName.get(draft.rates[i.key]!) ?? null : null]));
      await saveXeroPayroll({ enabled: draft.enabled, rates: draft.rates, rate_names: names, breaks_unpaid: draft.breaks_unpaid });
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes("xero-payroll") || q.queryKey.includes("payroll-timesheets") });
      toast({ title: draft.enabled ? "Xero Payroll is on" : "Xero Payroll settings saved" });
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function link(workerId: string, employeeId: string | null) {
    setBusy(workerId);
    try {
      await linkXeroEmployee(workerId, employeeId);
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes("xero-payroll-options") });
    } catch (err) {
      toast({ title: "Couldn't save that", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (!status || !status.connected) return null;

  return (
    <div className="space-y-5 rounded-xl border border-cc-border bg-cc-surface p-5" aria-label="Xero Payroll">
      <section className="space-y-2">
        <PanelHeading>Payroll</PanelHeading>
        <p className="text-[13px]" style={{ color: MUTED }}>
          Send approved hours to Xero Payroll as draft timesheets, one per person per pay period. Your payroll person checks
          them in Xero (evening, night and overtime rates included) and approves the pay run.
        </p>
      </section>

      {status.employment_hero_connected ? (
        <p className="text-sm" style={{ color: MUTED }}>Employment Hero is connected, so hours go there. Disconnect it to use Xero Payroll.</p>
      ) : !status.has_access ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void allowAccess()} disabled={busy === "connect"} className="gap-1.5" style={{ background: "var(--cc-cta)", color: "#fff" }}>
            {busy === "connect" && <Loader2 className="h-4 w-4 animate-spin" />} Allow payroll access in Xero
          </Button>
          <p className="text-xs" style={{ color: MUTED }}>You'll sign in to Xero once more and tick payroll. Invoices keep working as they are.</p>
        </div>
      ) : optionsQuery.isLoading || !draft ? (
        <p role="status" className="text-sm" style={{ color: MUTED }}>Loading your Xero pay items...</p>
      ) : optionsQuery.isError ? (
        <p className="text-sm" style={{ color: DANGER }}>
          {optionsQuery.error instanceof Error ? optionsQuery.error.message : "Couldn't load your Xero pay items."}
        </p>
      ) : (
        <>
          <section className="space-y-3">
            <p className="text-[13px] font-medium" style={{ color: TEXT }}>Which Xero pay item the hours go under</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PAY_ITEMS.map((item) => (
                <div key={item.key} className="space-y-1">
                  <Label htmlFor={`xero-pay-${item.key}`} className="text-[13px]">{item.label}</Label>
                  <Select
                    value={draft.rates[item.key] ?? NOT_SET}
                    onValueChange={(v) => setDraft({ ...draft, rates: { ...draft.rates, [item.key]: v === NOT_SET ? null : v } })}
                  >
                    <SelectTrigger id={`xero-pay-${item.key}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_SET}>{item.key === "weekday" ? "Each person's ordinary pay item" : "Not chosen"}</SelectItem>
                      {(options?.earnings_rates ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {item.hint && <p className="text-xs" style={{ color: MUTED }}>{item.hint}</p>}
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="text-xs" style={{ color: DANGER }}>
                Choose a pay item for {missing.map((m) => m.label.toLowerCase()).join(", ")}, or those hours won't be sent.
              </p>
            )}
          </section>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium" style={{ color: TEXT }}>Breaks are unpaid meal breaks</p>
              <p className="mt-0.5 text-xs" style={{ color: MUTED }}>On: breaks workers take in the app come off their hours. Off: they're paid rest breaks.</p>
            </div>
            <Switch aria-label="Breaks are unpaid meal breaks" checked={draft.breaks_unpaid} onCheckedChange={(v) => setDraft({ ...draft, breaks_unpaid: v })} />
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-medium" style={{ color: TEXT }}>Send hours to Xero Payroll</p>
              <p className="mt-0.5 text-xs" style={{ color: MUTED }}>Adds a Send to Xero button to the Payroll page.</p>
            </div>
            <Switch aria-label="Send hours to Xero Payroll" checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-cc-border pt-4">
            {dirty && <span className="mr-auto text-xs" style={{ color: MUTED }}>Unsaved changes</span>}
            <Button onClick={() => void save()} disabled={!dirty || busy === "save"} className="gap-1.5" style={{ background: "var(--cc-cta)", color: "#fff" }}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Save payroll settings
            </Button>
          </div>

          <section className="space-y-3 border-t border-cc-border pt-4">
            <p className="text-[13px] font-medium" style={{ color: TEXT }}>Staff in Xero</p>
            <p className="text-xs" style={{ color: MUTED }}>
              {unmatched.length
                ? `${unmatched.length} of ${options?.workers.length ?? 0} couldn't be matched by email or name. Choose who they are in Xero.`
                : `All ${options?.workers.length ?? 0} support workers are matched to Xero employees.`}
            </p>
            <ul className="divide-y rounded-lg border border-cc-border">
              {(options?.workers ?? []).map((w) => (
                <li key={w.worker_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" style={{ color: TEXT }}>{w.name ?? "Unnamed worker"}</span>
                    <span className="block truncate text-xs" style={{ color: w.employee_id ? MUTED : DANGER }}>
                      {w.employee_id
                        ? `${w.employee_name} in Xero · ${w.matched_by === "chosen" ? "chosen" : `matched by ${w.matched_by}`}`
                        : "Not matched"}
                    </span>
                  </span>
                  <Select value={w.employee_id ?? NOT_SET} onValueChange={(v) => void link(w.worker_id, v === NOT_SET ? null : v)} disabled={busy === w.worker_id}>
                    <SelectTrigger className="h-9 w-full sm:w-56" aria-label={`Who ${w.name ?? "this worker"} is in Xero`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOT_SET}>Choose an employee</SelectItem>
                      {(options?.employees ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

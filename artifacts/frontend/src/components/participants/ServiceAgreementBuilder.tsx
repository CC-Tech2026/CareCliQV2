import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { listCurrentNdisCatalogue, type NdisCatalogueItem } from "@/services/ndisService";
import {
  createAgreementDraft,
  updateAgreementDraft,
  type AgreementDraftInput,
  type PlanManagementType,
  type SupportFrequency,
  type SupportLocation,
} from "@/services/serviceAgreementService";

export type BuilderDefaults = {
  plan_management_type?: string | null;
  plan_manager_name?: string | null;
  plan_manager_email?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  includes_price_adjustment_clause?: boolean;
  cancellation_notice_hours?: number | null;
  cancellation_fee_percentage?: number | null;
  supports?: Array<{
    support_item_code: string;
    quantity?: number | null;
    rate?: number | null;
    location?: string | null;
    frequency?: string | null;
  }>;
};

type Line = {
  key: number;
  code: string;
  quantity: string;
  rate: string;
  location: SupportLocation | "";
  frequency: SupportFrequency | "";
};

const PLAN_MANAGEMENT: Array<{ value: PlanManagementType; label: string }> = [
  { value: "NDIA-managed", label: "NDIA-managed" },
  { value: "plan-managed", label: "Plan-managed" },
  { value: "self-managed", label: "Self-managed" },
];
const LOCATIONS: Array<{ value: SupportLocation; label: string }> = [
  { value: "home", label: "At home" },
  { value: "other", label: "In the community" },
  { value: "school", label: "School" },
  { value: "preschool", label: "Preschool" },
  { value: "clinic", label: "Clinic" },
];
const FREQUENCIES: Array<{ value: SupportFrequency; label: string }> = [
  { value: "weekly", label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly", label: "Monthly" },
  { value: "as_scheduled", label: "As scheduled" },
];
const UNIT_WORDS: Record<string, string> = { H: "hours", HOUR: "hours", D: "days", WK: "weeks", MON: "months", YR: "years", E: "units" };

const money = (v: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(v);
let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, code: "", quantity: "", rate: "", location: "", frequency: "" });

/** Total for a line: quantity × (entered rate, or the catalogue price limit). */
export function lineTotal(line: Pick<Line, "quantity" | "rate">, item?: Pick<NdisCatalogueItem, "price_national">): number | null {
  const qty = Number(line.quantity);
  const rate = line.rate.trim() ? Number(line.rate) : item?.price_national ?? null;
  if (!Number.isFinite(qty) || qty <= 0 || rate == null || !Number.isFinite(rate)) return null;
  return Math.round(qty * rate * 100) / 100;
}

const selectClass = "h-9 w-full rounded-xl border border-cc-border bg-cc-surface px-2 text-sm text-cc-text";

export function ServiceAgreementBuilder({
  open,
  onOpenChange,
  participantId,
  participantName,
  agreementId,
  defaults,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
  /** Set when editing an existing draft. */
  agreementId?: string | null;
  defaults: BuilderDefaults;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const catalogue = useOrgQuery<NdisCatalogueItem[]>(["ndis", "current-catalogue"], {
    queryFn: listCurrentNdisCatalogue,
    staleTime: 10 * 60_000,
    enabled: open,
  });
  const [planManagement, setPlanManagement] = useState<PlanManagementType>("NDIA-managed");
  const [managerName, setManagerName] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [priceClause, setPriceClause] = useState(true);
  const [noticeHours, setNoticeHours] = useState("");
  const [feePct, setFeePct] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const pmt = PLAN_MANAGEMENT.find((p) => p.value === defaults.plan_management_type)?.value ?? "NDIA-managed";
    setPlanManagement(pmt);
    setManagerName(defaults.plan_manager_name ?? "");
    setManagerEmail(defaults.plan_manager_email ?? "");
    setStart(defaults.start_date?.slice(0, 10) ?? "");
    setEnd(defaults.end_date?.slice(0, 10) ?? "");
    setPriceClause(defaults.includes_price_adjustment_clause ?? true);
    setNoticeHours(defaults.cancellation_notice_hours != null ? String(defaults.cancellation_notice_hours) : "");
    setFeePct(defaults.cancellation_fee_percentage != null ? String(defaults.cancellation_fee_percentage) : "");
    setLines(
      defaults.supports?.length
        ? defaults.supports.map((s) => ({
            key: nextKey++,
            code: s.support_item_code,
            quantity: s.quantity != null ? String(s.quantity) : "",
            rate: s.rate != null ? String(s.rate) : "",
            location: (s.location as SupportLocation) ?? "",
            frequency: (s.frequency as SupportFrequency) ?? "",
          }))
        : [blankLine()],
    );
  }, [open, defaults]);

  const items = useMemo(() => new Map((catalogue.data ?? []).map((i) => [i.item_code, i])), [catalogue.data]);
  const options = useMemo(
    () =>
      (catalogue.data ?? []).map((i) => ({
        value: i.item_code,
        label: i.name,
        keywords: `${i.item_code} ${i.name} ${i.registration_group ?? ""}`,
      })),
    [catalogue.data],
  );

  const totals = lines.map((l) => lineTotal(l, items.get(l.code)));
  const grandTotal = totals.reduce<number>((sum, t) => sum + (t ?? 0), 0);

  const update = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const problems: string[] = [];
  if (!start || !end) problems.push("Set the agreement period.");
  else if (end < start) problems.push("The end date is before the start date.");
  if (!lines.some((l) => l.code)) problems.push("Add at least one support.");
  lines.forEach((l, i) => {
    if (!l.code) return;
    if (!(Number(l.quantity) > 0)) problems.push(`Support ${i + 1}: enter a quantity.`);
    const limit = items.get(l.code)?.price_national;
    if (l.rate.trim()) {
      const rate = Number(l.rate);
      if (!Number.isFinite(rate) || rate < 0) problems.push(`Support ${i + 1}: enter a valid rate.`);
      else if (limit != null && rate > limit + 0.005) problems.push(`Support ${i + 1}: rate is above the NDIS price limit (${money(limit)}).`);
    } else if (limit == null) {
      problems.push(`Support ${i + 1}: this item has no price limit — enter the quoted rate.`);
    }
  });

  const save = async () => {
    if (problems.length) return;
    const draft: AgreementDraftInput = {
      plan_management_type: planManagement,
      plan_manager_name: planManagement === "plan-managed" ? managerName.trim() || null : null,
      plan_manager_email: planManagement === "plan-managed" ? managerEmail.trim() || null : null,
      start_date: start,
      end_date: end,
      includes_price_adjustment_clause: priceClause,
      cancellation_notice_hours: noticeHours.trim() ? Number(noticeHours) : null,
      cancellation_fee_percentage: feePct.trim() ? Number(feePct) : null,
      supports: lines
        .filter((l) => l.code)
        .map((l) => ({
          support_item_code: l.code,
          quantity: Number(l.quantity),
          rate: l.rate.trim() ? Number(l.rate) : null,
          location: l.location || null,
          frequency: l.frequency || null,
        })),
    };
    setSaving(true);
    try {
      if (agreementId) await updateAgreementDraft(agreementId, draft);
      else await createAgreementDraft(participantId, draft);
      toast({ title: agreementId ? "Draft updated" : "Draft agreement created" });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't save the agreement", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{agreementId ? "Edit draft agreement" : "New service agreement"}</SheetTitle>
          <SheetDescription>
            For {participantName}. Rates default to the NDIS price limit for the start date; you can agree a lower rate.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-6 text-sm">
          <section className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-cc-muted">Starts</span>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-cc-muted">Ends</span>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-cc-muted">Plan management</span>
              <select className={selectClass} value={planManagement} onChange={(e) => setPlanManagement(e.target.value as PlanManagementType)}>
                {PLAN_MANAGEMENT.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            {planManagement === "plan-managed" && (
              <>
                <label className="space-y-1">
                  <span className="text-xs text-cc-muted">Plan manager</span>
                  <Input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="e.g. Clearview Plan Management" />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-xs text-cc-muted">Plan manager email (for invoices)</span>
                  <Input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} />
                </label>
              </>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold text-cc-text">Schedule of supports</h3>
            {catalogue.isError && (
              <p role="alert" className="text-xs" style={{ color: "var(--cc-status-danger)" }}>The NDIS price catalogue couldn't be loaded.</p>
            )}
            {lines.map((line, index) => {
              const item = items.get(line.code);
              const total = totals[index];
              return (
                <div key={line.key} className="space-y-2 rounded-xl border border-cc-border p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <SearchableSelect
                        value={line.code}
                        onValueChange={(code) => update(line.key, { code })}
                        options={options}
                        placeholder={catalogue.isLoading ? "Loading NDIS items…" : "Choose an NDIS support item"}
                        searchPlaceholder="Search by name or item number"
                        emptyText="No matching items."
                        disabled={!catalogue.data}
                      />
                      {item && (
                        <p className="mt-1 text-[11px] text-cc-muted">
                          {item.item_code} · price limit {item.price_national != null ? `${money(item.price_national)} per ${UNIT_WORDS[item.unit?.toUpperCase()]?.replace(/s$/, "") ?? "unit"}` : "quoted"}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove support ${index + 1}`}
                      disabled={lines.length === 1}
                      onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="space-y-1">
                      <span className="text-[11px] text-cc-muted">Quantity ({UNIT_WORDS[item?.unit?.toUpperCase() ?? ""] ?? "units"})</span>
                      <Input inputMode="decimal" aria-label={`Quantity for support ${index + 1}`} value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-cc-muted">Rate</span>
                      <Input
                        inputMode="decimal"
                        aria-label={`Rate for support ${index + 1}`}
                        value={line.rate}
                        placeholder={item?.price_national != null ? String(item.price_national) : "Quoted rate"}
                        onChange={(e) => update(line.key, { rate: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-cc-muted">Where</span>
                      <select className={selectClass} value={line.location} onChange={(e) => update(line.key, { location: e.target.value as SupportLocation | "" })}>
                        <option value="">—</option>
                        {LOCATIONS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] text-cc-muted">How often</span>
                      <select className={selectClass} value={line.frequency} onChange={(e) => update(line.key, { frequency: e.target.value as SupportFrequency | "" })}>
                        <option value="">—</option>
                        {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <p className="text-right text-sm font-semibold tabular-nums text-cc-text">{total != null ? money(total) : "—"}</p>
                </div>
              );
            })}
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => setLines((prev) => [...prev, blankLine()])}>
              <Plus size={14} /> Add support
            </Button>
            <div className="flex items-center justify-between rounded-xl bg-cc-soft px-3 py-2.5">
              <span className="font-medium text-cc-text">Total agreed funding</span>
              <span className="font-semibold tabular-nums text-cc-text">{money(grandTotal)}</span>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-cc-muted">Cancellation notice (hours)</span>
              <Input inputMode="numeric" value={noticeHours} onChange={(e) => setNoticeHours(e.target.value)} placeholder="e.g. 48" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-cc-muted">Short-notice cancellation charge (%)</span>
              <Input inputMode="decimal" value={feePct} onChange={(e) => setFeePct(e.target.value)} placeholder="e.g. 100" />
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" checked={priceClause} onChange={(e) => setPriceClause(e.target.checked)} />
              <span className="text-cc-text">Rates follow NDIS Pricing Arrangements updates during the agreement</span>
            </label>
          </section>

          {problems.length > 0 && (
            <ul className="space-y-1 text-xs text-cc-muted">
              {problems.map((p) => <li key={p}>• {p}</li>)}
            </ul>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || problems.length > 0}>
              {saving ? "Saving…" : agreementId ? "Save draft" : "Create draft"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * BulkShiftModal: start a regular schedule (shift series) for a participant,
 * e.g. every Mon/Wed/Fri 9 to 12 with Sam, every week, ongoing. Shifts are
 * made eight weeks ahead and topped up as days pass, so it doesn't run out
 * the way a fixed batch of recurring shifts did. A day the worker can't do
 * becomes an open shift, listed when it's made.
 */
import { useBranches } from "@/hooks/useBranches";
import { ShiftZoneNote } from "@/components/branches/ShiftZoneNote";
import { PARTICIPANT_SEARCH, participantOption, staffOption } from "@/lib/person-options";
import { useState } from "react";
import { format, addDays } from "date-fns";
import { appNow } from "@/lib/datetime";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { Check, Loader2, X, Plus } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { detailIfShared, sharedNames, workerDetail } from "@/lib/person-identity";
import {
  createShiftSeries,
  getParticipantPriceItemOptions,
  getParticipantAgreementSupports,
  type AgreementSupport,
  type ShiftSeriesCreated,
  type WorkerStats,
  type ShiftPriceItemOption,
} from "@/services/coordinatorService";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { TimePicker } from "@/components/ui/time-picker";
import { SeriesOutcome } from "./RegularSchedulesPanel";
import { DurationQuickPicks } from "@/components/ui/duration-quick-picks";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const SHIFT_TYPE_LABELS: Record<string, string> = {
  standard_support: "Standard Support",
  community_access: "Community Access",
  allied_health:    "Allied Health Session",
  respite_care:     "Respite Care",
};

const SHIFT_TYPE_KEYS: Record<string, string> = {
  standard_support: "coordinator.bulkShift.shiftType.standardSupport",
  community_access: "coordinator.bulkShift.shiftType.communityAccess",
  allied_health:    "coordinator.bulkShift.shiftType.alliedHealth",
  respite_care:     "coordinator.bulkShift.shiftType.respiteCare",
};

const DAYS_OF_WEEK = [
  { label: "Mon", value: 0 },
  { label: "Tue", value: 1 },
  { label: "Wed", value: 2 },
  { label: "Thu", value: 3 },
  { label: "Fri", value: 4 },
  { label: "Sat", value: 5 },
  { label: "Sun", value: 6 },
];

interface BulkShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participants: Array<{ id: string; full_name: string; branch_id?: string | null }>;
  workers: WorkerStats[];
  /** Opened from a participant: start with them chosen. */
  initialParticipantId?: string;
}

export function BulkShiftModal({ open, onOpenChange, participants, workers, initialParticipantId }: BulkShiftModalProps) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__";
  const qc = useQueryClient();

  const [participantId, setParticipantId] = useState(initialParticipantId ?? "");
  const [workerId,       setWorkerId]       = useState("");
  const sameWorkerNames = sharedNames(workers.map((w) => w.full_name));
  const [shiftType,      setShiftType]      = useState("standard_support");
  const [startDate,      setStartDate]      = useState(() => format(appNow(), "yyyy-MM-dd"));
  const [startTime,      setStartTime]      = useState("09:00");
  const [endTime,        setEndTime]        = useState("13:00");
  const [intervalWeeks,  setIntervalWeeks]  = useState(1);
  const [endsOn,         setEndsOn]         = useState(""); // "" = keeps going
  const [hasEnd,         setHasEnd]         = useState(false);
  const [selectedDays,   setSelectedDays]   = useState<number[]>([0, 2, 4]); // Mon/Wed/Fri
  const [result,         setResult]         = useState<ShiftSeriesCreated | null>(null);
  const [expectedPriceItemCode, setExpectedPriceItemCode] = useState("");
  const [agreementSupportId, setAgreementSupportId] = useState("");

  // Supports on the participant's sent or signed agreements. Warnings for the
  // whole series (dates, signing, hours) come back once the shifts are made.
  const agreementSupportsQuery = useOrgQuery<AgreementSupport[]>(
    [orgId, "participant-agreement-supports", participantId],
    {
      queryFn: () => getParticipantAgreementSupports(participantId),
      enabled: !!participantId,
      staleTime: 30_000,
    }
  );
  const chooseParticipant = (id: string) => {
    setParticipantId(id);
    setAgreementSupportId("");
  };
  const chooseAgreementSupport = (id: string) => {
    const line = (agreementSupportsQuery.data ?? []).find((l) => l.id === id);
    setAgreementSupportId(line ? id : "");
    if (line) setExpectedPriceItemCode(line.support_item_code);
  };

  const priceItemsQuery = useOrgQuery<ShiftPriceItemOption[]>(
    [orgId, "participant-price-items", participantId],
    {
      queryFn: () => getParticipantPriceItemOptions(participantId),
      enabled: !!participantId,
      staleTime: 60_000,
    }
  );

  const toggleDay = (d: number) =>
    setSelectedDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  const handleSetDuration = (hours: number) => {
    const [h, m] = startTime.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const totalMinutes = h * 60 + m + hours * 60;
    const endH = Math.floor(totalMinutes / 60) % 24;
    const endM = totalMinutes % 60;
    setEndTime(`${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`);
  };

  const activeDurationHours = (() => {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
    let diffMinutes = (eh * 60 + em) - (sh * 60 + sm);
    if (diffMinutes <= 0) diffMinutes += 24 * 60; // overnight shift
    return diffMinutes % 60 === 0 ? diffMinutes / 60 : null;
  })();

  // Shifts in an average week: three days every second week is 1.5.
  const perWeek = selectedDays.length / intervalWeeks;
  const endDate = hasEnd && endsOn ? endsOn : null;

  const mutation = useMutation({
    mutationFn: () =>
      createShiftSeries({
        participant_id:    participantId,
        days_of_week:      selectedDays,
        start_time:        startTime,
        end_time:          endTime,
        start_date:        startDate,
        end_date:          endDate,
        interval_weeks:    intervalWeeks,
        shift_type:        shiftType,
        worker_id:         workerId || null,
        expected_price_item_code: expectedPriceItemCode || undefined,
        service_agreement_support_id: agreementSupportId || undefined,
      }),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      qc.invalidateQueries({ queryKey: [orgId, "shift-series"] });
    },
    onError: (err: Error) => {
      toast({ title: translate("coordinator.bulkShift.createFailed"), description: err.message, variant: "destructive" });
    },
  });

  function handleClose() {
    if (!mutation.isPending) {
      onOpenChange(false);
      setTimeout(() => {
        setResult(null);
        setParticipantId(initialParticipantId ?? "");
        setWorkerId("");
        setExpectedPriceItemCode("");
        setAgreementSupportId("");
      }, 300);
    }
  }

  const participant = participants.find((p) => p.id === participantId);
  // The shifts are made on the participant's clock (their branch).
  const { zoneFor } = useBranches();
  const participantZone = zoneFor(participant?.branch_id);
  const worker      = workers.find((w) => w.id === workerId);
  const endBeforeStart = !!endDate && endDate < startDate;
  const canSubmit   = !!participantId && selectedDays.length > 0 && !!startTime && !!endTime && startTime !== endTime
    && !(hasEnd && !endsOn) && !endBeforeStart;
  const dayList = [...selectedDays].sort((a, b) => a - b).map((d) => DAYS_OF_WEEK[d]?.label).join(", ");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent hideCloseButton className="max-w-md rounded-2xl p-0 overflow-hidden gap-0" style={{ borderColor: BORDER }}>
        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <DialogTitle className="text-[18px] font-black" style={{ color: TEXT }}>New regular schedule</DialogTitle>
            <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>The same days and hours each week. Shifts are kept made eight weeks ahead.</p>
          </div>
          <button onClick={handleClose} className="rounded-lg p-1.5 hover:bg-gray-100" title={translate("coordinator.bulkShift.closeModal")} aria-label={translate("coordinator.bulkShift.closeModal")}>
            <X size={16} style={{ color: MUTED }} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
          {result ? (
            // ── Result summary ──────────────────────────────────────────────
            <SeriesOutcome
              made={result.created_count}
              summary={`${result.series.participant_name ?? participant?.full_name ?? "Participant"}: ${dayList} ${startTime} to ${endTime}`}
              opened={result.opened}
              skipped={result.skipped}
            />
          ) : (
            // ── Form ────────────────────────────────────────────────────────
            <div className="space-y-5">
              {/* Participant */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.bulkShift.participant")}</label>
                <SearchableSelect
                  value={participantId}
                  onValueChange={chooseParticipant}
                  options={participants.map(participantOption)}
                  placeholder={translate("coordinator.bulkShift.selectParticipant")}
                  searchPlaceholder={PARTICIPANT_SEARCH}
                  emptyText="No participant matches"
                />
              </div>

              {/* Worker (optional) */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>
                  Worker <span className="font-normal">({translate("common.optional")})</span>
                </label>
                {/* "__none__" means open shifts. Searchable, with staff ID and
                    suburb, so the right person is found among a large team. */}
                <SearchableSelect
                  value={workerId || "__none__"}
                  onValueChange={(v) => setWorkerId(v === "__none__" ? "" : v)}
                  placeholder={translate("coordinator.bulkShift.selectWorker")}
                  searchPlaceholder={translate("coordinator.shiftAssign.searchWorker")}
                  emptyText={translate("common.noResults")}
                  options={[
                    { value: "__none__", label: translate("coordinator.bulkShift.noAutoAssign"), keywords: "none open" },
                    ...workers.map(staffOption),
                  ]}
                  renderTrigger={(selected) => {
                    const w = workers.find((x) => x.id === selected?.value);
                    const detail = w ? detailIfShared(w, sameWorkerNames) : null;
                    return selected ? (detail ? `${selected.label} · ${detail}` : selected.label) : translate("coordinator.bulkShift.selectWorker");
                  }}
                  renderOption={(option) => {
                    const w = workers.find((x) => x.id === option.value);
                    const detail = w ? workerDetail(w) : null;
                    return (
                      <span className="min-w-0">
                        <span className="block truncate">{option.label}</span>
                        {detail && <span className="block truncate text-[11px]" style={{ color: MUTED }}>{detail}</span>}
                      </span>
                    );
                  }}
                />
              </div>

              {/* Agreed support: hours for every occurrence count against it,
                  and it sets the expected NDIS item below. */}
              {participantId && (agreementSupportsQuery.data ?? []).length > 0 && (
                <div className="space-y-2">
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>
                    Agreed support <span className="font-normal">({translate("common.optional")})</span>
                  </label>
                  <Select value={agreementSupportId || "__none__"} onValueChange={(val) => chooseAgreementSupport(val === "__none__" ? "" : val)}>
                    <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                      <SelectValue placeholder="Not linked to an agreement" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not linked to an agreement</SelectItem>
                      {(agreementSupportsQuery.data ?? []).map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.item_name ?? l.support_item_code}
                          {l.counted && l.left_hours != null
                            ? l.left_hours < 0 ? ` (${Number((-l.left_hours).toFixed(2))}h over)` : ` (${Number(l.left_hours.toFixed(2))}h left)`
                            : ""}
                          {l.agreement_status === "pending_signature" ? " · Not signed yet" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Expected NDIS item — applied to every occurrence this
                  request generates; cross-checked (warn, not blocked)
                  against whatever's actually picked when each shift is
                  verified. */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>
                  Expected NDIS item <span className="font-normal">({translate("common.optional")})</span>
                </label>
                <SearchableSelect
                  value={expectedPriceItemCode || "__none__"}
                  onValueChange={(val) => setExpectedPriceItemCode(val === "__none__" ? "" : val)}
                  placeholder={priceItemsQuery.isLoading ? "Loading price items…" : "None recorded"}
                  searchPlaceholder="Search by name or item code…"
                  emptyText={translate("common.noResults")}
                  disabled={!participantId || priceItemsQuery.isLoading}
                  options={[
                    { value: "__none__", label: "None recorded", keywords: "none recorded" },
                    ...[...(priceItemsQuery.data ?? [])]
                      .sort((a, b) =>
                        (a.category_number ?? "").localeCompare(b.category_number ?? "")
                        || a.item_code.localeCompare(b.item_code)
                      )
                      .map((p) => {
                        const name = p.name || p.support_purpose || "Unnamed item";
                        const priceSuffix = p.price_national != null
                          ? p.unit === "E"
                            ? ` ($${p.price_national.toFixed(2)} flat)`
                            : ` ($${p.price_national.toFixed(2)}/hr)`
                          : "";
                        return {
                          value: p.item_code,
                          label: `${p.item_code}: ${name}${priceSuffix}`,
                          keywords: `${p.item_code} ${name}`,
                          group: p.category_label ?? (p.category_number ? `Category ${p.category_number}` : "Other"),
                        };
                      }),
                  ]}
                />
                {(() => {
                  const selected = (priceItemsQuery.data ?? []).find((p) => p.item_code === expectedPriceItemCode);
                  if (!selected || selected.price_national == null) return null;
                  const isFlat = selected.unit === "E";
                  const perShift = isFlat
                    ? selected.price_national
                    : activeDurationHours != null
                    ? selected.price_national * activeDurationHours
                    : null;
                  return (
                    <p className="text-[12px] font-bold" style={{ color: TEXT }}>
                      Estimated: {perShift != null ? `$${perShift.toFixed(2)}/shift` : "—"}
                      {perShift != null && perWeek > 0 && (
                        <span className="ml-1 font-normal" style={{ color: MUTED }}>
                          (about ${(perShift * perWeek).toFixed(2)} a week)
                        </span>
                      )}
                      {perShift == null && (
                        <span className="ml-1 font-normal" style={{ color: MUTED }}>
                          {isFlat ? "" : "(set start/end time to estimate)"}
                        </span>
                      )}
                    </p>
                  );
                })()}
              </div>

              {/* Shift type */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.bulkShift.shiftType")}</label>
                <Select value={shiftType} onValueChange={setShiftType}>
                  <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SHIFT_TYPE_LABELS).map(([v]) => (
                      <SelectItem key={v} value={v}>{translate(SHIFT_TYPE_KEYS[v])}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Days of week */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.bulkShift.repeatDays")}</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS_OF_WEEK.map(({ label, value }) => {
                    const active = selectedDays.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => toggleDay(value)}
                        className="h-8 w-12 rounded-lg text-[11px] font-black transition-colors"
                        style={{
                          background: active ? PLUM : SOFT,
                          color: active ? "white" : MUTED,
                          border: `1px solid ${active ? PLUM : BORDER}`,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Times */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.bulkShift.startTime")}</label>
                  <TimePicker
                    value={startTime}
                    onChange={setStartTime}
                    placeholder={translate("coordinator.bulkShift.timePlaceholder")}
                    className="rounded-xl px-3 py-2 text-[13px]"
                    style={{ borderColor: BORDER }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.bulkShift.endTime")}</label>
                  <TimePicker
                    value={endTime}
                    onChange={setEndTime}
                    placeholder={translate("coordinator.bulkShift.timePlaceholder")}
                    className="rounded-xl px-3 py-2 text-[13px]"
                    style={{ borderColor: BORDER }}
                  />
                </div>
              </div>
              <DurationQuickPicks onSelect={handleSetDuration} activeHours={activeDurationHours} />
              <ShiftZoneNote tz={participantZone} />

              {/* How often, from when, until when */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label htmlFor="series-repeats" className="text-[12px] font-black" style={{ color: TEXT }}>Repeats</label>
                  <Select value={String(intervalWeeks)} onValueChange={(v) => setIntervalWeeks(Number(v))}>
                    <SelectTrigger id="series-repeats" className="rounded-xl" style={{ borderColor: BORDER }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Every week</SelectItem>
                      <SelectItem value="2">Every 2 weeks</SelectItem>
                      <SelectItem value="3">Every 3 weeks</SelectItem>
                      <SelectItem value="4">Every 4 weeks</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="series-start" className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.bulkShift.startingFrom")}</label>
                  <input
                    id="series-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border bg-transparent px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: BORDER }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <span className="text-[12px] font-black" style={{ color: TEXT }}>Ends</span>
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Ends">
                  {[
                    { value: false, label: "Keeps going" },
                    { value: true, label: "On a date" },
                  ].map((o) => (
                    <button
                      key={String(o.value)}
                      type="button"
                      role="radio"
                      aria-checked={hasEnd === o.value}
                      onClick={() => setHasEnd(o.value)}
                      className="h-9 rounded-full border px-3.5 text-[12px] font-semibold"
                      style={hasEnd === o.value
                        ? { background: "var(--cc-cta)", color: "white", borderColor: "var(--cc-cta)" }
                        : { borderColor: BORDER, color: MUTED }}
                    >
                      {o.label}
                    </button>
                  ))}
                  {hasEnd && (
                    <input
                      type="date"
                      aria-label="Last day"
                      value={endsOn}
                      min={startDate}
                      onChange={(e) => setEndsOn(e.target.value)}
                      className="h-9 rounded-xl border bg-transparent px-3 text-[13px] outline-none"
                      style={{ borderColor: endBeforeStart ? CORAL : BORDER }}
                    />
                  )}
                </div>
                {endBeforeStart && <p className="text-[11px]" style={{ color: CORAL }}>The last day is before the first.</p>}
              </div>

              {/* Summary preview */}
              {canSubmit && (
                <div className="rounded-xl border p-3.5" style={{ borderColor: BORDER, background: SOFT }}>
                  <p className="text-[11px] font-black uppercase tracking-widest mb-2" style={{ color: MUTED }}>{translate("coordinator.bulkShift.summary")}</p>
                  <div className="space-y-1 text-[12px]">
                    {[
                      [translate("common.participant"), participant?.full_name || "N/A"],
                      [translate("common.worker"), worker ? worker.full_name : "Open shifts for someone to pick up"],
                      [translate("coordinator.bulkShift.schedule"), `${dayList} · ${startTime} to ${endTime}`],
                      ["Repeats", intervalWeeks === 1 ? "Every week" : `Every ${intervalWeeks} weeks`],
                      ["From", format(new Date(startDate + "T00:00:00"), "EEE d MMM yyyy")],
                      ["Until", endDate ? format(new Date(endDate + "T00:00:00"), "EEE d MMM yyyy") : "Keeps going"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-4">
                        <span style={{ color: MUTED }}>{label}</span>
                        <span className="font-bold text-right" style={{ color: TEXT }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: `1px solid ${BORDER}` }}>
          {result ? (
            <>
              <button
                onClick={handleClose}
                className="rounded-full px-4 py-2 text-[12px] font-bold text-white"
                style={{ background: "var(--cc-cta)" }}
              >
                <Check size={12} className="inline mr-1.5" />{translate("coordinator.bulkShift.done")}
              </button>
            </>
          ) : (
            <>
              <button onClick={handleClose} disabled={mutation.isPending} className="rounded-full px-4 py-2 text-[12px] font-bold" style={{ background: SOFT, color: MUTED }}>
                Cancel
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={!canSubmit || mutation.isPending}
                className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold text-white"
                style={{
                  background: canSubmit && !mutation.isPending ? "var(--cc-cta)" : MUTED,
                }}
              >
                {mutation.isPending ? (
                  <><Loader2 size={12} className="animate-spin" /> {translate("coordinator.bulkShift.creating")}</>
                ) : (
                  <><Plus size={12} /> Start regular schedule</>
                )}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

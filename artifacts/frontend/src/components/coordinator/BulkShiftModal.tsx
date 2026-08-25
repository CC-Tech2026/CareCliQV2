/**
 * BulkShiftModal — CARECLIQV2-235
 * Create recurring shifts (every Mon/Wed/Fri for N weeks).
 */
import { useState } from "react";
import { format, addDays } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  Calendar, Clock, Check, AlertTriangle, Loader2, X, Plus,
} from "lucide-react";
import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  bulkCreateShifts,
  type BulkShiftResult,
  type WorkerStats,
} from "@/services/coordinatorService";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { TimePicker } from "@/components/ui/time-picker";
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
  participants: Array<{ id: string; full_name: string }>;
  workers: WorkerStats[];
}

export function BulkShiftModal({ open, onOpenChange, participants, workers }: BulkShiftModalProps) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__";
  const qc = useQueryClient();

  const [participantId, setParticipantId] = useState("");
  const [workerId,       setWorkerId]       = useState("");
  const [shiftType,      setShiftType]      = useState("standard_support");
  const [startDate,      setStartDate]      = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [startTime,      setStartTime]      = useState("09:00");
  const [endTime,        setEndTime]        = useState("13:00");
  const [weeks,          setWeeks]          = useState(4);
  const [selectedDays,   setSelectedDays]   = useState<number[]>([0, 2, 4]); // Mon/Wed/Fri
  const [result,         setResult]         = useState<BulkShiftResult | null>(null);
  const [confirmed,      setConfirmed]      = useState(false);

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

  const totalShifts = selectedDays.length * weeks;

  const mutation = useMutation({
    mutationFn: (confirmConflicts: boolean) =>
      bulkCreateShifts({
        participant_id:    participantId,
        days_of_week:      selectedDays,
        start_time:        startTime,
        end_time:          endTime,
        start_date:        startDate,
        weeks,
        shift_type:        shiftType,
        worker_id:         workerId || undefined,
        confirm_conflicts: confirmConflicts,
      }),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
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
        setConfirmed(false);
        setParticipantId("");
        setWorkerId("");
      }, 300);
    }
  }

  const participant = participants.find((p) => p.id === participantId);
  const worker      = workers.find((w) => w.id === workerId);
  const canSubmit   = participantId && selectedDays.length > 0 && weeks > 0 && startTime && endTime;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden gap-0" style={{ borderColor: BORDER }}>
        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <h2 className="text-[18px] font-black" style={{ color: PLUM }}>{translate("coordinator.bulkShift.title")}</h2>
            <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>{translate("coordinator.bulkShift.subtitle")}</p>
          </div>
          <button onClick={handleClose} className="rounded-lg p-1.5 hover:bg-gray-100" title={translate("coordinator.bulkShift.closeModal")} aria-label={translate("coordinator.bulkShift.closeModal")}>
            <X size={16} style={{ color: MUTED }} />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[65vh] overflow-y-auto px-6 py-5">
          {result ? (
            // ── Result summary ──────────────────────────────────────────────
            <div className="space-y-4">
              <div className="rounded-xl border p-4 text-center" style={{ borderColor: BORDER, background: SOFT }}>
                <div className="flex items-center justify-center gap-4">
                  <div>
                    <p className="text-[28px] font-black" style={{ color: PLUM }}>{result.created_count}</p>
                    <p className="text-[11px] font-bold" style={{ color: MUTED }}>{translate("coordinator.bulkShift.created")}</p>
                  </div>
                  {result.skipped_count > 0 && (
                    <div>
                      <p className="text-[28px] font-black" style={{ color: CORAL }}>{result.skipped_count}</p>
                      <p className="text-[11px] font-bold" style={{ color: MUTED }}>{translate("coordinator.bulkShift.skipped")}</p>
                    </div>
                  )}
                </div>
              </div>

              {result.conflicts_summary.filter((c) => c.conflicts.length > 0).length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] font-black text-amber-800 mb-2">{translate("coordinator.bulkShift.conflictsTitle")}</p>
                  {result.conflicts_summary
                    .filter((c) => c.conflicts.length > 0)
                    .slice(0, 5)
                    .map((c) => (
                      <div key={c.shift_id} className="mb-1">
                        <p className="text-[10px] font-bold text-amber-700">{c.date}</p>
                        {c.conflicts.map((cf, i) => (
                          <p key={i} className="text-[10px] text-amber-600">• {cf.message}</p>
                        ))}
                      </div>
                    ))}
                </div>
              )}

              {result.skipped.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-[11px] font-black text-red-800 mb-2">{translate("coordinator.bulkShift.skippedTitle")}</p>
                  {result.skipped.slice(0, 5).map((s, i) => (
                    <div key={i} className="mb-1">
                      <p className="text-[10px] font-bold text-red-700">{s.date}: {s.reason}</p>
                      {s.conflicts.map((c, j) => (
                        <p key={j} className="text-[10px] text-red-600">• {c.message}</p>
                      ))}
                    </div>
                  ))}
                  {result.skipped_count > 5 && (
                    <p className="text-[10px] text-red-600">{translateParams("coordinator.bulkShift.moreSkipped", { count: String(result.skipped_count - 5) })}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            // ── Form ────────────────────────────────────────────────────────
            <div className="space-y-5">
              {/* Participant */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.bulkShift.participant")}</label>
                <Select value={participantId} onValueChange={setParticipantId}>
                  <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                    <SelectValue placeholder={translate("coordinator.bulkShift.selectParticipant")} />
                  </SelectTrigger>
                  <SelectContent>
                    {participants.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Worker (optional) */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>
                  Auto-assign Worker <span className="font-normal">({translate("common.optional")})</span>
                </label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                    <SelectValue placeholder={translate("coordinator.bulkShift.selectWorker")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{translate("coordinator.bulkShift.noAutoAssign")}</SelectItem>
                    {workers.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

              {/* Start date & weeks */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.bulkShift.startingFrom")}</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    title={translate("coordinator.bulkShift.startingFrom")}
                    className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: BORDER }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>{translate("coordinator.bulkShift.repeatWeeks")}</label>
                  <input
                    type="number"
                    min={1}
                    max={26}
                    value={weeks}
                    onChange={(e) => setWeeks(Math.max(1, parseInt(e.target.value) || 1))}
                    title={translate("coordinator.bulkShift.repeatWeeks")}
                    placeholder={translate("coordinator.bulkShift.weeksPlaceholder")}
                    className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: BORDER }}
                  />
                </div>
              </div>

              {/* Summary preview */}
              {canSubmit && (
                <div className="rounded-xl border p-3.5" style={{ borderColor: BORDER, background: SOFT }}>
                  <p className="text-[11px] font-black uppercase tracking-widest mb-2" style={{ color: MUTED }}>{translate("coordinator.bulkShift.summary")}</p>
                  <div className="space-y-1 text-[12px]">
                    {[
                      [translate("common.participant"), participant?.full_name || "N/A"],
                      ...(worker ? [[translate("common.worker"), worker.full_name]] as [string, string][] : []),
                      [translate("coordinator.bulkShift.schedule"), `${selectedDays.map((d) => DAYS_OF_WEEK[d]?.label).join(", ")} · ${startTime}–${endTime}`],
                      [translate("coordinator.bulkShift.duration"), translateParams("coordinator.bulkShift.durationValue", { weeks: String(weeks), date: format(new Date(startDate + "T00:00:00"), "d MMM yyyy") })],
                      [translate("coordinator.bulkShift.totalShifts"), translateParams("coordinator.bulkShift.totalShiftsValue", { total: String(totalShifts), perWeek: String(selectedDays.length), weeks: String(weeks) })],
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
              {result.skipped_count > 0 && !confirmed && (
                <button
                  onClick={() => {
                    setConfirmed(true);
                    mutation.mutate(true);
                    setResult(null);
                  }}
                  className="rounded-full px-4 py-2 text-[12px] font-bold text-white"
                  style={{ background: CORAL }}
                >
                  Retry Skipped (Override Conflicts)
                </button>
              )}
              <button
                onClick={handleClose}
                className="rounded-full px-4 py-2 text-[12px] font-bold text-white"
                style={{ background: PLUM }}
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
                onClick={() => mutation.mutate(false)}
                disabled={!canSubmit || mutation.isPending}
                className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold text-white"
                style={{
                  background: canSubmit && !mutation.isPending ? PLUM : MUTED,
                }}
              >
                {mutation.isPending ? (
                  <><Loader2 size={12} className="animate-spin" /> {translate("coordinator.bulkShift.creating")}</>
                ) : (
                  <><Plus size={12} /> {totalShifts === 1 ? translateParams("coordinator.bulkShift.createShifts", { count: String(totalShifts) }) : translateParams("coordinator.bulkShift.createShiftsPlural", { count: String(totalShifts) })}</>
                )}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

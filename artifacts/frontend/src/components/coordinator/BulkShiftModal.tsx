/**
 * BulkShiftModal — CARECLIQV2-235
 * Create recurring shifts (every Mon/Wed/Fri for N weeks).
 */
import { useState } from "react";
import { format, addDays } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";

const SHIFT_TYPE_LABELS: Record<string, string> = {
  standard_support: "Standard Support",
  community_access: "Community Access",
  allied_health:    "Allied Health Session",
  respite_care:     "Respite Care",
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
      toast({ title: "Bulk create failed", description: err.message, variant: "destructive" });
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
            <h2 className="text-[18px] font-black" style={{ color: PLUM }}>Recurring Shifts</h2>
            <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>Create bulk recurring shifts for a participant.</p>
          </div>
          <button onClick={handleClose} className="rounded-lg p-1.5 hover:bg-gray-100">
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
                    <p className="text-[11px] font-bold" style={{ color: MUTED }}>Created</p>
                  </div>
                  {result.skipped_count > 0 && (
                    <div>
                      <p className="text-[28px] font-black" style={{ color: CORAL }}>{result.skipped_count}</p>
                      <p className="text-[11px] font-bold" style={{ color: MUTED }}>Skipped</p>
                    </div>
                  )}
                </div>
              </div>

              {result.conflicts_summary.filter((c) => c.conflicts.length > 0).length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] font-black text-amber-800 mb-2">Shifts created with conflicts:</p>
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
                  <p className="text-[11px] font-black text-red-800 mb-2">Skipped shifts:</p>
                  {result.skipped.slice(0, 5).map((s, i) => (
                    <div key={i} className="mb-1">
                      <p className="text-[10px] font-bold text-red-700">{s.date}: {s.reason}</p>
                      {s.conflicts.map((c, j) => (
                        <p key={j} className="text-[10px] text-red-600">• {c.message}</p>
                      ))}
                    </div>
                  ))}
                  {result.skipped_count > 5 && (
                    <p className="text-[10px] text-red-600">+{result.skipped_count - 5} more skipped</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            // ── Form ────────────────────────────────────────────────────────
            <div className="space-y-5">
              {/* Participant */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>Participant *</label>
                <Select value={participantId} onValueChange={setParticipantId}>
                  <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                    <SelectValue placeholder="Select participant…" />
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
                  Auto-assign Worker <span className="font-normal">(optional)</span>
                </label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                    <SelectValue placeholder="Select worker (optional)…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No auto-assign</SelectItem>
                    {workers.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Shift type */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>Shift Type</label>
                <Select value={shiftType} onValueChange={setShiftType}>
                  <SelectTrigger className="rounded-xl" style={{ borderColor: BORDER }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SHIFT_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Days of week */}
              <div className="space-y-2">
                <label className="text-[12px] font-black" style={{ color: TEXT }}>Repeat Days *</label>
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
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>Start Time *</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none focus:border-[#5533CC]"
                    style={{ borderColor: BORDER }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>End Time *</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none focus:border-[#5533CC]"
                    style={{ borderColor: BORDER }}
                  />
                </div>
              </div>

              {/* Start date & weeks */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>Starting From *</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: BORDER }}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[12px] font-black" style={{ color: TEXT }}>Repeat (weeks)</label>
                  <input
                    type="number"
                    min={1}
                    max={26}
                    value={weeks}
                    onChange={(e) => setWeeks(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full rounded-xl border px-3 py-2 text-[13px] outline-none"
                    style={{ borderColor: BORDER }}
                  />
                </div>
              </div>

              {/* Summary preview */}
              {canSubmit && (
                <div className="rounded-xl border p-3.5" style={{ borderColor: BORDER, background: SOFT }}>
                  <p className="text-[11px] font-black uppercase tracking-widest mb-2" style={{ color: MUTED }}>Summary</p>
                  <div className="space-y-1 text-[12px]">
                    {[
                      ["Participant", participant?.full_name || "—"],
                      ...(worker ? [["Worker", worker.full_name]] as [string, string][] : []),
                      ["Schedule", `${selectedDays.map((d) => DAYS_OF_WEEK[d]?.label).join(", ")} · ${startTime}–${endTime}`],
                      ["Duration", `${weeks} weeks from ${format(new Date(startDate + "T00:00:00"), "d MMM yyyy")}`],
                      ["Total shifts", `${totalShifts} shifts (${selectedDays.length}/week × ${weeks} weeks)`],
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
                <Check size={12} className="inline mr-1.5" />Done
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
                  background: canSubmit && !mutation.isPending ? `linear-gradient(135deg, ${PLUM}, ${CORAL})` : MUTED,
                }}
              >
                {mutation.isPending ? (
                  <><Loader2 size={12} className="animate-spin" /> Creating…</>
                ) : (
                  <><Plus size={12} /> Create {totalShifts} Shift{totalShifts !== 1 ? "s" : ""}</>
                )}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { getWorkerShifts, type WorkerShift } from "@/services/shiftService";
import {
  createPreferredShiftRequest,
  createShiftSwapRequest,
  createTimeOffRequest,
  formatPreferredDays,
  listScheduleRequests,
  timeOffReasonLabel,
  type ScheduleRequest,
  type ScheduleRequestStatus,
  type ScheduleRequestType,
} from "@/services/scheduleRequestService";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

const REASONS = [
  { value: "annual_leave", label: "Annual leave" },
  { value: "personal_leave", label: "Personal leave" },
  { value: "medical", label: "Medical" },
  { value: "family_emergency", label: "Family emergency" },
  { value: "other", label: "Other" },
];

type Tab = "time_off" | "preferred_shift" | "shift_swap" | "history";

export default function WorkerScheduleRequests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("time_off");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const [timeOff, setTimeOff] = useState({ start_date: "", end_date: "", reason_code: "annual_leave", worker_notes: "" });
  const [preferred, setPreferred] = useState({ participant_id: "", preferred_days: [] as number[], worker_notes: "" });
  const [swap, setSwap] = useState({ shift_id: "", worker_notes: "" });

  const { data: historyData, isLoading } = useOrgQuery(
    ["worker", "schedule-requests", filterType, filterStatus],
    {
      queryFn: () =>
        listScheduleRequests({
          request_type: filterType === "all" ? undefined : filterType,
          status: filterStatus === "all" ? undefined : filterStatus,
        }),
    },
  );

  const { data: shiftsData } = useOrgQuery(["worker", "shifts", "upcoming"], {
    queryFn: () => getWorkerShifts("upcoming"),
  });

  const participants = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of shiftsData?.shifts ?? []) {
      if (s.participant_id && s.participant_name) map.set(s.participant_id, s.participant_name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [shiftsData]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["worker", "schedule-requests"] });

  const timeOffMut = useMutation({
    mutationFn: () => createTimeOffRequest(timeOff),
    onSuccess: () => {
      toast({ title: "Time-off request submitted" });
      setTimeOff({ start_date: "", end_date: "", reason_code: "annual_leave", worker_notes: "" });
      invalidate();
      setTab("history");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const preferredMut = useMutation({
    mutationFn: () => createPreferredShiftRequest(preferred),
    onSuccess: () => {
      toast({ title: "Preferred shift request submitted" });
      setPreferred({ participant_id: "", preferred_days: [], worker_notes: "" });
      invalidate();
      setTab("history");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const swapMut = useMutation({
    mutationFn: () => createShiftSwapRequest(swap),
    onSuccess: () => {
      toast({ title: "Shift swap request submitted" });
      setSwap({ shift_id: "", worker_notes: "" });
      invalidate();
      setTab("history");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const requests = historyData?.requests ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-10">
      <header>
        <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: CORAL }}>Support Worker</p>
        <h1 className="mt-1 text-2xl font-black" style={{ color: TEXT }}>Schedule requests</h1>
        <Link href="/calendar" className="mt-2 inline-block text-xs font-black" style={{ color: PLUM }}>
          ← Back to calendar
        </Link>
      </header>

      <div className="flex flex-wrap gap-1 rounded-full bg-[#F0EDF8] p-1">
        {([
          ["time_off", "Time off"],
          ["preferred_shift", "Preferred"],
          ["shift_swap", "Swap"],
          ["history", "History"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-2 text-[11px] font-black ${tab === id ? "bg-white shadow-sm" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "time_off" && (
        <FormCard title="Request time off">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start date">
              <input type="date" className="w-full rounded-xl border px-3 py-2 text-sm" value={timeOff.start_date} onChange={(e) => setTimeOff((p) => ({ ...p, start_date: e.target.value }))} />
            </Field>
            <Field label="End date">
              <input type="date" className="w-full rounded-xl border px-3 py-2 text-sm" value={timeOff.end_date} onChange={(e) => setTimeOff((p) => ({ ...p, end_date: e.target.value }))} />
            </Field>
          </div>
          <Field label="Reason">
            <select className="w-full rounded-xl border px-3 py-2 text-sm" value={timeOff.reason_code} onChange={(e) => setTimeOff((p) => ({ ...p, reason_code: e.target.value }))}>
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Notes (optional)">
            <textarea className="w-full rounded-xl border px-3 py-2 text-sm" rows={3} value={timeOff.worker_notes} onChange={(e) => setTimeOff((p) => ({ ...p, worker_notes: e.target.value }))} />
          </Field>
          <SubmitButton loading={timeOffMut.isPending} onClick={() => timeOffMut.mutate()} />
        </FormCard>
      )}

      {tab === "preferred_shift" && (
        <FormCard title="Preferred shift">
          <p className="text-xs font-medium" style={{ color: MUTED }}>This is a preference only — not a booking. Your coordinator will review and assign.</p>
          <Field label="Participant">
            <select className="w-full rounded-xl border px-3 py-2 text-sm" value={preferred.participant_id} onChange={(e) => setPreferred((p) => ({ ...p, participant_id: e.target.value }))}>
              <option value="">Select participant</option>
              {participants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Preferred days">
            <DayPicker selected={preferred.preferred_days} onChange={(days) => setPreferred((p) => ({ ...p, preferred_days: days }))} />
          </Field>
          <Field label="Note">
            <textarea className="w-full rounded-xl border px-3 py-2 text-sm" rows={2} value={preferred.worker_notes} onChange={(e) => setPreferred((p) => ({ ...p, worker_notes: e.target.value }))} />
          </Field>
          <SubmitButton loading={preferredMut.isPending} onClick={() => preferredMut.mutate()} disabled={!preferred.participant_id || !preferred.preferred_days.length} />
        </FormCard>
      )}

      {tab === "shift_swap" && (
        <FormCard title="Offer a shift to swap">
          <Field label="Shift">
            <select className="w-full rounded-xl border px-3 py-2 text-sm" value={swap.shift_id} onChange={(e) => setSwap((p) => ({ ...p, shift_id: e.target.value }))}>
              <option value="">Select shift</option>
              {(shiftsData?.shifts ?? []).map((s: WorkerShift) => (
                <option key={s.id} value={s.id}>
                  {s.participant_name} — {s.scheduled_start ? format(parseISO(s.scheduled_start), "EEE d MMM h:mm a") : s.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason">
            <textarea className="w-full rounded-xl border px-3 py-2 text-sm" rows={2} placeholder="e.g. Doctor appointment" value={swap.worker_notes} onChange={(e) => setSwap((p) => ({ ...p, worker_notes: e.target.value }))} />
          </Field>
          <SubmitButton loading={swapMut.isPending} onClick={() => swapMut.mutate()} disabled={!swap.shift_id} />
        </FormCard>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select className="rounded-lg border px-2 py-1.5 text-xs font-bold" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All types</option>
              <option value="time_off">Time off</option>
              <option value="preferred_shift">Preferred</option>
              <option value="shift_swap">Swap</option>
            </select>
            <select className="rounded-lg border px-2 py-1.5 text-xs font-bold" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="declined">Declined</option>
            </select>
          </div>
          {isLoading && <p className="text-sm" style={{ color: MUTED }}>Loading…</p>}
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
          {!isLoading && !requests.length && (
            <p className="rounded-2xl border bg-white p-6 text-center text-sm" style={{ borderColor: BORDER, color: MUTED }}>
              No requests yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RequestCard({ request }: { request: ScheduleRequest }) {
  const statusColors: Record<ScheduleRequestStatus, string> = {
    pending: "#F59E0B",
    approved: "#10B981",
    declined: "#EF4444",
  };
  let summary = request.request_type.replace("_", " ");
  if (request.time_off) {
    summary = `${timeOffReasonLabel(request.time_off.reason_code)}: ${request.time_off.start_date} – ${request.time_off.end_date}`;
  } else if (request.preferred_shift) {
    const name = request.preferred_shift.patients?.full_name ?? "Participant";
    summary = `${name} on ${formatPreferredDays(request.preferred_shift.preferred_days)}`;
  } else if (request.shift_swap?.shift) {
    summary = `Swap: ${request.shift_swap.shift.participant_name ?? "Shift"}`;
  }

  return (
    <div className="rounded-2xl border bg-white p-4" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black capitalize" style={{ color: TEXT }}>{request.request_type.replace(/_/g, " ")}</p>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>{summary}</p>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase text-white" style={{ background: statusColors[request.status] }}>
          {request.status}
        </span>
      </div>
      {request.coordinator_notes && (
        <p className="mt-2 text-xs rounded-lg bg-slate-50 p-2" style={{ color: TEXT }}>
          Coordinator: {request.coordinator_notes}
        </p>
      )}
      <p className="mt-2 text-[10px] font-bold" style={{ color: MUTED }}>
        Submitted {format(parseISO(request.created_at), "d MMM yyyy")}
        {request.resolved_at && ` · Resolved ${format(parseISO(request.resolved_at), "d MMM yyyy")}`}
      </p>
    </div>
  );
}

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-4 space-y-3" style={{ borderColor: BORDER }}>
      <h2 className="text-sm font-black" style={{ color: TEXT }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{label}</span>
      {children}
    </label>
  );
}

function DayPicker({ selected, onChange }: { selected: number[]; onChange: (days: number[]) => void }) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div className="flex flex-wrap gap-2">
      {labels.map((label, i) => {
        const day = i + 1;
        const active = selected.includes(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => onChange(active ? selected.filter((d) => d !== day) : [...selected, day])}
            className={`rounded-full px-3 py-1.5 text-xs font-black border ${active ? "text-white" : ""}`}
            style={{ background: active ? PLUM : "white", borderColor: BORDER, color: active ? "white" : MUTED }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SubmitButton({ loading, onClick, disabled }: { loading: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={loading || disabled}
      onClick={onClick}
      className="w-full rounded-full py-3 text-xs font-black text-white disabled:opacity-50"
      style={{ background: PLUM }}
    >
      {loading ? "Submitting…" : "Submit request"}
    </button>
  );
}

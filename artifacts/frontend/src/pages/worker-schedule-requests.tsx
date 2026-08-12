import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { getWorkerShifts, type WorkerShift } from "@/services/shiftService";
import {
  createPreferredShiftRequest,
  createShiftSwapRequest,
  createTimeOffRequest,
  listScheduleRequests,
  type ScheduleRequest,
  type ScheduleRequestStatus,
  type ScheduleRequestType,
} from "@/services/scheduleRequestService";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

const REASON_KEYS = [
  { value: "annual_leave", key: "scheduleRequests.reason.annualLeave" },
  { value: "personal_leave", key: "scheduleRequests.reason.personalLeave" },
  { value: "medical", key: "scheduleRequests.reason.medical" },
  { value: "family_emergency", key: "scheduleRequests.reason.familyEmergency" },
  { value: "other", key: "scheduleRequests.reason.other" },
] as const;

const DAY_KEYS = [
  "scheduleRequests.days.mon",
  "scheduleRequests.days.tue",
  "scheduleRequests.days.wed",
  "scheduleRequests.days.thu",
  "scheduleRequests.days.fri",
  "scheduleRequests.days.sat",
  "scheduleRequests.days.sun",
] as const;

const TYPE_KEYS: Record<ScheduleRequestType, string> = {
  time_off: "scheduleRequests.type.timeOff",
  preferred_shift: "scheduleRequests.type.preferredShift",
  shift_swap: "scheduleRequests.type.shiftSwap",
};

const STATUS_KEYS: Record<ScheduleRequestStatus, string> = {
  pending: "scheduleRequests.status.pending",
  approved: "scheduleRequests.status.approved",
  declined: "scheduleRequests.status.declined",
};

type Tab = "time_off" | "preferred_shift" | "shift_swap" | "history";

function useReasonLabel() {
  const { translate } = useAccessibility();
  return (code?: string) => {
    const match = REASON_KEYS.find((r) => r.value === code);
    return match ? translate(match.key) : code ?? translate("scheduleRequests.tab.timeOff");
  };
}

function useFormatPreferredDays() {
  const { translate } = useAccessibility();
  return (days: number[]) =>
    days.map((d) => translate(DAY_KEYS[d - 1] ?? "scheduleRequests.days.mon")).join(", ");
}

function RequestCard({ request }: { request: ScheduleRequest }) {
  const { translate, translateParams } = useAccessibility();
  const reasonLabel = useReasonLabel();
  const formatPreferredDays = useFormatPreferredDays();

  const statusColors: Record<ScheduleRequestStatus, string> = {
    pending: "#F59E0B",
    approved: "#10B981",
    declined: "#EF4444",
  };
  let summary = translate(TYPE_KEYS[request.request_type]);
  if (request.time_off) {
    summary = `${reasonLabel(request.time_off.reason_code)}: ${request.time_off.start_date} – ${request.time_off.end_date}`;
  } else if (request.preferred_shift) {
    const name = request.preferred_shift.patients?.full_name ?? translate("scheduleRequests.participant");
    summary = translateParams("scheduleRequests.preferredSummary", {
      name,
      days: formatPreferredDays(request.preferred_shift.preferred_days),
    });
  } else if (request.shift_swap?.shift) {
    summary = translateParams("scheduleRequests.swapLabel", {
      name: request.shift_swap.shift.participant_name ?? translate("scheduleRequests.shift"),
    });
  }

  return (
    <div className="rounded-2xl border bg-card p-4" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black capitalize" style={{ color: TEXT }}>{translate(TYPE_KEYS[request.request_type])}</p>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>{summary}</p>
        </div>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase text-white" style={{ background: statusColors[request.status] }}>
          {translate(STATUS_KEYS[request.status])}
        </span>
      </div>
      {request.coordinator_notes && (
        <p className="mt-2 text-xs rounded-lg bg-cc-soft p-2" style={{ color: TEXT }}>
          {translate("scheduleRequests.coordinatorNotes")} {request.coordinator_notes}
        </p>
      )}
      <p className="mt-2 text-[10px] font-bold" style={{ color: MUTED }}>
        {translate("scheduleRequests.submitted")} {format(parseISO(request.created_at), "d MMM yyyy")}
        {request.resolved_at && ` · ${translate("scheduleRequests.resolved")} ${format(parseISO(request.resolved_at), "d MMM yyyy")}`}
      </p>
    </div>
  );
}

function DayPicker({ selected, onChange }: { selected: number[]; onChange: (days: number[]) => void }) {
  const { translate } = useAccessibility();
  return (
    <div className="flex flex-wrap gap-2">
      {DAY_KEYS.map((key, i) => {
        const day = i + 1;
        const active = selected.includes(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => onChange(active ? selected.filter((d) => d !== day) : [...selected, day])}
            className={`rounded-full px-3 py-1.5 text-xs font-black border ${active ? "text-white" : ""}`}
            style={{ background: active ? PLUM : 'var(--cc-surface)', borderColor: BORDER, color: active ? "white" : MUTED }}
          >
            {translate(key)}
          </button>
        );
      })}
    </div>
  );
}

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-3" style={{ borderColor: BORDER }}>
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

function SubmitButton({
  loading,
  onClick,
  disabled,
  label,
  loadingLabel,
}: {
  loading: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  loadingLabel: string;
}) {
  return (
    <button
      type="button"
      disabled={loading || disabled}
      onClick={onClick}
      className="cc-btn-primary w-full cursor-pointer rounded-full py-3 text-xs font-black disabled:opacity-50"
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

export default function WorkerScheduleRequests() {
  const { translate } = useAccessibility();
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
      toast({ title: translate("scheduleRequests.toast.timeOffSubmitted") });
      setTimeOff({ start_date: "", end_date: "", reason_code: "annual_leave", worker_notes: "" });
      invalidate();
      setTab("history");
    },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const preferredMut = useMutation({
    mutationFn: () => createPreferredShiftRequest(preferred),
    onSuccess: () => {
      toast({ title: translate("scheduleRequests.toast.preferredSubmitted") });
      setPreferred({ participant_id: "", preferred_days: [], worker_notes: "" });
      invalidate();
      setTab("history");
    },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const swapMut = useMutation({
    mutationFn: () => createShiftSwapRequest(swap),
    onSuccess: () => {
      toast({ title: translate("scheduleRequests.toast.swapSubmitted") });
      setSwap({ shift_id: "", worker_notes: "" });
      invalidate();
      setTab("history");
    },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const requests = historyData?.requests ?? [];

  const tabs: { id: Tab; key: string }[] = [
    { id: "time_off", key: "scheduleRequests.tab.timeOff" },
    { id: "preferred_shift", key: "scheduleRequests.tab.preferred" },
    { id: "shift_swap", key: "scheduleRequests.tab.swap" },
    { id: "history", key: "scheduleRequests.tab.history" },
  ];

  return (
    <div className="w-full space-y-5 pb-10">
      <header>
        <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: CORAL }}>{translate("common.supportWorker")}</p>
        <h1 className="mt-1 text-2xl font-black" style={{ color: TEXT }}>{translate("scheduleRequests.title")}</h1>
        <Link href="/calendar" className="mt-2 inline-block text-xs font-black" style={{ color: PLUM }}>
          {translate("scheduleRequests.backToCalendar")}
        </Link>
      </header>

      <div className="flex flex-wrap gap-1 rounded-full bg-cc-bg p-1">
        {tabs.map(({ id, key }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-full px-3 py-2 text-[11px] font-black ${tab === id ? "bg-card shadow-sm" : ""}`}
          >
            {translate(key)}
          </button>
        ))}
      </div>

      {tab === "time_off" && (
        <FormCard title={translate("scheduleRequests.requestTimeOff")}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={translate("scheduleRequests.startDate")}>
              <input type="date" className="cc-field" value={timeOff.start_date} onChange={(e) => setTimeOff((p) => ({ ...p, start_date: e.target.value }))} />
            </Field>
            <Field label={translate("scheduleRequests.endDate")}>
              <input type="date" className="cc-field" value={timeOff.end_date} onChange={(e) => setTimeOff((p) => ({ ...p, end_date: e.target.value }))} />
            </Field>
          </div>
          <Field label={translate("scheduleRequests.reason")}>
            <select className="cc-field" value={timeOff.reason_code} onChange={(e) => setTimeOff((p) => ({ ...p, reason_code: e.target.value }))}>
              {REASON_KEYS.map((r) => <option key={r.value} value={r.value}>{translate(r.key)}</option>)}
            </select>
          </Field>
          <Field label={translate("scheduleRequests.notesOptional")}>
            <textarea className="cc-field" rows={3} value={timeOff.worker_notes} onChange={(e) => setTimeOff((p) => ({ ...p, worker_notes: e.target.value }))} />
          </Field>
          <SubmitButton
            loading={timeOffMut.isPending}
            onClick={() => timeOffMut.mutate()}
            label={translate("scheduleRequests.submit")}
            loadingLabel={translate("scheduleRequests.submitting")}
          />
        </FormCard>
      )}

      {tab === "preferred_shift" && (
        <FormCard title={translate("scheduleRequests.preferredShift")}>
          <p className="text-xs font-medium" style={{ color: MUTED }}>{translate("scheduleRequests.preferredHint")}</p>
          <Field label={translate("scheduleRequests.participant")}>
            <select className="cc-field" value={preferred.participant_id} onChange={(e) => setPreferred((p) => ({ ...p, participant_id: e.target.value }))}>
              <option value="">{translate("scheduleRequests.selectParticipant")}</option>
              {participants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label={translate("scheduleRequests.preferredDays")}>
            <DayPicker selected={preferred.preferred_days} onChange={(days) => setPreferred((p) => ({ ...p, preferred_days: days }))} />
          </Field>
          <Field label={translate("scheduleRequests.note")}>
            <textarea className="cc-field" rows={2} value={preferred.worker_notes} onChange={(e) => setPreferred((p) => ({ ...p, worker_notes: e.target.value }))} />
          </Field>
          <SubmitButton
            loading={preferredMut.isPending}
            onClick={() => preferredMut.mutate()}
            disabled={!preferred.participant_id || !preferred.preferred_days.length}
            label={translate("scheduleRequests.submit")}
            loadingLabel={translate("scheduleRequests.submitting")}
          />
        </FormCard>
      )}

      {tab === "shift_swap" && (
        <FormCard title={translate("scheduleRequests.offerSwap")}>
          <Field label={translate("scheduleRequests.shift")}>
            <select className="cc-field" value={swap.shift_id} onChange={(e) => setSwap((p) => ({ ...p, shift_id: e.target.value }))}>
              <option value="">{translate("scheduleRequests.selectShift")}</option>
              {(shiftsData?.shifts ?? []).map((s: WorkerShift) => (
                <option key={s.id} value={s.id}>
                  {s.participant_name} · {s.scheduled_start ? format(parseISO(s.scheduled_start), "EEE d MMM h:mm a") : s.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label={translate("scheduleRequests.reason")}>
            <textarea className="cc-field" rows={2} placeholder={translate("scheduleRequests.reasonPlaceholder")} value={swap.worker_notes} onChange={(e) => setSwap((p) => ({ ...p, worker_notes: e.target.value }))} />
          </Field>
          <SubmitButton
            loading={swapMut.isPending}
            onClick={() => swapMut.mutate()}
            disabled={!swap.shift_id}
            label={translate("scheduleRequests.submit")}
            loadingLabel={translate("scheduleRequests.submitting")}
          />
        </FormCard>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <select className="cc-field text-xs font-bold rounded-lg py-1.5 px-2" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">{translate("scheduleRequests.filter.allTypes")}</option>
              <option value="time_off">{translate("scheduleRequests.filter.timeOff")}</option>
              <option value="preferred_shift">{translate("scheduleRequests.filter.preferred")}</option>
              <option value="shift_swap">{translate("scheduleRequests.filter.swap")}</option>
            </select>
            <select className="cc-field text-xs font-bold rounded-lg py-1.5 px-2" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">{translate("scheduleRequests.filter.allStatuses")}</option>
              <option value="pending">{translate("scheduleRequests.status.pending")}</option>
              <option value="approved">{translate("scheduleRequests.status.approved")}</option>
              <option value="declined">{translate("scheduleRequests.status.declined")}</option>
            </select>
          </div>
          {isLoading && <p className="text-sm" style={{ color: MUTED }}>{translate("common.loading")}</p>}
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
          {!isLoading && !requests.length && (
            <p className="rounded-2xl border bg-card p-6 text-center text-sm" style={{ borderColor: BORDER, color: MUTED }}>
              {translate("scheduleRequests.empty")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

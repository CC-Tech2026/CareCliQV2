import {
  EmptyState,
  LoadError,
  PageHeader,
  PillTabs,
  SearchField,
  SkeletonBlocks,
  ghostClass,
  outlineClass,
} from "@/components/layout/PageKit";
import {
  ScheduleLiveCard,
  shiftStage,
} from "@/components/coordinator/ScheduleLiveCard";
import { useState, useEffect, useRef, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import {
  Clock,
  AlertTriangle,
  MessageSquare,
  Activity,
  CheckCircle2,
  ChevronDown,
  Send,
  Zap,
  Flag,
  RefreshCw,
  Search,
  Phone,
  Mail,
  LogIn,
  MapPin,
  Clock3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/layout/SidePanel";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  getLiveShifts,
  sendShiftMessage,
  flagShift,
  emergencyStopShift,
  updateShiftBriefing,
  type LiveShift,
  type ShiftMessage,
} from "@/services/coordinatorService";
import { getShiftMessages } from "@/services/coordinatorService";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useLiveShiftsRealtime } from "@/hooks/useCoordinatorLiveRealtime";
import {
  getAppTimezone,
  formatAppTime,
  formatAppTimeWithZone,
} from "@/lib/datetime";

const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

function formatBreakElapsed(secs?: number) {
  if (!secs || secs <= 0) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const STATUS_RING: Record<
  LiveShift["live_status"],
  { ring: string; bg: string; labelKey: string }
> = {
  green: {
    ring: "var(--cc-green)",
    bg: "#F0FDF4",
    labelKey: "coordinator.live.status.onTrack",
  },
  yellow: {
    ring: "var(--cc-amber)",
    bg: "#FFFBEB",
    labelKey: "coordinator.live.status.attention",
  },
  red: {
    ring: "var(--cc-danger-text)",
    bg: "#FEF2F2",
    labelKey: "coordinator.live.status.alert",
  },
};

function liveStatusLabel(
  status: LiveShift["live_status"],
  translate: (key: string) => string,
) {
  const s = STATUS_RING[status];
  return { ...s, label: translate(s.labelKey) };
}

const WORKFLOW_COLUMNS: Array<{
  id: LiveShift["workflow_stage"];
  labelKey: string;
}> = [
  { id: "not_clocked_in", labelKey: "coordinator.live.board.notClockedIn" },
  { id: "clocked_in", labelKey: "coordinator.live.board.clockedIn" },
  { id: "documenting", labelKey: "coordinator.live.board.documenting" },
  { id: "wrapping_up", labelKey: "coordinator.live.board.wrappingUp" },
];

const MED_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  given_on_time: {
    bg: "var(--cc-status-success-bg)",
    color: "var(--cc-status-success)",
  },
  given_late: {
    bg: "var(--cc-status-warning-bg)",
    color: "var(--cc-status-warning)",
  },
  given_early: {
    bg: "var(--cc-status-warning-bg)",
    color: "var(--cc-status-warning)",
  },
  refused: { bg: "var(--cc-status-danger-bg)", color: "#DC2626" },
  missed: { bg: "var(--cc-status-danger-bg)", color: "#DC2626" },
  withheld: {
    bg: "var(--cc-status-warning-bg)",
    color: "var(--cc-status-warning)",
  },
  administration_error: { bg: "var(--cc-status-danger-bg)", color: "#DC2626" },
  overdue: { bg: "var(--cc-status-danger-bg)", color: "#DC2626" },
  due_now: {
    bg: "var(--cc-status-warning-bg)",
    color: "var(--cc-status-warning)",
  },
  upcoming: { bg: SOFT, color: MUTED },
};

/** A native dropdown shaped like the pill filters on Roster and Participants. */
function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 appearance-none rounded-full border border-cc-border bg-cc-surface pl-4 pr-10 text-sm text-cc-text outline-none transition hover:bg-cc-soft focus-visible:ring-2 focus-visible:ring-cc-plum"
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-cc-muted"
      />
    </div>
  );
}

// ── Elapsed clock ─────────────────────────────────────────────────────────────
function useElapsedTimer(startMinutes: number) {
  const [elapsed, setElapsed] = useState(startMinutes);
  useEffect(() => {
    const id = setInterval(() => setElapsed((m) => m + 1 / 60), 1000);
    return () => clearInterval(id);
  }, []);
  return elapsed;
}

function ElapsedBadge({ startMinutes }: { startMinutes: number }) {
  const elapsed = useElapsedTimer(startMinutes);
  const hrs = Math.floor(elapsed / 60);
  const mins = Math.floor(elapsed % 60);
  const label = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  return (
    <span
      className="text-[11px] font-semibold tabular-nums"
      style={{ color: MUTED }}
    >
      <Clock size={11} className="inline mr-1" />
      {label}
    </span>
  );
}

// ── Message thread modal ───────────────────────────────────────────────────────
function MessageModal({
  shift,
  open,
  onClose,
}: {
  tools?: import("react").ReactNode;
  shift: LiveShift;
  open: boolean;
  onClose: () => void;
}) {
  const { translate, translateParams } = useAccessibility();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [type, setType] = useState<ShiftMessage["message_type"]>("text");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useOrgQuery<ShiftMessage[]>(
    ["shift-messages", shift.id, orgId],
    {
      queryFn: () => getShiftMessages(shift.id),
      enabled: open,
      refetchInterval: 15_000,
    },
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMut = useMutation({
    mutationFn: () =>
      sendShiftMessage(shift.id, shift.worker_id ?? "", text.trim(), type),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({
        queryKey: [orgId, "shift-messages", shift.id, orgId],
      });
    },
    onError: () =>
      toast({
        variant: "destructive",
        title: translate("coordinator.live.messageFailed"),
      }),
  });

  const MSG_TYPES: Array<{
    v: ShiftMessage["message_type"];
    labelKey: string;
  }> = [
    { v: "text", labelKey: "coordinator.live.msgType.text" },
    { v: "request_photo", labelKey: "coordinator.live.msgType.requestPhoto" },
    {
      v: "task_suggestion",
      labelKey: "coordinator.live.msgType.taskSuggestion",
    },
    { v: "flag_issue", labelKey: "coordinator.live.msgType.flagIssue" },
    { v: "emergency", labelKey: "coordinator.live.msgType.emergency" },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold" style={{ color: TEXT }}>
            {translateParams("coordinator.live.messageTitle", {
              worker: shift.worker_name ?? "",
            })}
          </DialogTitle>
          <p className="text-[12px]" style={{ color: MUTED }}>
            {translateParams("coordinator.live.messageRe", {
              participant:
                shift.participant_name ??
                translate("common.participant").toLowerCase(),
            })}
          </p>
        </DialogHeader>

        {/* Type selector */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {MSG_TYPES.map((t) => (
            <button
              key={t.v}
              onClick={() => setType(t.v)}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors"
              style={{
                background: type === t.v ? "var(--cc-cta)" : SOFT,
                color: type === t.v ? "#fff" : MUTED,
              }}
            >
              {translate(t.labelKey)}
            </button>
          ))}
        </div>

        {/* Thread */}
        <div
          className="rounded-xl overflow-y-auto flex flex-col gap-2 p-3 mb-3"
          style={{
            maxHeight: 240,
            background: SOFT,
            border: `1px solid ${BORDER}`,
          }}
        >
          {isLoading && (
            <p className="text-[12px] text-center" style={{ color: MUTED }}>
              {translate("common.loading")}
            </p>
          )}
          {!isLoading && messages.length === 0 && (
            <p className="text-[12px] text-center" style={{ color: MUTED }}>
              {translate("coordinator.live.noMessages")}
            </p>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div
                key={m.id}
                className={`flex ${mine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[80%] px-3 py-2 rounded-2xl text-[13px]"
                  style={{
                    background: mine ? "var(--cc-cta)" : "var(--cc-bg)",
                    color: mine ? "#fff" : TEXT,
                    border: mine ? "none" : `1px solid ${BORDER}`,
                  }}
                >
                  {m.message}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={translate("coordinator.live.messagePlaceholder")}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              !e.shiftKey &&
              text.trim() &&
              sendMut.mutate()
            }
            className="flex-1 rounded-xl"
          />
          <Button
            size="sm"
            variant="navy"
            className="rounded-xl"
            disabled={!text.trim() || sendMut.isPending}
            onClick={() => sendMut.mutate()}
          >
            <Send size={14} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Per-shift briefing instructions ───────────────────────────────────────────
function ShiftSpecialInstructionsEditor({
  shiftId,
  initialValue,
  readOnly = false,
}: {
  shiftId: string;
  initialValue?: string | null;
  readOnly?: boolean;
}) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const [value, setValue] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(initialValue ?? "");
  }, [initialValue, shiftId]);

  const save = async () => {
    setSaving(true);
    try {
      await updateShiftBriefing(shiftId, value.trim() || null);
      toast({ title: translate("coordinator.live.specialInstructionsSaved") });
    } catch (err) {
      toast({
        title: translate("coordinator.live.saveFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (readOnly) {
    if (!initialValue) return null;
    return (
      <div>
        <PanelHeading>{translate("coordinator.live.specialInstructions")}</PanelHeading>
        <p className="rounded-xl bg-cc-soft p-3 text-sm" style={{ color: TEXT }}>
          {initialValue}
        </p>
      </div>
    );
  }

  return (
    <div>
      <PanelHeading>{translate("coordinator.live.specialInstructions")}</PanelHeading>
      <textarea
        className="min-h-[80px] w-full rounded-xl border bg-cc-surface p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-cc-plum"
        style={{ borderColor: BORDER, color: TEXT }}
        placeholder={translate(
          "coordinator.live.specialInstructionsPlaceholder",
        )}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        type="button"
        className={`${outlineClass} mt-2`}
        disabled={saving}
        onClick={() => void save()}
      >
        {saving
          ? translate("common.saving")
          : translate("coordinator.live.saveInstructions")}
      </button>
    </div>
  );
}

// ── Checklist section (grouped by goal) ─────────────────────────────────────────
function ShiftChecklistSection({
  checklist,
}: {
  checklist: LiveShift["checklist"];
}) {
  const { translate } = useAccessibility();
  if (checklist.length === 0) {
    return (
      <p className="text-sm" style={{ color: MUTED }}>
        {translate("coordinator.live.checklist.empty")}
      </p>
    );
  }
  const groups = new Map<string, LiveShift["checklist"]>();
  for (const task of checklist) {
    const key =
      task.goal_title || translate("coordinator.live.checklist.otherTasks");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(task);
  }
  return (
    <div className="space-y-3">
      {Array.from(groups.entries()).map(([goalTitle, tasks]) => (
        <div key={goalTitle}>
          <p className="mb-1.5 text-xs font-medium" style={{ color: MUTED }}>
            {goalTitle}
          </p>
          <div className="space-y-1.5">
            {tasks.map((task) => {
              const color = !task.completed
                ? BORDER
                : task.documented
                  ? "var(--cc-green)"
                  : "var(--cc-amber)";
              return (
                <div
                  key={task.task_id}
                  className="flex items-start gap-2 rounded-lg px-2.5 py-1.5"
                  style={{ background: SOFT }}
                >
                  <CheckCircle2
                    size={14}
                    className="mt-0.5 shrink-0"
                    style={{ color }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm" style={{ color: TEXT }}>
                      {task.label}
                    </p>
                    {task.completed && (
                      <p className="text-xs font-medium" style={{ color }}>
                        {task.documented
                          ? translate("coordinator.live.checklist.documented")
                          : translate(
                              "coordinator.live.checklist.notDocumented",
                            )}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Medications section ──────────────────────────────────────────────────────────
function ShiftMedicationsSection({
  medications,
  tz,
}: {
  medications: LiveShift["medications"];
  tz?: string | null;
}) {
  const { translate } = useAccessibility();
  if (medications.length === 0) {
    return (
      <p className="text-sm" style={{ color: MUTED }}>
        {translate("coordinator.live.medications.empty")}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {medications.map((med) => {
        const statusKey = med.outcome ?? med.due_status;
        const style = MED_STATUS_STYLE[statusKey] ?? { bg: SOFT, color: MUTED };
        return (
          <div
            key={`${med.medication_id}-${med.scheduled_time}`}
            className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5"
            style={{ background: SOFT }}
          >
            <div className="min-w-0">
              <p className="truncate text-sm" style={{ color: TEXT }}>
                {med.name}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>
                {formatAppTimeWithZone(med.scheduled_time, tz)}
              </p>
            </div>
            <span
              className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ background: style.bg, color: style.color }}
            >
              {statusKey.charAt(0).toUpperCase() + statusKey.slice(1).replace(/_/g, " ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Shift detail panel (side sheet) ──────────────────────────────────────────────
/** A small heading inside the side panel, in sentence case like the Calendar's. */
function PanelHeading({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <h3 className="mb-2 text-sm font-semibold" style={{ color: tone ?? TEXT }}>
      {children}
    </h3>
  );
}

function ShiftDetailPanel({
  shift,
  open,
  onClose,
  onMessage,
  onFlag,
  onEmergency,
  readOnly = false,
}: {
  shift: LiveShift;
  open: boolean;
  onClose: () => void;
  onMessage: (s: LiveShift) => void;
  onFlag: (s: LiveShift) => void;
  onEmergency: (s: LiveShift) => void;
  readOnly?: boolean;
}) {
  const { translate } = useAccessibility();
  const s = liveStatusLabel(shift.live_status, translate);
  const engagement = shift.engagement?.is_long_shift ? shift.engagement : null;
  const rows: Array<{ icon: typeof Clock; label: string; value: React.ReactNode }> = [
    {
      icon: LogIn,
      label: translate("coordinator.live.clockedIn"),
      value: shift.clocked_in_at
        ? formatAppTimeWithZone(shift.clocked_in_at, shift.timezone)
        : "Not yet",
    },
    {
      icon: Activity,
      label: translate("coordinator.live.session"),
      value: shift.session_id
        ? translate("coordinator.live.sessionActiveStatus")
        : translate("coordinator.live.noSession"),
    },
    {
      icon: CheckCircle2,
      label: translate("coordinator.live.notes"),
      value:
        shift.note_recorded || shift.visit_notes
          ? translate("coordinator.live.notesRecorded")
          : translate("common.none"),
    },
  ];
  // Time on shift only means something once the worker has clocked in.
  if (shift.clocked_in_at && !shift.clocked_out_at) {
    rows.splice(1, 0, {
      icon: Clock,
      label: translate("coordinator.live.elapsed"),
      value: <ElapsedBadge startMinutes={shift.elapsed_minutes} />,
    });
  }
  if (shift.worker_phone || shift.worker_email) {
    rows.unshift({
      icon: shift.worker_phone ? Phone : Mail,
      label: "Contact",
      value: (
        <a
          href={shift.worker_phone ? `tel:${shift.worker_phone}` : `mailto:${shift.worker_email}`}
          className="font-medium text-cc-plum hover:underline"
        >
          {shift.worker_phone || shift.worker_email}
        </a>
      ),
    });
  }
  if (engagement) {
    rows.push({
      icon: Clock3,
      label: "Long shift check-ins",
      value: [
        `${engagement.checkins_completed ?? 0} of ${engagement.checkins_required ?? 0} done`,
        `gap ${Math.floor((engagement.current_gap_secs ?? 0) / 60)}m`,
        engagement.on_break
          ? `on break ${formatBreakElapsed(engagement.break_elapsed_secs)}`
          : engagement.break_logged
            ? "break logged"
            : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      eyebrow={
        <span style={{ color: s.ring }}>
          {s.label}
          {shift.emergency_flagged ? ` · ${translate("coordinator.live.emergency")}` : ""}
        </span>
      }
      title={shift.worker_name || translate("coordinator.shiftAssign.unassigned")}
      description={[
        shift.participant_name,
        shift.shift_type
          ? shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1).replace(/_/g, " ")
          : translate("coordinator.live.shiftFallback"),
      ]
        .filter(Boolean)
        .join(" · ")}
      footer={
        readOnly ? undefined : (
          <>
            <button type="button" className={outlineClass} onClick={() => onMessage(shift)}>
              <MessageSquare size={15} /> Message
            </button>
            <button type="button" className={outlineClass} onClick={() => onFlag(shift)}>
              <Flag size={15} /> Flag issue
            </button>
            <button
              type="button"
              onClick={() => onEmergency(shift)}
              className={`${ghostClass} ml-auto text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950`}
            >
              <Zap size={15} /> Emergency stop
            </button>
          </>
        )
      }
    >
      {shift.alerts.length > 0 && (
        <section className="space-y-2" aria-label={translate("coordinator.live.activeAlerts")}>
          {shift.alerts
            .filter((a, i, all) => all.findIndex((b) => b.message === a.message) === i)
            .map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-2 rounded-xl px-3 py-2.5"
              style={{ background: "var(--cc-status-danger-bg)" }}
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: "var(--cc-danger-text)" }} />
              <p className="text-sm" style={{ color: TEXT }}>{a.message}</p>
            </div>
          ))}
        </section>
      )}

      <dl className="space-y-3">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cc-soft" style={{ color: MUTED }}>
              <Icon size={16} />
            </span>
            <div className="min-w-0">
              <dt className="text-xs" style={{ color: MUTED }}>{label}</dt>
              <dd className="text-sm" style={{ color: TEXT }}>{value}</dd>
            </div>
          </div>
        ))}
      </dl>

      <section>
        <PanelHeading>
          {translate("coordinator.live.checklist")}
          {shift.task_counts.total > 0 && (
            <span className="ml-2 font-normal text-cc-muted">
              {Math.min(shift.task_counts.completed, shift.task_counts.total)} of {shift.task_counts.total} done
            </span>
          )}
        </PanelHeading>
        <ShiftChecklistSection checklist={shift.checklist} />
      </section>

      <section>
        <PanelHeading>{translate("coordinator.live.medications")}</PanelHeading>
        <ShiftMedicationsSection medications={shift.medications} tz={shift.timezone} />
      </section>

      {shift.coordinator_notes && (
        <section>
          <PanelHeading>{translate("coordinator.live.coordinatorNotes")}</PanelHeading>
          <p className="rounded-xl bg-cc-soft p-3 text-sm" style={{ color: TEXT }}>
            {shift.coordinator_notes}
          </p>
        </section>
      )}
      <ShiftSpecialInstructionsEditor
        shiftId={shift.id}
        initialValue={shift.special_instructions}
        readOnly={readOnly}
      />
    </SidePanel>
  );
}

// ── Flag modal ─────────────────────────────────────────────────────────────────
function FlagModal({
  shift,
  open,
  onClose,
}: {
  shift: LiveShift | null;
  open: boolean;
  onClose: () => void;
}) {
  const { translate } = useAccessibility();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<"warning" | "critical">("warning");

  const flagMut = useMutation({
    mutationFn: () => flagShift(shift!.id, note.trim(), severity),
    onSuccess: () => {
      toast({ title: translate("coordinator.live.toast.flagCreated") });
      qc.invalidateQueries({ queryKey: [orgId, "live-shifts", orgId] });
      onClose();
      setNote("");
    },
    onError: () =>
      toast({
        variant: "destructive",
        title: translate("coordinator.live.toast.flagFailed"),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold" style={{ color: TEXT }}>
            {translate("coordinator.live.flagShift")}
          </DialogTitle>
          <p className="text-[12px]" style={{ color: MUTED }}>
            {shift?.worker_name}
          </p>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(["warning", "critical"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className="flex-1 py-1.5 rounded-xl text-[12px] font-semibold capitalize transition-colors"
                style={{
                  background:
                    severity === s
                      ? s === "critical"
                        ? CORAL
                        : "#F59E0B"
                      : SOFT,
                  color: severity === s ? "#fff" : MUTED,
                }}
              >
                {translate(`coordinator.live.severity.${s}`)}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={translate("coordinator.live.describeIssue")}
            rows={3}
            className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
            style={{ border: `1px solid ${BORDER}`, color: TEXT }}
          />
          <Button
            className="w-full rounded-xl"
            style={{ background: "var(--cc-cta)", color: "#fff" }}
            disabled={!note.trim() || flagMut.isPending}
            onClick={() => flagMut.mutate()}
          >
            {translate("coordinator.live.flagSubmit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Emergency modal ────────────────────────────────────────────────────────────
function EmergencyModal({
  shift,
  open,
  onClose,
}: {
  shift: LiveShift | null;
  open: boolean;
  onClose: () => void;
}) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [note, setNote] = useState(() =>
    translate("coordinator.live.emergencyDefaultNote"),
  );

  const emergMut = useMutation({
    mutationFn: () => emergencyStopShift(shift!.id, note),
    onSuccess: () => {
      toast({ title: translate("coordinator.live.toast.emergencyIssued") });
      qc.invalidateQueries({ queryKey: [orgId, "live-shifts", orgId] });
      onClose();
    },
    onError: () =>
      toast({
        variant: "destructive",
        title: translate("coordinator.live.toast.emergencyFailed"),
      }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle
            className="text-base font-semibold"
            style={{ color: CORAL }}
          >
            {translate("coordinator.live.emergencyStop")}
          </DialogTitle>
          <p className="text-[12px]" style={{ color: MUTED }}>
            {translate("coordinator.live.emergencyDesc")}
          </p>
        </DialogHeader>
        <div className="space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            title={translate("coordinator.live.incidentNote")}
            placeholder={translate("coordinator.live.incidentPlaceholder")}
            rows={3}
            className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
            style={{ border: `1px solid #FECACA`, color: TEXT }}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 rounded-xl"
              style={{ borderColor: BORDER }}
              onClick={onClose}
            >
              {translate("common.cancel")}
            </Button>
            <Button
              className="flex-1 rounded-xl"
              style={{ background: CORAL, color: "#fff" }}
              disabled={emergMut.isPending}
              onClick={() => emergMut.mutate()}
            >
              {emergMut.isPending
                ? translate("coordinator.live.stopping")
                : translate("coordinator.live.confirmEmergencyStop")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CoordinatorLivePage({
  embedded = false,
  externalSearch,
  onSearchChange,
  readOnly = false,
}: { embedded?: boolean; externalSearch?: string; onSearchChange?: (value: string) => void; readOnly?: boolean } = {}) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const previousClockIns = useRef<{
    orgId: string;
    values: Map<string, string | null | undefined>;
  } | null>(null);
  const [recentClockIns, setRecentClockIns] = useState<string[]>([]);
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [filter, setFilter] = useState<
    "all" | "green" | "yellow" | "red" | "attention"
  >("all");
  const [stageFilter, setStageFilter] = useState<
    "all" | "active" | "late" | "scheduled" | "completed"
  >("all");
  const [search, setSearch] = useState("");
  const [durationFilter, setDurationFilter] = useState<
    "all" | "short" | "long"
  >("all");
  const [timeOfDayFilter, setTimeOfDayFilter] = useState<
    "all" | "morning" | "afternoon" | "evening" | "night"
  >("all");
  const [clockInFilter, setClockInFilter] = useState<
    "all" | "clocked_in" | "not_clocked_in"
  >("all");
  const [msgShift, setMsgShift] = useState<LiveShift | null>(null);
  const [flagShiftState, setFlagShiftState] = useState<LiveShift | null>(null);
  const [emergShift, setEmergShift] = useState<LiveShift | null>(null);
  const [detailShift, setDetailShift] = useState<LiveShift | null>(null);

  const {
    data: shifts = [],
    isLoading,
    isError,
    dataUpdatedAt,
    isFetching,
    refetch,
  } = useOrgQuery<LiveShift[]>(["live-shifts", orgId], {
    queryFn: getLiveShifts,
    refetchInterval: 30_000,
  });
  // Realtime push on top of the 30s poll - the poll stays as a fallback in
  // case the websocket silently drops, but most updates now land within a
  // second or two of a worker's phone syncing instead of waiting for the tick.
  useLiveShiftsRealtime(true);
  useEffect(() => {
    if (!dataUpdatedAt || isError) return;
    const previous = previousClockIns.current;
    if (previous?.orgId === orgId) {
      const changed = shifts.filter(
        (s) =>
          previous.values.has(s.id) &&
          !previous.values.get(s.id) &&
          !!s.clocked_in_at &&
          !s.clocked_out_at,
      );
      if (changed.length) {
        setRecentClockIns(changed.map((s) => s.id));
        changed.forEach((s) =>
          toast({
            variant: "live",
            icon: (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500 text-white">
                {s.clock_in_verified && s.clock_in_method === "gps" ? (
                  <MapPin size={18} aria-hidden />
                ) : (
                  <LogIn size={18} aria-hidden />
                )}
              </span>
            ),
            title: translateParams("schedule.clockInToast", {
              worker: s.worker_name || translate("common.worker"),
            }),
            description: [
              s.participant_name,
              s.clocked_in_at
                ? formatAppTime(s.clocked_in_at, s.timezone)
                : null,
              s.clock_in_verified && s.clock_in_method === "gps"
                ? translate("schedule.gpsVerified")
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
          }),
        );
      }
    }
    previousClockIns.current = {
      orgId,
      values: new Map(shifts.map((s) => [s.id, s.clocked_in_at])),
    };
  }, [dataUpdatedAt, orgId, isError]);
  useEffect(() => {
    if (!recentClockIns.length) return;
    const timer = setTimeout(() => setRecentClockIns([]), 10000);
    return () => clearTimeout(timer);
  }, [recentClockIns]);

  // Derive time-of-day from scheduled_start (6–12 morning, 12–17 afternoon, 17–22 evening, else night)
  const getTimeSlot = (
    iso?: string | null,
    timezone?: string | null,
  ): "morning" | "afternoon" | "evening" | "night" | null => {
    if (!iso) return null;
    try {
      const h = Number(
        new Intl.DateTimeFormat("en-AU", {
          hour: "numeric",
          hourCycle: "h23",
          timeZone: timezone || getAppTimezone(),
        }).format(new Date(iso)),
      );
      if (h >= 6 && h < 12) return "morning";
      if (h >= 12 && h < 17) return "afternoon";
      if (h >= 17 && h < 22) return "evening";
      return "night";
    } catch {
      return null;
    }
  };

  // Only show time-of-day chips that actually appear in the current data
  const availableTimeSlots = useMemo(() => {
    const slots = new Set(
      shifts
        .map((s) => getTimeSlot(s.scheduled_start, s.timezone))
        .filter(Boolean) as string[],
    );
    const order = ["morning", "afternoon", "evening", "night"];
    return order.filter((t) => slots.has(t)) as Array<
      "morning" | "afternoon" | "evening" | "night"
    >;
  }, [shifts]);

  // Long shift = scheduled duration >= 6 hours; falls back to backend flag if times unavailable
  const isLongShift = (s: LiveShift): boolean => {
    if (s.scheduled_start && s.scheduled_end) {
      const hrs =
        (new Date(s.scheduled_end).getTime() -
          new Date(s.scheduled_start).getTime()) /
        3_600_000;
      return hrs >= 6;
    }
    return !!s.engagement?.is_long_shift;
  };

  const filtered = (() => {
    let result = shifts.filter(
      (s) =>
        filter === "all" ||
        (filter === "attention"
          ? s.live_status === "red" ||
            s.live_status === "yellow" ||
            shiftStage(s) === "late"
          : s.live_status === filter),
    );
    if (stageFilter !== "all")
      result = result.filter((s) => shiftStage(s) === stageFilter);
    if (durationFilter === "short")
      result = result.filter((s) => !isLongShift(s));
    if (durationFilter === "long")
      result = result.filter((s) => isLongShift(s));
    if (timeOfDayFilter !== "all")
      result = result.filter(
        (s) => getTimeSlot(s.scheduled_start) === timeOfDayFilter,
      );
    if (clockInFilter === "clocked_in")
      result = result.filter(
        (s) =>
          !!s.clocked_in_at &&
          !s.clocked_out_at &&
          shiftStage(s) !== "completed",
      );
    if (clockInFilter === "not_clocked_in")
      result = result.filter(
        (s) => !s.clocked_in_at && shiftStage(s) !== "completed",
      );
    const activeSearch = externalSearch ?? search;
    if (activeSearch.trim()) {
      const q = activeSearch.toLowerCase();
      result = result.filter(
        (s) =>
          s.worker_name?.toLowerCase().includes(q) ||
          s.participant_name?.toLowerCase().includes(q),
      );
    }
    return result.slice().sort((a, b) => {
      const priority = (s: LiveShift) =>
        shiftStage(s) === "completed"
          ? 4
          : s.live_status === "red"
            ? 0
            : shiftStage(s) === "late"
              ? 1
              : s.live_status === "yellow"
                ? 2
                : 3;
      return (
        priority(a) - priority(b) ||
        (a.scheduled_start || "").localeCompare(b.scheduled_start || "")
      );
    });
  })();

  const lastUpdated = dataUpdatedAt
    ? formatAppTime(new Date(dataUpdatedAt).toISOString())
    : translate("common.emDash");
  const countsReady = !isLoading && !(isError && !dataUpdatedAt);

  return (
    <div className="min-w-0 space-y-4 pb-10">
      {!embedded ? (
        <PageHeader
          eyebrow="Operations & Care"
          title="Live monitor"
          actions={
            <>
              <span role="status" className="px-2 text-xs text-cc-muted">
                {isError
                  ? "Update failed"
                  : isFetching
                    ? "Updating..."
                    : "Updated " + lastUpdated}
              </span>
              <button
                type="button"
                disabled={isFetching}
                onClick={() => void refetch()}
                className={outlineClass}
              >
                <RefreshCw
                  size={14}
                  className={isFetching ? "animate-spin" : ""}
                />
                Refresh
              </button>
            </>
          }
        />
      ) : (
        <p role="status" className="text-xs text-cc-muted">
          {isError
            ? "Update failed"
            : isFetching
              ? "Updating..."
              : "Updated " + lastUpdated}
        </p>
      )}
      {/* Stage pills on the left, the attention toggle on the right: the
          same pill row the Participants and Competency pages use. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <PillTabs<typeof stageFilter>
            label="Live shift status"
            value={stageFilter}
            onChange={setStageFilter}
            options={(
              [
                { key: "all", label: "All shifts" },
                { key: "active", label: "On shift" },
                { key: "late", label: "Late clock-in" },
                { key: "scheduled", label: "Scheduled" },
                { key: "completed", label: "Completed" },
              ] as const
            ).map((option) => ({
              ...option,
              count: countsReady
                ? option.key === "all"
                  ? shifts.length
                  : shifts.filter((s) => shiftStage(s) === option.key).length
                : undefined,
            }))}
          />
        </div>
        <button
          type="button"
          aria-pressed={filter === "attention"}
          onClick={() =>
            setFilter(filter === "attention" ? "all" : "attention")
          }
          className={
            "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition " +
            (filter === "attention"
              ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              : "text-cc-text hover:bg-cc-soft")
          }
          style={{
            boxShadow: `inset 0 0 0 1px ${filter === "attention" ? "var(--cc-amber)" : BORDER}`,
          }}
        >
          <AlertTriangle size={15} style={{ color: "var(--cc-amber)" }} />
          Needs attention
          <span className="tabular-nums text-cc-muted">
            {countsReady
              ? shifts.filter(
                  (s) =>
                    s.live_status === "red" ||
                    s.live_status === "yellow" ||
                    shiftStage(s) === "late",
                ).length
              : "-"}
          </span>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {externalSearch === undefined ? (
          <SearchField
            label="Search live shifts"
            value={search}
            onChange={setSearch}
            placeholder="Search worker or participant"
            className="sm:w-72"
          />
        ) : null}
        <FilterSelect
          label="Clock-in status"
          value={clockInFilter}
          onChange={(value) => setClockInFilter(value as typeof clockInFilter)}
        >
          <option value="all">Any clock-in status</option>
          <option value="clocked_in">Clocked in</option>
          <option value="not_clocked_in">Not clocked in</option>
        </FilterSelect>
        <FilterSelect
          label="Shift duration"
          value={durationFilter}
          onChange={(value) => setDurationFilter(value as typeof durationFilter)}
        >
          <option value="all">Any duration</option>
          <option value="short">Regular shifts</option>
          <option value="long">Long shifts (6h+)</option>
        </FilterSelect>
        {availableTimeSlots.length > 0 ? (
          <FilterSelect
            label="Time of day"
            value={timeOfDayFilter}
            onChange={(value) =>
              setTimeOfDayFilter(value as typeof timeOfDayFilter)
            }
          >
            <option value="all">Any time of day</option>
            {availableTimeSlots.map((time) => (
              <option key={time} value={time}>
                {time.charAt(0).toUpperCase() + time.slice(1)}
              </option>
            ))}
          </FilterSelect>
        ) : null}
        <button
          type="button"
          className={ghostClass}
          onClick={() => {
            setStageFilter("all");
            setFilter("all");
            setDurationFilter("all");
            setClockInFilter("all");
            setTimeOfDayFilter("all");
            setSearch("");
            onSearchChange?.("");
          }}
        >
          Clear filters
        </button>
        <span className="ml-auto text-sm text-cc-muted" role="status">
          {!countsReady
            ? isError
              ? "Shifts unavailable"
              : "Loading shifts"
            : filtered.length + " of " + shifts.length + " shifts"}
        </span>
      </div>
      {isError ? (
        <LoadError onRetry={() => void refetch()}>
          {dataUpdatedAt
            ? "Could not refresh. Showing the last loaded shifts."
            : "Live shifts could not be loaded."}
        </LoadError>
      ) : null}

      {/* Grid */}
      {isLoading && <SkeletonBlocks count={3} height="h-48" />}

      {!isLoading && !isError && filtered.length === 0 && (
        <EmptyState
          icon={Activity}
          title={
            shifts.length
              ? "No shifts match these filters"
              : "No shifts to monitor"
          }
          body={translate("coordinator.live.emptyHint")}
        />
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
          {filtered.map((shift) => (
            <ScheduleLiveCard
              key={shift.id}
              shift={shift}
              highlighted={recentClockIns.includes(shift.id)}
              readOnly={readOnly}
              onOpen={() => setDetailShift(shift)}
            />
          ))}
        </div>
      )}
      {/* Modals */}
      {msgShift && (
        <MessageModal
          shift={msgShift}
          open={!!msgShift}
          onClose={() => setMsgShift(null)}
        />
      )}
      <FlagModal
        shift={flagShiftState}
        open={!!flagShiftState}
        onClose={() => setFlagShiftState(null)}
      />
      <EmergencyModal
        shift={emergShift}
        open={!!emergShift}
        onClose={() => setEmergShift(null)}
      />
      {detailShift && (
        <ShiftDetailPanel
          onMessage={setMsgShift}
          onFlag={setFlagShiftState}
          onEmergency={setEmergShift}
          shift={shifts.find((s) => s.id === detailShift.id) ?? detailShift}
          open={!!detailShift}
          onClose={() => setDetailShift(null)}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}

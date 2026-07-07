import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import {
  Radio, Clock, User, AlertTriangle, MessageSquare, Activity,
  XCircle, CheckCircle2, ChevronRight, X, Send, Zap, Flag,
  RefreshCw, Filter, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  getLiveShifts, sendShiftMessage, flagShift, emergencyStopShift, updateShiftBriefing,
  type LiveShift, type ShiftMessage,
} from "@/services/coordinatorService";
import { getShiftMessages } from "@/services/coordinatorService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

function formatBreakElapsed(secs?: number) {
  if (!secs || secs <= 0) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const STATUS_RING: Record<LiveShift["live_status"], { ring: string; bg: string; labelKey: string }> = {
  green:  { ring: "#22C55E", bg: "#F0FDF4", labelKey: "coordinator.live.status.onTrack"  },
  yellow: { ring: "#F59E0B", bg: "#FFFBEB", labelKey: "coordinator.live.status.attention" },
  red:    { ring: "#EF4444", bg: "#FEF2F2", labelKey: "coordinator.live.status.alert"     },
};

function liveStatusLabel(status: LiveShift["live_status"], translate: (key: string) => string) {
  const s = STATUS_RING[status];
  return { ...s, label: translate(s.labelKey) };
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
    <span className="text-[11px] font-semibold tabular-nums" style={{ color: MUTED }}>
      <Clock size={11} className="inline mr-1" />
      {label}
    </span>
  );
}

// ── Task progress bar ──────────────────────────────────────────────────────────
function TaskBar({ total, completed }: { total: number; completed: number }) {
  const { translate } = useAccessibility();
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const color = pct >= 80 ? "#22C55E" : pct >= 50 ? "#F59E0B" : "#E8E8EA";
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-medium" style={{ color: MUTED }}>{translate("coordinator.live.tasks")}</span>
        <span className="text-[10px] font-bold" style={{ color: TEXT }}>
          {completed}/{total}
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: BORDER }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ── Message thread modal ───────────────────────────────────────────────────────
function MessageModal({
  shift,
  open,
  onClose,
}: {
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

  const { data: messages = [], isLoading } = useOrgQuery<ShiftMessage[]>(["shift-messages", shift.id, orgId], { queryFn: () => getShiftMessages(shift.id), enabled: open, refetchInterval: 15_000 });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMut = useMutation({
    mutationFn: () =>
      sendShiftMessage(shift.id, shift.worker_id ?? "", text.trim(), type),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["shift-messages", shift.id, orgId] });
    },
    onError: () => toast({ variant: "destructive", title: translate("coordinator.live.messageFailed") }),
  });

  const MSG_TYPES: Array<{ v: ShiftMessage["message_type"]; labelKey: string }> = [
    { v: "text",            labelKey: "coordinator.live.msgType.text" },
    { v: "request_photo",   labelKey: "coordinator.live.msgType.requestPhoto" },
    { v: "task_suggestion", labelKey: "coordinator.live.msgType.taskSuggestion" },
    { v: "flag_issue",      labelKey: "coordinator.live.msgType.flagIssue" },
    { v: "emergency",       labelKey: "coordinator.live.msgType.emergency" },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="text-base font-black" style={{ color: TEXT }}>
            {translateParams("coordinator.live.messageTitle", { worker: shift.worker_name ?? "" })}
          </DialogTitle>
          <p className="text-[12px]" style={{ color: MUTED }}>
            {translateParams("coordinator.live.messageRe", { participant: shift.participant_name ?? translate("common.participant").toLowerCase() })}
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
          style={{ maxHeight: 240, background: SOFT, border: `1px solid ${BORDER}` }}
        >
          {isLoading && <p className="text-[12px] text-center" style={{ color: MUTED }}>{translate("common.loading")}</p>}
          {!isLoading && messages.length === 0 && (
            <p className="text-[12px] text-center" style={{ color: MUTED }}>{translate("coordinator.live.noMessages")}</p>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
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
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && text.trim() && sendMut.mutate()}
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
}: {
  shiftId: string;
  initialValue?: string | null;
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

  return (
    <div>
      <p className="text-[11px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>
        {translate("coordinator.live.specialInstructions")}
      </p>
      <textarea
        className="w-full rounded-xl border p-3 text-[13px] min-h-[80px]"
        style={{ borderColor: BORDER, color: TEXT }}
        placeholder={translate("coordinator.live.specialInstructionsPlaceholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="button" size="sm" className="mt-2" disabled={saving} onClick={() => void save()}>
        {saving ? translate("common.saving") : translate("coordinator.live.saveInstructions")}
      </Button>
    </div>
  );
}

// ── Shift detail modal ─────────────────────────────────────────────────────────
function ShiftDetailModal({
  shift,
  open,
  onClose,
}: {
  shift: LiveShift;
  open: boolean;
  onClose: () => void;
}) {
  const { translate } = useAccessibility();
  const s = liveStatusLabel(shift.live_status, translate);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="font-black text-base" style={{ color: TEXT }}>
            {translate("coordinator.live.shiftDetail")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div
            className="rounded-2xl p-4 flex items-center gap-4"
            style={{ background: s.bg, border: `2px solid ${s.ring}` }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-[16px] font-black"
              style={{ background: s.ring, color: "#fff" }}
            >
              {(shift.worker_name ?? "W")[0]}
            </div>
            <div>
              <p className="font-black text-[15px]" style={{ color: TEXT }}>{shift.worker_name}</p>
              <p className="text-[12px]" style={{ color: MUTED }}>
                {shift.shift_type ?? translate("coordinator.live.shiftFallback")} · {shift.participant_name}
              </p>
            </div>
            <span
              className="ml-auto px-2.5 py-1 rounded-full text-[11px] font-black uppercase"
              style={{ background: s.ring, color: "#fff" }}
            >
              {s.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>{translate("coordinator.live.clockedIn")}</p>
              <p style={{ color: TEXT }}>{shift.clocked_in_at ? new Date(shift.clocked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : translate("common.emDash")}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>{translate("coordinator.live.elapsed")}</p>
              <ElapsedBadge startMinutes={shift.elapsed_minutes} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>{translate("coordinator.live.session")}</p>
              <p style={{ color: TEXT }}>{shift.session_id ? translate("coordinator.live.sessionActiveStatus") : translate("common.none")}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>{translate("coordinator.live.notes")}</p>
              <p style={{ color: TEXT }}>{shift.visit_notes ? translate("coordinator.live.notesRecorded") : translate("common.none")}</p>
            </div>
          </div>

          {shift.alerts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: CORAL }}>{translate("coordinator.live.activeAlerts")}</p>
              {shift.alerts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-2 rounded-xl px-3 py-2"
                  style={{ background: "#FEF2F2", border: `1px solid #FECACA` }}
                >
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: CORAL }} />
                  <p className="text-[12px]" style={{ color: TEXT }}>{a.message}</p>
                </div>
              ))}
            </div>
          )}

          {shift.coordinator_notes && (
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>{translate("coordinator.live.coordinatorNotes")}</p>
              <p className="text-[13px] rounded-xl p-3" style={{ background: SOFT, color: TEXT }}>
                {shift.coordinator_notes}
              </p>
            </div>
          )}
          <ShiftSpecialInstructionsEditor shiftId={shift.id} initialValue={shift.special_instructions} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Live shift card ────────────────────────────────────────────────────────────
function LiveShiftCard({
  shift,
  onMessage,
  onFlag,
  onEmergency,
  onDetail,
}: {
  shift: LiveShift;
  onMessage: (s: LiveShift) => void;
  onFlag: (s: LiveShift) => void;
  onEmergency: (s: LiveShift) => void;
  onDetail: (s: LiveShift) => void;
}) {
  const { translate, translateParams } = useAccessibility();
  const s = liveStatusLabel(shift.live_status, translate);

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md cursor-pointer"
      style={{
        background: "var(--cc-bg)",
        border: `2px solid ${s.ring}`,
        boxShadow: `0 2px 12px ${s.ring}22`,
      }}
      onClick={() => onDetail(shift)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {/* Status ring avatar */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-black shrink-0"
            style={{ background: s.bg, color: s.ring, border: `2px solid ${s.ring}` }}
          >
            {(shift.worker_name ?? "W")[0]}
          </div>
          <div>
            <p className="font-black text-[14px] leading-tight" style={{ color: TEXT }}>
              {shift.worker_name}
            </p>
            <p className="text-[11px] font-medium" style={{ color: MUTED }}>
              {shift.participant_name ?? "N/A"}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase"
            style={{ background: s.ring, color: "#fff" }}
          >
            {s.label}
          </span>
          <ElapsedBadge startMinutes={shift.elapsed_minutes} />
        </div>
      </div>

      {/* Shift type + session indicator */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
          style={{ background: SOFT, color: PLUM }}
        >
          {shift.shift_type ?? translate("coordinator.live.defaultShiftType")}
        </span>
        {shift.session_id ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#22C55E" }}>
            <Activity size={11} /> {translate("coordinator.live.sessionActive")}
          </span>
        ) : (
          <span className="text-[11px] font-semibold" style={{ color: MUTED }}>
            {translate("coordinator.live.noSession")}
          </span>
        )}
        {shift.visit_notes && (
          <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#3B82F6" }}>
            <CheckCircle2 size={11} /> {translate("coordinator.live.notes")}
          </span>
        )}
        {shift.emergency_flagged && (
          <span className="flex items-center gap-1 text-[11px] font-black" style={{ color: CORAL }}>
            <AlertTriangle size={11} /> {translate("coordinator.live.emergency")}
          </span>
        )}
      </div>

      {/* Task bar */}
      <TaskBar total={shift.task_counts.total} completed={shift.task_counts.completed} />

      {shift.engagement?.is_long_shift && (
        <div className="rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: BORDER, background: SOFT }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold" style={{ color: TEXT }}>
              Engagement: {shift.engagement.engagement_status ?? "GREEN"}
            </span>
            {shift.engagement.engagement_score != null && (
              <span className="font-semibold" style={{ color: MUTED }}>
                Score {shift.engagement.engagement_score}
              </span>
            )}
          </div>
          <p className="mt-1" style={{ color: MUTED }}>
            Gap {Math.floor((shift.engagement.current_gap_secs ?? 0) / 60)}m · Check-ins{" "}
            {shift.engagement.checkins_completed ?? 0}/{shift.engagement.checkins_required ?? 0}
            {shift.engagement.break_logged ? " · Break logged" : ""}
            {shift.engagement.on_break ? ` · On break ${formatBreakElapsed(shift.engagement.break_elapsed_secs)}` : ""}
          </p>
        </div>
      )}

      {/* Alerts */}
      {shift.alerts.length > 0 && (
        <div
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5"
          style={{ background: "#FEF2F2" }}
        >
          <AlertTriangle size={12} style={{ color: CORAL }} />
          <p className="text-[11px] font-semibold truncate" style={{ color: CORAL }}>
            {shift.alerts[0].message}
            {shift.alerts.length > 1 && translateParams("coordinator.live.alertsMore", { count: String(shift.alerts.length - 1) })}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-[11px] rounded-xl gap-1"
          style={{ borderColor: BORDER, color: MUTED }}
          onClick={() => onMessage(shift)}
        >
          <MessageSquare size={12} /> {translate("coordinator.live.message")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-[11px] rounded-xl gap-1"
          style={{ borderColor: BORDER, color: "#D97706" }}
          onClick={() => onFlag(shift)}
        >
          <Flag size={12} /> {translate("coordinator.live.action.flag")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0 rounded-xl shrink-0"
          style={{ borderColor: "#FECACA", color: CORAL }}
          onClick={() => onEmergency(shift)}
        >
          <Zap size={12} />
        </Button>
      </div>
    </div>
  );
}

// ── Flag modal ─────────────────────────────────────────────────────────────────
function FlagModal({ shift, open, onClose }: { shift: LiveShift | null; open: boolean; onClose: () => void }) {
  const { translate } = useAccessibility();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<"warning" | "critical">("warning");

  const flagMut = useMutation({
    mutationFn: () => flagShift(shift!.id, note.trim(), severity),
    onSuccess: () => {
      toast({ title: translate("coordinator.live.toast.flagCreated") });
      onClose();
      setNote("");
    },
    onError: () => toast({ variant: "destructive", title: translate("coordinator.live.toast.flagFailed") }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="font-black text-base" style={{ color: TEXT }}>
            {translate("coordinator.live.flagShift")}
          </DialogTitle>
          <p className="text-[12px]" style={{ color: MUTED }}>{shift?.worker_name}</p>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(["warning", "critical"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                className="flex-1 py-1.5 rounded-xl text-[12px] font-semibold capitalize transition-colors"
                style={{
                  background: severity === s ? (s === "critical" ? CORAL : "#F59E0B") : SOFT,
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
function EmergencyModal({ shift, open, onClose }: { shift: LiveShift | null; open: boolean; onClose: () => void }) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [note, setNote] = useState(() => translate("coordinator.live.emergencyDefaultNote"));

  const emergMut = useMutation({
    mutationFn: () => emergencyStopShift(shift!.id, note),
    onSuccess: () => {
      toast({ title: translate("coordinator.live.toast.emergencyIssued") });
      qc.invalidateQueries({ queryKey: ["live-shifts", orgId] });
      onClose();
    },
    onError: () => toast({ variant: "destructive", title: translate("coordinator.live.toast.emergencyFailed") }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="font-black text-base" style={{ color: CORAL }}>
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
              {emergMut.isPending ? translate("coordinator.live.stopping") : translate("coordinator.live.confirmEmergencyStop")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CoordinatorLivePage() {
  const { translate, translateParams } = useAccessibility();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [filter, setFilter] = useState<"all" | "green" | "yellow" | "red">("all");
  const [msgShift, setMsgShift] = useState<LiveShift | null>(null);
  const [flagShiftState, setFlagShiftState] = useState<LiveShift | null>(null);
  const [emergShift, setEmergShift] = useState<LiveShift | null>(null);
  const [detailShift, setDetailShift] = useState<LiveShift | null>(null);

  const { data: shifts = [], isLoading, dataUpdatedAt, refetch } = useOrgQuery<LiveShift[]>(["live-shifts", orgId], { queryFn: getLiveShifts, refetchInterval: 30_000 });

  const filtered = filter === "all" ? shifts : shifts.filter((s) => s.live_status === filter);

  const counts = {
    all:    shifts.length,
    green:  shifts.filter((s) => s.live_status === "green").length,
    yellow: shifts.filter((s) => s.live_status === "yellow").length,
    red:    shifts.filter((s) => s.live_status === "red").length,
  };

  const lastRefresh = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : translate("common.emDash");

  return (
    <div className="pb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "var(--cc-text)" }}>
            <Radio size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight" style={{ color: TEXT }}>
              {translate("coordinator.live.title")}
            </h1>
            <p className="text-[12px]" style={{ color: MUTED }}>
              {translateParams("coordinator.live.subtitle", { time: lastRefresh })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {counts.red > 0 && (
            <span
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-black"
              style={{ background: "#FEF2F2", color: CORAL }}
            >
              <AlertTriangle size={13} /> {counts.red === 1
                ? translateParams("coordinator.live.alertCount", { count: String(counts.red) })
                : translateParams("coordinator.live.alertCountPlural", { count: String(counts.red) })}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl gap-1.5"
            style={{ borderColor: BORDER }}
            onClick={() => refetch()}
          >
            <RefreshCw size={13} /> {translate("coordinator.live.refresh")}
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-6">
        {(["all", "green", "yellow", "red"] as const).map((k) => {
          const meta = k === "all"
            ? { ring: PLUM, bg: SOFT, label: translate("coordinator.live.filter.totalActive") }
            : liveStatusLabel(k, translate);
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className="rounded-2xl p-4 text-left transition-all"
              style={{
                background: filter === k ? meta.bg : "var(--cc-bg)",
                border: `2px solid ${filter === k ? meta.ring : BORDER}`,
              }}
            >
              <p className="text-[24px] font-black leading-none" style={{ color: meta.ring }}>
                {counts[k]}
              </p>
              <p className="text-[11px] font-semibold mt-1" style={{ color: MUTED }}>
                {meta.label}
              </p>
            </button>
          );
        })}
      </div>

      {/* Grid */}
      {isLoading && (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: PLUM }} />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-2xl p-12 text-center" style={{ background: "var(--cc-bg)", border: `1px solid ${BORDER}` }}>
          <Activity size={36} className="mx-auto mb-3" style={{ color: BORDER }} />
          <p className="font-black text-[16px] mb-1" style={{ color: TEXT }}>
            {filter === "all"
              ? translate("coordinator.live.emptyAll")
              : translateParams("coordinator.live.emptyFiltered", { status: liveStatusLabel(filter as "green" | "yellow" | "red", translate).label.toLowerCase() })}
          </p>
          <p className="text-[13px]" style={{ color: MUTED }}>
            {translate("coordinator.live.emptyHint")}
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((shift) => (
            <LiveShiftCard
              key={shift.id}
              shift={shift}
              onMessage={setMsgShift}
              onFlag={setFlagShiftState}
              onEmergency={setEmergShift}
              onDetail={setDetailShift}
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
        <ShiftDetailModal
          shift={detailShift}
          open={!!detailShift}
          onClose={() => setDetailShift(null)}
        />
      )}
    </div>
  );
}

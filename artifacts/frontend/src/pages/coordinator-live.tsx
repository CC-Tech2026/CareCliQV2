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
  getLiveShifts, sendShiftMessage, flagShift, emergencyStopShift,
  type LiveShift, type ShiftMessage,
} from "@/services/coordinatorService";
import { getShiftMessages } from "@/services/coordinatorService";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const STATUS_RING: Record<LiveShift["live_status"], { ring: string; bg: string; label: string }> = {
  green:  { ring: "#22C55E", bg: "#F0FDF4", label: "On Track"  },
  yellow: { ring: "#F59E0B", bg: "#FFFBEB", label: "Attention" },
  red:    { ring: "#EF4444", bg: "#FEF2F2", label: "Alert"     },
};

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
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const color = pct >= 80 ? "#22C55E" : pct >= 50 ? "#F59E0B" : "#E5E7EB";
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-medium" style={{ color: MUTED }}>Tasks</span>
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
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [type, setType] = useState<ShiftMessage["message_type"]>("text");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], isLoading } = useOrgQuery<ShiftMessage[]>(["shift-messages", shift.id, orgId], { queryFn: () => getShiftMessages(shift.id), enabled: open, refetchInterval: 5000 });

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
    onError: () => toast({ variant: "destructive", title: "Message failed to send" }),
  });

  const MSG_TYPES: Array<{ v: ShiftMessage["message_type"]; label: string }> = [
    { v: "text",           label: "Message" },
    { v: "request_photo",  label: "Request Photo" },
    { v: "task_suggestion",label: "Task Tip" },
    { v: "flag_issue",     label: "Flag Issue" },
    { v: "emergency",      label: "Emergency" },
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="text-base font-black" style={{ color: TEXT }}>
            Message · {shift.worker_name}
          </DialogTitle>
          <p className="text-[12px]" style={{ color: MUTED }}>Re: {shift.participant_name ?? "participant"}</p>
        </DialogHeader>

        {/* Type selector */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {MSG_TYPES.map((t) => (
            <button
              key={t.v}
              onClick={() => setType(t.v)}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors"
              style={{
                background: type === t.v ? PLUM : SOFT,
                color: type === t.v ? "#fff" : MUTED,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Thread */}
        <div
          className="rounded-xl overflow-y-auto flex flex-col gap-2 p-3 mb-3"
          style={{ maxHeight: 240, background: SOFT, border: `1px solid ${BORDER}` }}
        >
          {isLoading && <p className="text-[12px] text-center" style={{ color: MUTED }}>Loading…</p>}
          {!isLoading && messages.length === 0 && (
            <p className="text-[12px] text-center" style={{ color: MUTED }}>No messages yet</p>
          )}
          {messages.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[80%] px-3 py-2 rounded-2xl text-[13px]"
                  style={{
                    background: mine ? PLUM : "var(--cc-bg)",
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
            placeholder="Type a message…"
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && text.trim() && sendMut.mutate()}
            className="flex-1 rounded-xl"
          />
          <Button
            size="sm"
            className="rounded-xl"
            style={{ background: PLUM, color: "#fff" }}
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
  const s = STATUS_RING[shift.live_status];
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="font-black text-base" style={{ color: TEXT }}>
            Shift Detail
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
                {shift.shift_type ?? "Shift"} · {shift.participant_name}
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
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>Clocked In</p>
              <p style={{ color: TEXT }}>{shift.clocked_in_at ? new Date(shift.clocked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>Elapsed</p>
              <ElapsedBadge startMinutes={shift.elapsed_minutes} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>Session</p>
              <p style={{ color: TEXT }}>{shift.session_id ? "Active" : "None"}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>Notes</p>
              <p style={{ color: TEXT }}>{shift.visit_notes ? "Recorded" : "None"}</p>
            </div>
          </div>

          {shift.alerts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: CORAL }}>Active Alerts</p>
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
              <p className="text-[11px] font-black uppercase tracking-widest mb-1" style={{ color: MUTED }}>Coordinator Notes</p>
              <p className="text-[13px] rounded-xl p-3" style={{ background: SOFT, color: TEXT }}>
                {shift.coordinator_notes}
              </p>
            </div>
          )}
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
  const s = STATUS_RING[shift.live_status];

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
              {shift.participant_name ?? "—"}
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
          {shift.shift_type ?? "General"}
        </span>
        {shift.session_id ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#22C55E" }}>
            <Activity size={11} /> Session Active
          </span>
        ) : (
          <span className="text-[11px] font-semibold" style={{ color: MUTED }}>
            No session started
          </span>
        )}
        {shift.visit_notes && (
          <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#3B82F6" }}>
            <CheckCircle2 size={11} /> Notes
          </span>
        )}
        {shift.emergency_flagged && (
          <span className="flex items-center gap-1 text-[11px] font-black" style={{ color: CORAL }}>
            <AlertTriangle size={11} /> EMERGENCY
          </span>
        )}
      </div>

      {/* Task bar */}
      <TaskBar total={shift.task_counts.total} completed={shift.task_counts.completed} />

      {/* Alerts */}
      {shift.alerts.length > 0 && (
        <div
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5"
          style={{ background: "#FEF2F2" }}
        >
          <AlertTriangle size={12} style={{ color: CORAL }} />
          <p className="text-[11px] font-semibold truncate" style={{ color: CORAL }}>
            {shift.alerts[0].message}
            {shift.alerts.length > 1 && ` +${shift.alerts.length - 1} more`}
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
          <MessageSquare size={12} /> Message
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-[11px] rounded-xl gap-1"
          style={{ borderColor: BORDER, color: "#D97706" }}
          onClick={() => onFlag(shift)}
        >
          <Flag size={12} /> Flag
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
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<"warning" | "critical">("warning");

  const flagMut = useMutation({
    mutationFn: () => flagShift(shift!.id, note.trim(), severity),
    onSuccess: () => {
      toast({ title: "Flag created" });
      onClose();
      setNote("");
    },
    onError: () => toast({ variant: "destructive", title: "Flag failed" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="font-black text-base" style={{ color: TEXT }}>
            Flag Shift
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
                {s}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Describe the issue…"
            rows={3}
            className="w-full rounded-xl px-3 py-2 text-[13px] outline-none resize-none"
            style={{ border: `1px solid ${BORDER}`, color: TEXT }}
          />
          <Button
            className="w-full rounded-xl"
            style={{ background: PLUM, color: "#fff" }}
            disabled={!note.trim() || flagMut.isPending}
            onClick={() => flagMut.mutate()}
          >
            Submit Flag
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Emergency modal ────────────────────────────────────────────────────────────
function EmergencyModal({ shift, open, onClose }: { shift: LiveShift | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [note, setNote] = useState("Emergency stop triggered by coordinator");

  const emergMut = useMutation({
    mutationFn: () => emergencyStopShift(shift!.id, note),
    onSuccess: () => {
      toast({ title: "Emergency stop issued — worker has been notified" });
      qc.invalidateQueries({ queryKey: ["live-shifts", orgId] });
      onClose();
    },
    onError: () => toast({ variant: "destructive", title: "Emergency stop failed" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm" style={{ borderRadius: 20 }}>
        <DialogHeader>
          <DialogTitle className="font-black text-base" style={{ color: CORAL }}>
            ⚠️ Emergency Stop
          </DialogTitle>
          <p className="text-[12px]" style={{ color: MUTED }}>
            This will flag the shift and notify the worker immediately.
          </p>
        </DialogHeader>
        <div className="space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            title="Incident note"
            placeholder="Add optional details about this incident..."
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
              Cancel
            </Button>
            <Button
              className="flex-1 rounded-xl"
              style={{ background: CORAL, color: "#fff" }}
              disabled={emergMut.isPending}
              onClick={() => emergMut.mutate()}
            >
              {emergMut.isPending ? "Stopping…" : "Confirm Emergency Stop"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function CoordinatorLivePage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const [filter, setFilter] = useState<"all" | "green" | "yellow" | "red">("all");
  const [msgShift, setMsgShift] = useState<LiveShift | null>(null);
  const [flagShiftState, setFlagShiftState] = useState<LiveShift | null>(null);
  const [emergShift, setEmergShift] = useState<LiveShift | null>(null);
  const [detailShift, setDetailShift] = useState<LiveShift | null>(null);

  const { data: shifts = [], isLoading, dataUpdatedAt, refetch } = useOrgQuery<LiveShift[]>(["live-shifts", orgId], { queryFn: getLiveShifts, refetchInterval: 10000 });

  const filtered = filter === "all" ? shifts : shifts.filter((s) => s.live_status === filter);

  const counts = {
    all:    shifts.length,
    green:  shifts.filter((s) => s.live_status === "green").length,
    yellow: shifts.filter((s) => s.live_status === "yellow").length,
    red:    shifts.filter((s) => s.live_status === "red").length,
  };

  const lastRefresh = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  return (
    <div className="pb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: PLUM }}>
            <Radio size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>
              Live Monitoring
            </h1>
            <p className="text-[12px]" style={{ color: MUTED }}>
              Real-time shift status · refreshes every 10s · last {lastRefresh}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {counts.red > 0 && (
            <span
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-black"
              style={{ background: "#FEF2F2", color: CORAL }}
            >
              <AlertTriangle size={13} /> {counts.red} Alert{counts.red !== 1 ? "s" : ""}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl gap-1.5"
            style={{ borderColor: BORDER }}
            onClick={() => refetch()}
          >
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-6">
        {(["all", "green", "yellow", "red"] as const).map((k) => {
          const meta = k === "all"
            ? { ring: PLUM, bg: SOFT, label: "Total Active" }
            : STATUS_RING[k];
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
            {filter === "all" ? "No active shifts right now" : `No ${STATUS_RING[filter as "green" | "yellow" | "red"].label.toLowerCase()} shifts`}
          </p>
          <p className="text-[13px]" style={{ color: MUTED }}>
            Shifts will appear here when workers clock in
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

import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronDown,
  Clock3,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Send,
  ShieldCheck,
  Siren,
  Star,
  UserRound,
  Zap,
} from "lucide-react";
import { differenceInMinutes, parseISO } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useWorkerTutorialOptional } from "@/hooks/useWorkerTutorial";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ShiftStatusBadge } from "@/components/shifts/ShiftStatusBadge";
import { startShiftSession, formatActiveGoalLabel, type WorkerShift } from "@/services/shiftService";
import {
  shiftInitials,
  shiftDurationMinutes,
  formatDurationLabel,
  formatShiftTimeRange,
  TEXT,
  MUTED,
  PLUM,
  CORAL,
  BORDER,
  STATE_STYLES,
  avatarShouldPulse,
  isShiftToday,
  shiftNeedsRiskAck,
  shiftNeedsBriefing,
  shiftBriefingHref,
} from "@/lib/shift-utils";

const SERVICE_TAG_STYLES: Record<string, string> = {
  CORE: "bg-[#F0EDF8] text-[#3730A3] border-[#E5E7EB]",
  "CAPACITY BUILDING": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

type Props = { shift: WorkerShift };

function formatServiceLabel(category: string | undefined, translate: (key: string) => string) {
  const raw = (category || "CORE").toUpperCase();
  if (raw === "CAPACITY BUILDING" || raw === "CAPACITY") return translate("shifts.listCard.serviceCapacity");
  if (raw === "CORE") return translate("shifts.listCard.serviceCore");
  return category || translate("shifts.listCard.serviceCore");
}

function serviceTagKey(category?: string) {
  const raw = (category || "CORE").toUpperCase();
  return raw === "CAPACITY" ? "CAPACITY BUILDING" : raw;
}

function formatRecordedDuration(shift: WorkerShift) {
  if (shift.duration_minutes && shift.duration_minutes > 0) {
    return formatDurationLabel(shift.duration_minutes);
  }
  if (shift.clocked_in_at && shift.clocked_out_at) {
    try {
      const mins = differenceInMinutes(parseISO(shift.clocked_out_at), parseISO(shift.clocked_in_at));
      return formatDurationLabel(mins);
    } catch {
      return null;
    }
  }
  return null;
}

function ActionPill({
  href,
  icon: Icon,
  label,
  external,
}: {
  href: string;
  icon: typeof Phone;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border bg-white px-4 py-2.5 text-xs font-bold transition hover:bg-[#FAFAFE] active:bg-[#F0EDF8]"
      style={{ borderColor: BORDER, color: TEXT }}
    >
      <Icon size={14} className="shrink-0" style={{ color: PLUM }} />
      <span>{label}</span>
    </a>
  );
}

function SafetyBox({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Siren;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/90 px-3 py-3">
      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
        <Icon size={12} />
        {title}
      </p>
      <p className="mt-1.5 text-xs font-medium leading-relaxed text-emerald-900">{body}</p>
    </div>
  );
}

export function ShiftListCard({ shift }: Props) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { translate, translateParams } = useAccessibility();
  const orgId = user?.organizationId ?? "__no_org__";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tutorial = useWorkerTutorialOptional();
  const isTutorial = tutorial?.isTutorialMode ?? false;
  const [expanded, setExpanded] = useState(false);
  const [starting, setStarting] = useState(false);

  const scheduledDuration = shiftDurationMinutes(
    shift.scheduled_start,
    shift.scheduled_end,
    shift.duration_minutes,
  );
  const scheduledLabel = formatDurationLabel(scheduledDuration);
  const recordedLabel = formatRecordedDuration(shift);
  const serviceTag = formatServiceLabel(shift.service_category, translate);
  const tagStyle = SERVICE_TAG_STYLES[serviceTagKey(shift.service_category)] ?? SERVICE_TAG_STYLES.CORE;
  const isCancelled = shift.status === "cancelled";
  const isCompleted = shift.status === "completed" || shift.visual_state === "completed";
  const isTodayActive = isShiftToday(shift) && !isCancelled && !isCompleted;
  const isSessionLive = shift.visual_state === "session_active";
  const sessionButtonLabel = starting
    ? translate("shifts.listCard.starting")
    : isSessionLive
      ? translate("shifts.listCard.resumeSession")
      : translate("shifts.listCard.startSession");
  const stateStyle = isCancelled
    ? { border: "#FECACA", badge: "bg-red-50 text-red-700 border-red-200", label: translate("shifts.listCard.cancelled"), avatar: "#EF4444" }
    : (STATE_STYLES[shift.visual_state] ?? STATE_STYLES.scheduled);
  const pulse = avatarShouldPulse(shift.visual_state);

  const allergiesText = shift.allergies?.trim() || translate("shifts.listCard.noAllergies");
  const healthAlertText =
    shift.health_alerts?.map((a) => a.title || a.detail).filter(Boolean).join(" ") ||
    shift.health_flags?.trim() ||
    translate("shifts.listCard.noHealthAlerts");
  const goals = shift.active_goals ?? [];
  const mapsUrl = shift.participant_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shift.participant_address)}`
    : null;
  const phone = shift.participant_phone?.trim();
  const profileHref = shift.participant_id
    ? `/my-clients/${shift.participant_id}`
    : `/my-shifts/${shift.id}`;
  const notesHref = shift.session_id ? `/sessions/${shift.session_id}` : `/my-shifts/${shift.id}`;

  const durationMeta = (() => {
    if (isCompleted && scheduledLabel && recordedLabel) {
      return translateParams("shifts.listCard.durationBoth", {
        scheduled: scheduledLabel,
        recorded: recordedLabel,
      });
    }
    if (isCompleted && recordedLabel) {
      return translateParams("shifts.listCard.durationRecorded", { duration: recordedLabel });
    }
    if (scheduledLabel) {
      return translateParams("shifts.listCard.durationScheduled", { duration: scheduledLabel });
    }
    return null;
  })();

  const handleSessionAction = async () => {
    if (isSessionLive) {
      navigate(`/my-shifts/${shift.id}`);
      return;
    }

    if (shiftNeedsBriefing(shift, { tutorial: isTutorial })) {
      navigate(shiftBriefingHref(shift.id, { tutorial: isTutorial }));
      return;
    }

    if (shiftNeedsRiskAck(shift)) {
      toast({
        title: translate("toast.ackSafetyFirst"),
        description: translate("toast.ackSafetySession"),
        variant: "destructive",
      });
      navigate(`/my-shifts/${shift.id}?focus=safety`);
      return;
    }

    if (shift.visual_state === "scheduled") {
      navigate(`/my-shifts/${shift.id}`);
      return;
    }

    if (shift.visual_state === "clocked_in") {
      await handleStartSession();
      return;
    }

    navigate(`/my-shifts/${shift.id}`);
  };

  const handleStartSession = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const updated = await startShiftSession(shift.id);
      void queryClient.invalidateQueries({ queryKey: ["worker", "shifts"] });
      void queryClient.invalidateQueries({ queryKey: [orgId, "worker", "shift", shift.id] });
      toast({
        title: translate("toast.sessionStarted"),
        description: translateParams("toast.sessionStartedDesc", {
          name: shift.participant_name ?? translate("common.participant"),
        }),
      });
      navigate(`/my-shifts/${updated.id}`);
    } catch (err) {
      toast({
        title: translate("toast.couldNotStartSession"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setStarting(false);
    }
  };

  const primaryActions = isTodayActive && (
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        disabled={starting}
        className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black text-white disabled:opacity-60"
        style={{ background: PLUM }}
        data-tutorial="start-session"
        onClick={() => void handleSessionAction()}
      >
        <Zap size={15} />
        {sessionButtonLabel}
      </button>
      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-black"
          style={{ borderColor: BORDER, color: TEXT }}
        >
          <Navigation size={15} />
          {translate("shifts.listCard.directions")}
        </a>
      )}
      {phone && (
        <a
          href={`tel:${phone.replace(/\s/g, "")}`}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-black"
          style={{ borderColor: BORDER, color: TEXT }}
        >
          <Phone size={15} />
          {translate("shifts.listCard.call")}
        </a>
      )}
    </div>
  );

  const expandedBody = (
    <>
      {primaryActions}

      {isCompleted && (
        <Link href={notesHref}>
          <button
            type="button"
            className="mb-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-black text-white"
            style={{ background: CORAL }}
          >
            {translate("shifts.listCard.completeNotes")}
          </button>
        </Link>
      )}

      <div className="mb-1 mt-2">
        <p className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: PLUM }}>
          {translate("shifts.listCard.safetyRead")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SafetyBox icon={Siren} title={translate("shifts.listCard.allergies")} body={allergiesText} />
        <SafetyBox icon={ShieldCheck} title={translate("shifts.listCard.healthAlerts")} body={healthAlertText} />
      </div>

      {goals.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: PLUM }}>
            {translate("shifts.listCard.activeGoals")}
          </p>
          <div className="flex flex-wrap gap-2">
            {goals.map((goal, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#F0EDF8] px-3 py-1.5 text-xs font-bold"
                style={{ color: PLUM }}
              >
                <Star size={12} className="text-amber-500" fill="currentColor" />
                {formatActiveGoalLabel(goal)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {mapsUrl && <ActionPill href={mapsUrl} icon={Send} label={translate("shifts.listCard.openMaps")} external />}
        {phone && <ActionPill href={`tel:${phone.replace(/\s/g, "")}`} icon={Phone} label={phone} />}
        <Link href={profileHref}>
          <span className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border bg-white px-4 py-2.5 text-xs font-bold transition hover:bg-[#F0EDF8]" style={{ borderColor: BORDER, color: TEXT }}>
            <UserRound size={14} style={{ color: PLUM }} />
            {translate("shifts.listCard.fullProfile")}
          </span>
        </Link>
        <Link href={`/my-shifts/${shift.id}`}>
          <span className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border bg-white px-4 py-2.5 text-xs font-bold transition hover:bg-[#F0EDF8]" style={{ borderColor: BORDER, color: TEXT }}>
            <MessageCircle size={14} style={{ color: PLUM }} />
            {translate("shifts.listCard.messageCoordinator")}
          </span>
        </Link>
      </div>
    </>
  );

  return (
    <article className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <div className="p-5">
        <button
          type="button"
          className="flex w-full items-start gap-3.5 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <div
            className={cn(
              "grid size-[3.25rem] shrink-0 place-items-center rounded-full text-sm font-black text-white",
              pulse && "animate-pulse",
            )}
            style={{ background: stateStyle.avatar }}
          >
            {shiftInitials(shift.participant_name)}
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[17px] font-black leading-snug" style={{ color: TEXT }}>
                {shift.participant_name || translate("shifts.listCard.participant")}
              </h3>
              <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase", tagStyle)}>
                {serviceTag}
              </span>
            </div>

            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>
              <Clock3 size={13} className="shrink-0" />
              <span>{formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}</span>
              {durationMeta && (
                <>
                  <span className="opacity-40">·</span>
                  <span>{durationMeta}</span>
                </>
              )}
            </p>

            {shift.participant_address && (
              <p className="mt-1 flex items-start gap-1.5 text-[13px] font-medium" style={{ color: MUTED }}>
                <MapPin size={13} className="mt-0.5 shrink-0" />
                <span className="line-clamp-1">{shift.participant_address}</span>
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
            {isCancelled ? (
              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-red-700">
                {translate("shifts.listCard.cancelled")}
              </span>
            ) : isCompleted ? (
              <span
                className="rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide"
                style={{ borderColor: "var(--cc-border)", background: "#F0EDF8", color: PLUM }}
              >
                {translate("shifts.listCard.done")}
              </span>
            ) : (
              <ShiftStatusBadge visualState={shift.visual_state} />
            )}
            <ChevronDown
              size={20}
              className={cn("transition-transform duration-200", expanded && "rotate-180")}
              style={{ color: MUTED }}
            />
          </div>
        </button>

        {!expanded && isCompleted && (
          <Link href={notesHref}>
            <button
              type="button"
              className="mt-3 flex h-12 w-full items-center justify-center rounded-xl px-4 text-sm font-black text-white"
              style={{ background: CORAL }}
            >
              {translate("shifts.listCard.completeNotes")}
            </button>
          </Link>
        )}

        {!expanded && primaryActions}
      </div>

      {expanded && (
        <div className="border-t bg-white px-5 pb-5 pt-4" style={{ borderColor: BORDER }}>
          {expandedBody}
        </div>
      )}
    </article>
  );
}

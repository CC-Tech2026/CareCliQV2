import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { differenceInMinutes, parseISO } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  ClipboardList,
  Clock3,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Send,
  ShieldCheck,
  Siren,
  Star,
  UserRound,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { emergencyContactDisplay } from "@/lib/participant-display";
import { ShiftStatusBadge } from "@/components/shifts/ShiftStatusBadge";
import {
  clockInShift,
  startShiftSession,
  formatActiveGoalLabel,
  type ParticipantProfile,
  type WorkerShift,
} from "@/services/shiftService";
import {
  shiftInitials,
  shiftDurationMinutes,
  formatDurationLabel,
  formatShiftTimeRange,
  CORAL,
  STATE_STYLES,
  avatarShouldPulse,
  isShiftCompletedForList,
  shiftNeedsRiskAck,
} from "@/lib/shift-utils";

const SERVICE_TAG_STYLES: Record<string, string> = {
  CORE: "cc-plum-panel text-cc-plum",
  "CAPACITY BUILDING": "cc-status-success border",
};

function ShiftListCardMobile({
  shift,
  translate,
  stateStyle,
  pulse,
  primaryActions,
  isCompleted,
  showDetails,
  notesHref,
  goals,
  notesText,
  medicalAlert,
  emergencyContact,
  caseManager,
  officePhone,
}: {
  shift: WorkerShift;
  translate: (key: string) => string;
  stateStyle: { avatar: string };
  pulse: boolean;
  primaryActions: ReactNode;
  isCompleted: boolean;
  showDetails: boolean;
  notesHref: string;
  goals: WorkerShift["active_goals"];
  notesText: string | null;
  medicalAlert: string | null;
  emergencyContact: ReturnType<typeof emergencyContactDisplay>;
  caseManager: ParticipantProfile["case_manager"] | null | undefined;
  officePhone: string | null;
}) {
  const isCancelled = shift.status === "cancelled";
  const hasAddress = Boolean(shift.participant_address?.trim());
  const coordinatorLine = [caseManager?.phone, caseManager?.email].filter(Boolean).join(" · ");

  return (
    <article
      className={cn(
        "w-full overflow-hidden rounded-2xl border border-cc-border bg-cc-surface shadow-sm",
        isCancelled && "opacity-75",
        isCompleted && "opacity-80",
      )}
    >
      <div className="p-3.5 sm:p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full text-xs font-black text-white sm:size-12 sm:text-sm",
              pulse && "animate-pulse",
            )}
            style={{ background: stateStyle.avatar }}
          >
            {shiftInitials(shift.participant_name)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3
                className={cn("text-[15px] font-black leading-tight text-cc-text sm:text-[16px]", isCancelled && "line-through")}
              >
                {shift.participant_name || translate("shifts.listCard.participant")}
              </h3>
              {!isCancelled && isCompleted && (
                <span className="cc-plum-panel shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-cc-muted sm:text-[10px]">
                  {translate("shifts.listCard.done")}
                </span>
              )}
              {!isCancelled && !isCompleted && (
                <span className="shrink-0 scale-90 origin-top-right sm:scale-100">
                  <ShiftStatusBadge visualState={shift.visual_state} />
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] font-semibold leading-snug text-cc-muted sm:text-[13px]">
              {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}
            </p>
            <p className="mt-1 flex items-start gap-1.5 text-[12px] font-medium leading-snug text-cc-muted sm:text-[13px]">
              <MapPin size={12} className={cn("mt-0.5 shrink-0", hasAddress ? "text-cc-plum" : "text-cc-muted")} />
              <span className={cn("min-w-0 break-words", !hasAddress && "italic")}>
                {shift.participant_address?.trim() || translate("shift.map.noAddress")}
              </span>
            </p>
          </div>
        </div>

        {showDetails && goals && goals.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {goals.map((goal, i) => (
              <span
                key={i}
                className="cc-plum-panel inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-cc-plum sm:text-xs"
              >
                <Star size={10} className="shrink-0 text-amber-500" fill="currentColor" />
                <span className="truncate">{formatActiveGoalLabel(goal)}</span>
              </span>
            ))}
          </div>
        )}

        {showDetails && emergencyContact && (
          <div className="mt-2.5 rounded-xl border border-cc-border bg-cc-soft px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[9px] font-black uppercase tracking-wider text-cc-muted">
                  {translate("shifts.listCard.nextOfKin")}
                </p>
                {emergencyContact.name && (
                  <p className="mt-1 text-[13px] font-bold leading-tight text-cc-text">
                    {emergencyContact.name}
                  </p>
                )}
                <p className="mt-0.5 text-[12px] font-medium leading-snug text-cc-muted">
                  {emergencyContact.detail || emergencyContact.text}
                </p>
              </div>
              {emergencyContact.phone && (
                <a
                  href={`tel:${emergencyContact.phone.replace(/\s/g, "")}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cc-border bg-cc-surface px-2.5 py-1.5 text-[11px] font-bold text-cc-plum hover:bg-cc-soft"
                >
                  <Phone size={12} />
                  {translate("shifts.listCard.call")}
                </a>
              )}
            </div>
          </div>
        )}

        {showDetails && (caseManager?.name || notesText) && (
          <div className="mt-2.5 rounded-xl border border-cc-border bg-cc-soft px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <ClipboardList size={14} className="shrink-0 text-cc-plum" />
                <p className="truncate text-[13px] font-bold text-cc-text">
                  {caseManager?.name || translate("shifts.listCard.messageCoordinator")}
                </p>
              </div>
              <Link href="/worker/messages">
                <span className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-cc-coral">
                  <Mail size={12} />
                  {translate("shifts.listCard.message")}
                </span>
              </Link>
            </div>
            {notesText && (
              <p className="mt-2 text-[12px] font-medium leading-relaxed text-cc-text">
                {notesText}
              </p>
            )}
            {(coordinatorLine || officePhone) && (
              <p className="mt-1.5 break-words text-[11px] font-medium text-cc-muted">
                {coordinatorLine || officePhone}
              </p>
            )}
          </div>
        )}

        {showDetails && medicalAlert && (
          <div className="mt-2.5 rounded-xl border cc-status-critical px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-black">
              <AlertTriangle size={13} className="shrink-0" />
              {translate("shifts.listCard.medicalAlert")}
            </p>
            <p className="mt-1 text-[12px] font-medium leading-relaxed">{medicalAlert}</p>
          </div>
        )}

        {showDetails && primaryActions}

        {isCompleted && (
          <Link href={notesHref}>
            <button
              type="button"
              className="mt-3 flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-black text-white sm:h-12"
              style={{ background: CORAL }}
            >
              {translate("shifts.listCard.completeNotes")}
            </button>
          </Link>
        )}
      </div>
    </article>
  );
}

type Props = { shift: WorkerShift; showActions?: boolean };

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
      className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-cc-border bg-cc-surface px-4 py-2.5 text-xs font-bold text-cc-text transition hover:bg-cc-soft active:bg-cc-active-bg"
    >
      <Icon size={14} className="shrink-0 text-cc-plum" />
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
    <div className="rounded-xl border cc-status-success px-3 py-3">
      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider">
        <Icon size={12} />
        {title}
      </p>
      <p className="mt-1.5 text-xs font-medium leading-relaxed">{body}</p>
    </div>
  );
}

export function ShiftListCard({ shift, showActions = false }: Props) {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { translate, translateParams } = useAccessibility();
  const orgId = user?.organizationId ?? "__no_org__";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isMobile = useIsMobile();
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
  const isCompleted = isShiftCompletedForList(shift);
  const showDetails = showActions;
  const isSessionLive = shift.visual_state === "session_active";
  const clockInButtonLabel = starting
    ? translate("shifts.listCard.starting")
    : isSessionLive
      ? translate("shifts.listCard.resumeSession")
      : shift.visual_state === "clocked_in"
        ? translate("shifts.listCard.startSession")
        : translate("shifts.listCard.clockIn");
  const stateStyle = isCancelled
    ? { border: "var(--cc-status-critical)", badge: "cc-status-critical border", label: translate("shifts.listCard.cancelled"), avatar: "#EF4444" }
    : isCompleted
      ? { ...STATE_STYLES.completed, label: translate("shifts.listCard.done") }
      : (STATE_STYLES[shift.visual_state] ?? STATE_STYLES.scheduled);
  const pulse = !isCompleted && avatarShouldPulse(shift.visual_state);

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
  const notesHref = `/my-shifts/${shift.id}`;
  const notesText = shift.coordinator_notes?.trim() || shift.visit_notes?.trim() || shift.special_instructions?.trim() || shift.context?.previous_visit_notes?.trim() || null;
  const medicalAlert =
    shift.health_alerts?.map((a) => a.title || a.detail).filter(Boolean).join(" · ") ||
    shift.health_flags?.trim() ||
    shift.allergies?.trim() ||
    null;
  const emergencyContact = emergencyContactDisplay(shift.profile?.emergency_contact);
  const caseManager = shift.profile?.case_manager;
  const officePhone = shift.office_contact_number?.trim() || null;

  const captureGps = () =>
    new Promise<{ lat: number; lng: number; accuracy?: number } | null>((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    });

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

  const runStartSession = async () => {
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
  };

  const handleClockIn = async () => {
    if (starting) return;
    if (isSessionLive || shift.visual_state === "session_active") {
      navigate(`/my-shifts/${shift.id}`);
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

    if (shift.visual_state === "clocked_in") {
      setStarting(true);
      try {
        await runStartSession();
      } catch (err) {
        toast({
          title: translate("toast.couldNotStartSession"),
          description: (err as Error).message,
          variant: "destructive",
        });
      } finally {
        setStarting(false);
      }
      return;
    }

    setStarting(true);
    try {
      const location = await captureGps();
      if (!location) {
        toast({
          title: translate("clockin.geoDenied"),
          description: translate("clockin.geoFailed"),
          variant: "destructive",
        });
        return;
      }

      await clockInShift(shift.id, {
        method: "gps",
        location,
        client_timestamp: new Date().toISOString(),
      });
      await runStartSession();
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

  const primaryActions = showActions && !isCompleted && (
    <div className="mt-3 flex gap-1.5 sm:mt-4 sm:gap-2">
      {mapsUrl ? (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-cc-border bg-cc-surface px-2 text-[11px] font-black text-cc-text hover:bg-cc-soft sm:h-12 sm:gap-2 sm:px-3 sm:text-sm"
        >
          <Navigation size={14} className="shrink-0" />
          <span className="truncate">{translate("shifts.listCard.directions")}</span>
        </a>
      ) : (
        <button
          type="button"
          className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-cc-border bg-cc-surface px-2 text-[11px] font-black text-cc-text hover:bg-cc-soft sm:h-12 sm:gap-2 sm:px-3 sm:text-sm"
          onClick={() =>
            toast({
              title: translate("shifts.listCard.directions"),
              description: translate("shifts.listCard.noLocationStored"),
              variant: "destructive",
            })
          }
        >
          <Navigation size={14} className="shrink-0" />
          <span className="truncate">{translate("shifts.listCard.directions")}</span>
        </button>
      )}
      {phone ? (
        <a
          href={`tel:${phone.replace(/\s/g, "")}`}
          className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-cc-border bg-cc-surface px-2 text-[11px] font-black text-cc-text hover:bg-cc-soft sm:h-12 sm:gap-2 sm:px-3 sm:text-sm"
        >
          <Phone size={14} className="shrink-0" />
          <span className="truncate">{translate("shifts.listCard.call")}</span>
        </a>
      ) : (
        <button
          type="button"
          className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl border border-cc-border bg-cc-surface px-2 text-[11px] font-black text-cc-text hover:bg-cc-soft sm:h-12 sm:gap-2 sm:px-3 sm:text-sm"
          onClick={() =>
            toast({
              title: translate("shifts.listCard.call"),
              description: translate("shifts.listCard.noPhoneStored"),
              variant: "destructive",
            })
          }
        >
          <Phone size={14} className="shrink-0" />
          <span className="truncate">{translate("shifts.listCard.call")}</span>
        </button>
      )}
      <button
        type="button"
        disabled={starting}
        className="inline-flex h-10 min-w-0 flex-[1.35] items-center justify-center gap-1.5 rounded-xl px-2 text-[11px] font-black text-white disabled:opacity-60 sm:h-12 sm:px-3 sm:text-sm"
        style={{ background: CORAL }}
        data-tutorial="start-session"
        onClick={() => void handleClockIn()}
      >
        {starting ? <Loader2 size={14} className="animate-spin shrink-0" /> : null}
        <span className="truncate">{clockInButtonLabel}</span>
      </button>
    </div>
  );

  const mobilePrimaryActions = primaryActions;

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
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cc-plum">
          {translate("shifts.listCard.safetyRead")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SafetyBox icon={Siren} title={translate("shifts.listCard.allergies")} body={allergiesText} />
        <SafetyBox icon={ShieldCheck} title={translate("shifts.listCard.healthAlerts")} body={healthAlertText} />
      </div>

      {goals.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-cc-plum">
            {translate("shifts.listCard.activeGoals")}
          </p>
          <div className="flex flex-wrap gap-2">
            {goals.map((goal, i) => (
              <span
                key={i}
                className="cc-plum-panel inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-cc-plum"
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
          <span className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-cc-border bg-cc-surface px-4 py-2.5 text-xs font-bold text-cc-text transition hover:bg-cc-soft">
            <UserRound size={14} className="text-cc-plum" />
            {translate("shifts.listCard.fullProfile")}
          </span>
        </Link>
        <Link href={`/my-shifts/${shift.id}`}>
          <span className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full border border-cc-border bg-cc-surface px-4 py-2.5 text-xs font-bold text-cc-text transition hover:bg-cc-soft">
            <MessageCircle size={14} className="text-cc-plum" />
            {translate("shifts.listCard.messageCoordinator")}
          </span>
        </Link>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <ShiftListCardMobile
        shift={shift}
        translate={translate}
        stateStyle={stateStyle}
        pulse={pulse}
        primaryActions={mobilePrimaryActions}
        isCompleted={isCompleted}
        showDetails={showDetails}
        notesHref={notesHref}
        goals={goals}
        notesText={notesText}
        medicalAlert={medicalAlert}
        emergencyContact={emergencyContact}
        caseManager={caseManager}
        officePhone={officePhone}
      />
    );
  }

  return (
    <article className={cn("overflow-hidden rounded-2xl border border-cc-border bg-cc-surface shadow-sm", isCompleted && "opacity-80")}>
      <div className="p-5">
        <button
          type="button"
          className={cn("flex w-full items-start gap-3.5 text-left", !showDetails && "cursor-default")}
          onClick={() => showDetails && setExpanded(!expanded)}
          disabled={!showDetails}
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
              <h3 className="text-[17px] font-black leading-snug text-cc-text">
                {shift.participant_name || translate("shifts.listCard.participant")}
              </h3>
              <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase", tagStyle)}>
                {serviceTag}
              </span>
            </div>

            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-cc-muted">
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
              <p className="mt-1 flex items-start gap-1.5 text-[13px] font-medium text-cc-muted">
                <MapPin size={13} className="mt-0.5 shrink-0" />
                <span className="line-clamp-1">{shift.participant_address}</span>
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
            {isCancelled ? (
              <span className="cc-status-critical rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide">
                {translate("shifts.listCard.cancelled")}
              </span>
            ) : isCompleted ? (
              <span className="cc-plum-panel rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-cc-plum">
                {translate("shifts.listCard.done")}
              </span>
            ) : (
              <ShiftStatusBadge visualState={shift.visual_state} />
            )}
            {showDetails && (
              <ChevronDown
                size={20}
                className={cn("text-cc-muted transition-transform duration-200", expanded && "rotate-180")}
              />
            )}
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

        {!expanded && showDetails && primaryActions}
      </div>

      {expanded && showDetails && (
        <div className="border-t border-cc-border bg-cc-surface px-5 pb-5 pt-4">
          {expandedBody}
        </div>
      )}
    </article>
  );
}

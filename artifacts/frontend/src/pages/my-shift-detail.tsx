import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { recordShiftViewed } from "@/services/notificationService";
import { Link, useParams } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useShiftTimer } from "@/hooks/useShiftTimer";
import { useLongShiftBreak } from "@/hooks/useLongShiftBreak";
import { useShiftSessionActions } from "@/hooks/useShiftSessionActions";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Square,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DuringShiftAccordion } from "@/components/shifts/DuringShiftAccordion";
import { ShiftTaskChecklist } from "@/components/shifts/ShiftTaskChecklist";
import { SessionTimeline } from "@/components/shifts/SessionTimeline";
import { ShiftProgressStepper } from "@/components/shifts/ShiftProgressStepper";
import { ShiftStatusBadge } from "@/components/shifts/ShiftStatusBadge";
import { ShiftMapPanel } from "@/components/shifts/ShiftMapPanel";
import { ShiftTravelExpenseCard, type MileageDraftState } from "@/components/shifts/ShiftTravelExpenseCard";
import { ShiftTransitExpenseCard } from "@/components/shifts/ShiftTransitExpenseCard";
import { ShiftStageBanner } from "@/components/shifts/ShiftStageBanner";
import { OfflineSyncBanner } from "@/components/shifts/OfflineSyncBanner";
import { EvidenceSyncBanner } from "@/components/shifts/EvidenceSyncBanner";
import { LongShiftEngagementPanel } from "@/components/shifts/LongShiftEngagementPanel";
import { BreakStatusBanner } from "@/components/shifts/BreakStatusBanner";
import { CheckInPromptModal } from "@/components/shifts/CheckInPromptModal";
import { useLongShiftCheckin } from "@/hooks/useLongShiftCheckin";
import {
  markSessionHeartbeat,
  markSessionOffline,
  submitLongShiftCheckin,
  type CheckinStatus,
} from "@/services/longShiftService";
import { useEvidenceSync } from "@/hooks/useEvidenceSync";
import { SupportInstructionsAccordion } from "@/components/shifts/SupportInstructionsAccordion";
import { ParticipantRiskAcknowledgementSection } from "@/components/shifts/ParticipantRiskAlerts";
import { RiskAcknowledgementLoadingOverlay } from "@/components/shifts/RiskAcknowledgementLoadingOverlay";
import {
  cacheParticipantContext,
  loadCachedParticipantContext,
  type CachedParticipantContext,
} from "@/lib/participant-context-cache";
import { ClockInFlow } from "@/components/shifts/ClockInFlow";
import {
  enqueueClockIn,
  getPendingClockIn,
  listPendingActions,
} from "@/lib/shift-offline-queue";
import { syncAllQueuedShiftActions } from "@/lib/sync-pending-shift-actions";
import { ShiftCompletionSummary } from "@/components/shifts/ShiftCompletionSummary";
import { EndShiftValidationModal } from "@/components/shifts/EndShiftValidationModal";
import { ShiftSignatureModal } from "@/components/shifts/ShiftSignatureModal";
import { MandatoryTasksAlert } from "@/components/shifts/MandatoryTasksAlert";
import { StartSessionButton } from "@/components/shifts/StartSessionButton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useWorkerTutorialOptional } from "@/hooks/useWorkerTutorial";
import { TUTORIAL_SESSION_ID } from "@/lib/tutorial-offline";
import { cn } from "@/lib/utils";
import {
  acknowledgeShiftRisks,
  clockInShift,
  clockOutShift,
  endShift,
  clearPendingStartSession,
  getWorkerShift,
  updateShiftTasks,
  type ClockInRequest,
  type ShiftTask,
  type ShiftHealthAlert,
  type ShiftVisualState,
  type WorkerShift,
  type ParticipantProfile,
  type ParticipantPreferences,
  type ParticipantContext,
} from "@/services/shiftService";
import {
  BORDER,
  CORAL,
  MUTED,
  PLUM,
  STATE_STYLES,
  TEXT,
  avatarShouldPulse,
  formatDurationLabel,
  formatShiftTimeRange,
  resolveActiveShiftTasks,
  hasIncompleteMandatoryTasks,
  incompleteMandatoryTasks,
  shiftDurationMinutes,
  shiftHasRiskAlerts,
  shiftInitials,
  shiftNeedsRiskAck,
  taskFeedSummary,
  timerAnchorIso,
} from "@/lib/shift-utils";
import { markTaskNa, type NaReason } from "@/lib/shift-validation";
import { unlockPageInteraction } from "@/lib/unlock-page-interaction";
import { useIsMobile } from "@/hooks/use-mobile";
import { WorkerMobileShiftView } from "@/components/worker-mobile/WorkerMobileShiftView";
import { markNotesIncidentFiled } from "@/lib/session-incident-reports";
import { evaluateWorkerCompliance } from "@/lib/worker-compliance-engine";
import { useGoalLinkedTaskComplianceNotes } from "@/hooks/useGoalLinkedTaskComplianceNotes";

type Props = { id: string };

const TUTORIAL_DEMO_TASKS: ShiftTask[] = [
  {
    task_id: "tutorial-task-1",
    type: "default",
    label: "Personal Hygiene / Showering",
    description: "Assist with bathing, grooming, oral care, or personal hygiene routine.",
    completed: false,
    mandatory: true,
    order: 1,
    goal_id: "daily_living_skills",
    goal_title: "Develop Daily Living Skills",
  },
  {
    task_id: "tutorial-task-2",
    type: "default",
    label: "Meal Preparation",
    description: "Prepare meals, snacks, and support hydration throughout the shift.",
    completed: false,
    mandatory: true,
    order: 2,
    goal_id: "daily_living_skills",
    goal_title: "Develop Daily Living Skills",
  },
  {
    task_id: "tutorial-task-3",
    type: "default",
    label: "Medication Administration",
    description: "Assist with medication as per the Medication Administration Record.",
    completed: false,
    mandatory: true,
    order: 3,
    goal_id: "health_wellbeing",
    goal_title: "Health & Wellbeing",
  },
  {
    task_id: "tutorial-task-4",
    type: "default",
    label: "Health & Wellness Check",
    description: "Check vitals, mood, and general wellbeing.",
    completed: false,
    mandatory: false,
    order: 4,
    goal_id: "health_wellbeing",
    goal_title: "Health & Wellbeing",
  },
  {
    task_id: "tutorial-task-5",
    type: "default",
    label: "Community Access",
    description: "Outings, social, activities",
    completed: false,
    mandatory: false,
    order: 5,
    goal_id: "community_participation",
    goal_title: "Community Participation",
  },
  {
    task_id: "tutorial-task-6",
    type: "default",
    label: "Documentation / Notes",
    description: "Record progress notes, incidents, and participant communication.",
    completed: false,
    mandatory: true,
    order: 6,
    goal_id: "documentation_reporting",
    goal_title: "Documentation & Reporting",
  },
];

const TUTORIAL_DEMO_HEALTH_ALERTS: ShiftHealthAlert[] = [
  {
    type: "allergy",
    severity: "critical",
    title: "Peanut allergy",
    description: "Avoid all nut products. EpiPen in kitchen drawer.",
    instructions: "Check all meals and snacks before serving.",
  },
  {
    type: "falls_risk",
    severity: "critical",
    title: "Falls risk",
    description: "Stand-by assist required on stairs and in wet areas.",
    instructions: "Stay within arm's reach during transfers.",
  },
];

const TUTORIAL_VALIDATION_TASKS: ShiftTask[] = [
  {
    task_id: "tutorial-task-1",
    type: "default",
    label: "Personal hygiene / showering",
    completed: true,
    mandatory: true,
    order: 1,
    goal_title: "Develop daily living skills",
    has_photo: true,
    evidence_status: "with_evidence",
  },
];

const SERVICE_TAG_STYLES: Record<string, string> = {
  CORE: "bg-blue-50 text-blue-700 border-blue-200",
  "CAPACITY BUILDING": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function resolveDisplayVisualState(
  shift: WorkerShift,
  instantSessionActive: boolean,
  tutorialDemoClockedIn = false,
): ShiftVisualState {
  if (tutorialDemoClockedIn && shift.visual_state === "scheduled") {
    if (instantSessionActive) return "session_active";
    return "clocked_in";
  }
  if (instantSessionActive && shift.visual_state === "clocked_in") {
    return "session_active";
  }
  return shift.visual_state;
}

export default function MyShiftDetail({ id: idProp }: Props) {
  const params = useParams<{ id: string }>();
  const id = (idProp || params.id || "").trim();
  const { user } = useAuth();
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const tutorial = useWorkerTutorialOptional();
  const isTutorialDemo = tutorial?.isTutorialMode ?? false;
  const isMobile = useIsMobile();
  const orgId = user?.organizationId ?? "__no_org__";
  const [briefingOpen, setBriefingOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [duringShiftOpen, setDuringShiftOpen] = useState(false);
  const [incidentFormOpen, setIncidentFormOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(true);
  const [preferencesOpen, setPreferencesOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(true);
  const [offlineContext, setOfflineContext] = useState<CachedParticipantContext | null>(null);
  const [supportOpen, setSupportOpen] = useState(true);
  const [locationOpen, setLocationOpen] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ShiftTask[]>([]);
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [clockOutOpen, setClockOutOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [mandatoryAlertOpen, setMandatoryAlertOpen] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [forceEndPending, setForceEndPending] = useState(false);
  const [ackConfirmOpen, setAckConfirmOpen] = useState(false);
  const [tutorialDemoClockedIn, setTutorialDemoClockedIn] = useState(false);
  const [tutorialClockInAt, setTutorialClockInAt] = useState<string | null>(null);
  const [tutorialSessionStartedAt, setTutorialSessionStartedAt] = useState<string | null>(null);
  const [clockInFlowOpen, setClockInFlowOpen] = useState(false);
  const [mobileSubmitDone, setMobileSubmitDone] = useState(false);
  const [pendingClockInCount, setPendingClockInCount] = useState(0);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const mileageDraftRef = useRef<MileageDraftState>({
    claimedKm: null,
    calculatedKm: null,
    isOverridden: false,
  });

  const openSafetyPage = (scroll = false) => {
    setSafetyOpen(true);
    if (scroll) {
      requestAnimationFrame(() => {
        document.getElementById("tutorial-risk-ack-checkbox")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    }
  };

  const { data: shift, isLoading, error, refetch } = useOrgQuery(
    ["worker", "shift", id],
    { queryFn: () => getWorkerShift(id), enabled: Boolean(id) },
  );

  const {
    instantSessionActive,
    setInstantSessionActive,
    startSession,
    syncing,
    pendingCount,
    invalidate,
    applyShiftToCache,
  } = useShiftSessionActions({
    shiftId: id,
    orgId,
    shift,
    onTasksUpdated: (nextTasks) => setTasks(nextTasks ?? []),
    onSessionStarted: () => undefined,
  });

  const {
    online: evidenceOnline,
    snapshot: evidenceSync,
    retrySync: retryEvidenceSync,
    showBanner: showEvidenceBanner,
  } = useEvidenceSync(shift?.session_id);

  useEffect(() => {
    if (shift?.risks_acknowledged) setAckChecked(true);
    if (shift?.tasks?.length) setTasks(shift.tasks);
  }, [shift?.risks_acknowledged, shift?.tasks]);

  useEffect(() => {
    if (id) void recordShiftViewed(id).catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (!shift) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("focus") === "safety" || shiftNeedsRiskAck(shift)) {
      setSafetyOpen(true);
    }
  }, [shift]);

  useEffect(() => {
    if (!shift?.participant_id) return;
    const syncedAt = shift.context_synced_at || new Date().toISOString();
    if (shift.profile || shift.preferences || shift.context) {
      void cacheParticipantContext({
        participantId: shift.participant_id,
        profile: shift.profile,
        preferences: shift.preferences,
        context: shift.context,
        syncedAt,
      });
    }
  }, [shift?.participant_id, shift?.profile, shift?.preferences, shift?.context, shift?.context_synced_at]);

  useEffect(() => {
    if (!shift?.participant_id) return;
    const hydrate = () => {
      void loadCachedParticipantContext(shift.participant_id!).then(setOfflineContext);
    };
    if (!navigator.onLine) hydrate();
    window.addEventListener("offline", hydrate);
    return () => window.removeEventListener("offline", hydrate);
  }, [shift?.participant_id]);

  useEffect(() => {
    const visualState = shift?.visual_state;

    if (validationOpen || signatureOpen) {
      return;
    }

    if (visualState === "session_active") {
      setInstantSessionActive((active) => (active ? false : active));
      clearPendingStartSession(id);
    }
  }, [
    shift?.visual_state,
    id,
    validationOpen,
    signatureOpen,
  ]);

  useEffect(() => {
    if (!mandatoryAlertOpen || !shift) return;
    const active = resolveActiveShiftTasks(shift.tasks, tasks);
    if (!hasIncompleteMandatoryTasks(active)) {
      setMandatoryAlertOpen(false);
    }
  }, [tasks, shift, mandatoryAlertOpen]);

  const refreshPendingClockIn = async () => {
    const pending = await getPendingClockIn(id);
    setPendingClockInCount(pending ? 1 : 0);
  };

  const refreshOfflinePendingCount = async () => {
    const actions = await listPendingActions();
    const forShift = actions.filter((action) => action.shiftId === id);
    setPendingClockInCount(forShift.some((action) => action.type === "clock_in") ? 1 : 0);
  };

  const applyClockInResult = async (updated: WorkerShift) => {
    if (!shift) return;
    setTasks(updated.tasks ?? []);
    if (shift.participant_id && (updated.profile || updated.context)) {
      void cacheParticipantContext({
        participantId: shift.participant_id,
        profile: updated.profile ?? shift.profile,
        preferences: updated.preferences ?? shift.preferences,
        context: updated.context ?? shift.context,
        syncedAt: updated.context_synced_at || new Date().toISOString(),
      });
    }
    invalidateShifts();
    applyShiftToCache(updated);
    await refetch();
  };

  const performVerifiedClockIn = async (payload: ClockInRequest) => {
    if (!shift) return;
    const mileage = mileageDraftRef.current;
    const clockInPayload: ClockInRequest = { ...payload };
    if (mileage.claimedKm != null && mileage.claimedKm > 0) {
      clockInPayload.claimed_km = mileage.claimedKm;
    }
    if (isTutorialDemo) {
      const at = clockInPayload.client_timestamp || new Date().toISOString();
      setTutorialClockInAt(at);
      setTutorialDemoClockedIn(true);
      setClockInFlowOpen(false);
      toast({
        title: translate("toast.tutorialCheckIn"),
        description: translate("toast.tutorialCheckInDesc"),
      });
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueClockIn({
        shiftId: shift.id,
        method: payload.method,
        clientTimestamp: payload.client_timestamp || new Date().toISOString(),
        location: payload.location ?? null,
        qrToken: payload.qr_token ?? null,
        claimedKm: clockInPayload.claimed_km ?? null,
      });
      await refreshPendingClockIn();
      setClockInFlowOpen(false);
      toast({
        title: "Offline check-in saved",
        description: "Your check-in will sync when you are back online.",
      });
      return;
    }
    try {
      const updated = await clockInShift(shift.id, clockInPayload);
      await applyClockInResult(updated);
      setClockInFlowOpen(false);
      toast({
        title: "Clocked in!",
        description: `Verified arrival for ${shift.participant_name ?? "participant"}.`,
      });
    } catch (err) {
      const apiErr = err as Error & { status?: number };
      const status = apiErr.status;
      const isRejection =
        status === 422 ||
        status === 403 ||
        status === 404 ||
        (status !== undefined && status >= 400 && status < 500);

      if (isRejection) {
        toast({
          title: "Check-in not allowed",
          description: apiErr.message || "This check-in could not be verified.",
          variant: "destructive",
        });
        return;
      }

      await enqueueClockIn({
        shiftId: shift.id,
        method: payload.method,
        clientTimestamp: payload.client_timestamp || new Date().toISOString(),
        location: payload.location ?? null,
        qrToken: payload.qr_token ?? null,
        claimedKm: clockInPayload.claimed_km ?? null,
      });
      await refreshPendingClockIn();
      setClockInFlowOpen(false);
      toast({
        title: "Check-in saved locally",
        description: apiErr.message || "Will retry when connection improves.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    void refreshPendingClockIn();
  }, [id]);

  useEffect(() => {
    if (clockInFlowOpen) return;

    const runOfflineSync = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await refreshOfflinePendingCount();
        return;
      }
      setOfflineSyncing(true);
      try {
        const result = await syncAllQueuedShiftActions();
        if (result.synced > 0) {
          invalidate();
          await refetch();
          toast({
            title: "Pending actions synced",
            description:
              result.synced === 1
                ? "1 queued action uploaded."
                : `${result.synced} queued actions uploaded.`,
          });
        }
      } finally {
        setOfflineSyncing(false);
        await refreshPendingClockIn();
        await refreshOfflinePendingCount();
      }
    };

    void runOfflineSync();
    const onOnline = () => void runOfflineSync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [id, clockInFlowOpen, invalidate, refetch, toast]);

  const effectiveClockedInAt = shift?.clocked_in_at ?? tutorialClockInAt;
  const effectiveSessionStartedAt = shift?.session_started_at ?? tutorialSessionStartedAt;

  const displayVisualState = shift
    ? resolveDisplayVisualState(shift, instantSessionActive, tutorialDemoClockedIn)
    : "scheduled";
  const timerActive =
    displayVisualState === "clocked_in" || displayVisualState === "session_active";
  const timerAnchor = shift
    ? timerAnchorIso(displayVisualState, effectiveSessionStartedAt, effectiveClockedInAt)
    : null;
  const { elapsed } = useShiftTimer(shift?.session_id, {
    serverStartIso: timerAnchor,
    active: timerActive,
  });

  const breakSessionId =
    isTutorialDemo && displayVisualState === "session_active"
      ? TUTORIAL_SESSION_ID
      : shift?.session_id ?? null;
  const longShiftBreak = useLongShiftBreak(
    displayVisualState === "session_active" ? breakSessionId : null,
    {
      shiftId: shift?.id,
      initialStatus: shift?.break_status,
    },
  );

  const invalidateShifts = () => {
    invalidate();
  };

  const handleAcknowledge = async () => {
    if (!shift) return;
    setBusy("ack");
    try {
      await acknowledgeShiftRisks(shift.id);
      setAckChecked(true);
      setAckConfirmOpen(false);
      setSafetyOpen(false);
      invalidateShifts();
      await refetch();
      if (isTutorialDemo) {
        toast({
          title: translate("toast.tutorialRiskAck"),
          description: translate("toast.tutorialRiskAckDesc"),
        });
      }
    } catch (err) {
      if (isTutorialDemo) {
        setAckChecked(true);
        setAckConfirmOpen(false);
        toast({
          title: translate("toast.tutorialRiskAck"),
          description: translate("toast.tutorialRiskAckDesc"),
        });
      } else {
        setAckChecked(false);
        toast({
          title: "Could not acknowledge risks",
          description: (err as Error).message || "Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const handleClockIn = () => {
    if (!shift) return;
    if (shift.requires_safety_ack) {
      toast({
        title: "Safety card required",
        description: "Please acknowledge the safety card before clocking in.",
        variant: "destructive",
      });
      return;
    }
    if (shiftNeedsRiskAck(shift) && !ackChecked) {
      setSafetyOpen(true);
      toast({
        title: "Acknowledge safety alerts first",
        description: "Review and acknowledge participant risks before clocking in.",
        variant: "destructive",
      });
      return;
    }
    if (
      isTutorialDemo
      && displayVisualState === "scheduled"
      && !shift.risks_acknowledged
      && !ackChecked
    ) {
      setSafetyOpen(true);
      toast({
        title: "Acknowledge safety alerts first",
        description: "Review and acknowledge participant risks before clocking in.",
        variant: "destructive",
      });
      return;
    }
    setClockInFlowOpen(true);
  };

  const handleVerifiedClockIn = async (payload: ClockInRequest) => {
    if (!shift) return;
    setBusy("clock");
    try {
      await performVerifiedClockIn(payload);
    } finally {
      setBusy(null);
    }
  };

  const handleStartSession = async () => {
    if (!shift || busy !== null) return;
    if (shiftNeedsRiskAck(shift)) {
      setSafetyOpen(true);
      toast({
        title: "Acknowledge safety alerts first",
        description: "Review and acknowledge participant risks before starting a session.",
        variant: "destructive",
      });
      return;
    }
    if (isTutorialDemo && tutorialDemoClockedIn) {
      setBusy("start");
      try {
        setTutorialSessionStartedAt(new Date().toISOString());
        setInstantSessionActive(true);
        toast({
          title: translate("toast.tutorialSession"),
          description: translate("toast.tutorialSessionDesc"),
        });
      } finally {
        setBusy(null);
      }
      return;
    }
    setBusy("start");
    try {
      await startSession();
    } finally {
      setBusy(null);
    }
  };

  const handleClockOut = async () => {
    if (!shift) return;
    setBusy("clockout");
    try {
      await clockOutShift(shift.id);
      setClockOutOpen(false);
      invalidateShifts();
      await refetch();
      toast({
        title: "Clocked out",
        description: "You left without starting a session.",
      });
    } catch (err) {
      toast({
        title: "Could not clock out",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleEndShift = async () => {
    if (!shift) return;
    if (isTutorialDemo) {
      setEndShiftOpen(false);
      setValidationOpen(false);
      setSignatureOpen(false);
      setMandatoryAlertOpen(false);
      setForceEndPending(false);
      tutorial?.setFlowModalBlocking(false);
      toast({
        title: translate("toast.tutorialShiftEnd"),
        description: translate("toast.tutorialShiftEndDesc"),
      });
      return;
    }
    setBusy("end");
    try {
      const updated = await endShift(shift.id, { force: forceEndPending });
      setTasks(updated.tasks ?? []);
      setInstantSessionActive(false);
      setEndShiftOpen(false);
      setValidationOpen(false);
      setSignatureOpen(false);
      setMandatoryAlertOpen(false);
      setForceEndPending(false);
      invalidateShifts();
      await refetch();
      if (isMobile) setMobileSubmitDone(true);
      toast({
        title: "Shift ended",
        description: `Documentation locked for ${shift.participant_name ?? "participant"}.`,
      });
    } catch (err) {
      toast({
        title: "Could not end shift",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleAttemptEndShift = () => {
    if (!shift) return;
    setForceEndPending(false);

    if (isTutorialDemo) {
      setMandatoryAlertOpen(false);
      setValidationOpen(true);
      tutorial?.setFlowModalBlocking(true);
      if (tutorial?.activeStep?.key === "end_shift") {
        void tutorial.nextStep();
      }
      return;
    }

    const activeTasks = resolveActiveShiftTasks(shift.tasks, tasks);
    if (hasIncompleteMandatoryTasks(activeTasks)) {
      setValidationOpen(false);
      setMandatoryAlertOpen(true);
      return;
    }
    setMandatoryAlertOpen(false);
    setValidationOpen(true);
  };

  const handleValidationAddEvidence = (taskId: string) => {
    setValidationOpen(false);
    setFocusTaskId(taskId);
    setTasksOpen(true);
    requestAnimationFrame(() => {
      document.getElementById("shift-task-checklist")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleMarkTaskNa = async (taskId: string, reason: NaReason) => {
    if (!shift) return;
    const now = new Date().toISOString();
    const activeTasks = resolveActiveShiftTasks(shift.tasks, tasks);
    const next = activeTasks.map((task) =>
      task.task_id === taskId ? markTaskNa(task, reason, now) : task,
    );
    setTasks(next);
    try {
      await updateShiftTasks(shift.id, next);
      toast({ title: "Task marked N/A", description: "Reason recorded for coordinators." });
    } catch (err) {
      toast({
        title: "Could not update task",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const handleValidationEndAnyway = () => {
    setValidationOpen(false);
    setForceEndPending(true);
    setSignatureOpen(true);
    if (isTutorialDemo) {
      tutorial?.setFlowModalBlocking(true);
      if (tutorial?.activeStep?.key === "end_shift_review") {
        void tutorial.nextStep();
      }
    }
  };

  const handleValidationOpenChange = (open: boolean) => {
    if (
      !open
      && isTutorialDemo
      && (tutorial?.activeStep?.key === "end_shift_review"
        || tutorial?.activeStep?.key === "shift_signature")
    ) {
      return;
    }
    setValidationOpen(open);
  };

  const handleSignatureOpenChange = (open: boolean) => {
    if (!open && isTutorialDemo && tutorial?.activeStep?.key === "shift_signature") {
      return;
    }
    setSignatureOpen(open);
  };

  const handleValidationEndShift = () => {
    setValidationOpen(false);
    setForceEndPending(false);
    setSignatureOpen(true);
    if (isTutorialDemo) {
      tutorial?.setFlowModalBlocking(true);
      if (tutorial?.activeStep?.key === "end_shift_review") {
        void tutorial.nextStep();
      }
    }
  };

  const handleBackToMandatoryTasks = () => {
    if (!shift) return;
    const activeTasks = resolveActiveShiftTasks(shift.tasks, tasks);
    const incomplete = incompleteMandatoryTasks(activeTasks);
    setMandatoryAlertOpen(false);
    setTasksOpen(true);
    if (incomplete[0]?.task_id) setFocusTaskId(incomplete[0].task_id);
    requestAnimationFrame(() => {
      document.getElementById("shift-task-checklist")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleEndAnywayFromMandatory = () => {
    setMandatoryAlertOpen(false);
    setForceEndPending(true);
    setSignatureOpen(true);
  };

  const handleSignatureComplete = async () => {
    await handleEndShift();
  };

  if (!id) {
    return (
      <div className="space-y-4 py-8">
        <p className="text-sm font-bold text-red-600">Invalid shift link.</p>
        <Link href="/my-shifts">
          <Button variant="outline" className="rounded-full">Back to My Shifts</Button>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm font-bold" style={{ color: MUTED }}>
        <Loader2 className="h-4 w-4 animate-spin" /> Loading shift details…
      </div>
    );
  }

  if (error || !shift) {
    return (
      <div className="space-y-4 py-8">
        <p className="text-sm font-bold text-red-600">{(error as Error)?.message || "Shift not found"}</p>
        <Link href="/my-shifts">
          <Button variant="outline" className="rounded-full">Back to My Shifts</Button>
        </Link>
      </div>
    );
  }

  const isSessionActive = displayVisualState === "session_active";
  const baseProfile = shift.profile ?? offlineContext?.profile;
  const displayProfile: ParticipantProfile = {
    ...baseProfile,
    preferred_name: baseProfile?.preferred_name ?? shift.participant_name,
    date_of_birth: baseProfile?.date_of_birth ?? shift.participant_dob ?? undefined,
    phone: baseProfile?.phone ?? shift.participant_phone ?? undefined,
  };
  const basePreferences = shift.preferences ?? offlineContext?.preferences;
  const displayPreferences: ParticipantPreferences = {
    ...basePreferences,
    routines: basePreferences?.routines ?? shift.visit_notes ?? undefined,
    health_flags: basePreferences?.health_flags ?? shift.health_flags ?? undefined,
    likes_dislikes: basePreferences?.likes_dislikes ?? shift.allergies ?? undefined,
  };
  const baseContext = shift.context ?? offlineContext?.context;
  const displayContext: ParticipantContext = {
    ...baseContext,
    medical: {
      ...baseContext?.medical,
      alerts: baseContext?.medical?.alerts ?? shift.allergies ?? undefined,
    },
  };
  const contextSyncedAt = shift.context_synced_at ?? offlineContext?.syncedAt ?? null;
  const participantFirstName = (displayProfile?.preferred_name || shift.participant_name || "").split(" ")[0];
  const activeTasksForValidation = resolveActiveShiftTasks(shift.tasks, tasks);
  const validationTasks =
    isTutorialDemo && validationOpen
      ? TUTORIAL_VALIDATION_TASKS
      : activeTasksForValidation;
  const incompleteMandatory = incompleteMandatoryTasks(activeTasksForValidation);
  const liveSessionId =
    isTutorialDemo && isSessionActive ? TUTORIAL_SESSION_ID : shift.session_id;
  const openIncidentReport = () => {
    unlockPageInteraction();
    setDuringShiftOpen(true);
    setIncidentFormOpen(true);
    requestAnimationFrame(() => {
      document.getElementById("shift-during-actions")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const workflow = (
    <ShiftWorkflow
      shift={shift}
      displayProfile={displayProfile}
      displayPreferences={displayPreferences}
      displayContext={displayContext}
      contextSyncedAt={contextSyncedAt}
      participantFirstName={participantFirstName}
      visualState={displayVisualState}
      tasks={tasks}
      setTasks={setTasks}
      elapsed={elapsed}
      briefingOpen={briefingOpen}
      setBriefingOpen={setBriefingOpen}
      tasksOpen={tasksOpen}
      setTasksOpen={setTasksOpen}
      duringShiftOpen={duringShiftOpen}
      setDuringShiftOpen={setDuringShiftOpen}
      incidentFormOpen={incidentFormOpen}
      setIncidentFormOpen={setIncidentFormOpen}
      onOpenIncidentReport={openIncidentReport}
      timelineOpen={timelineOpen}
      setTimelineOpen={setTimelineOpen}
      safetyOpen={safetyOpen}
      setSafetyOpen={setSafetyOpen}
      profileOpen={profileOpen}
      setProfileOpen={setProfileOpen}
      preferencesOpen={preferencesOpen}
      setPreferencesOpen={setPreferencesOpen}
      contextOpen={contextOpen}
      setContextOpen={setContextOpen}
      supportOpen={supportOpen}
      setSupportOpen={setSupportOpen}
      locationOpen={locationOpen}
      setLocationOpen={setLocationOpen}
      ackChecked={ackChecked}
      setAckChecked={setAckChecked}
      busy={busy}
      onRequestAcknowledge={() => setAckConfirmOpen(true)}
      onViewSupportInstructions={() => {
        setSupportOpen(true);
        requestAnimationFrame(() => {
          document.getElementById("shift-support-instructions")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }}
      onClockIn={handleClockIn}
      onStartSession={handleStartSession}
      onRequestClockOut={() => setClockOutOpen(true)}
      onAttemptEndShift={handleAttemptEndShift}
      focusTaskId={focusTaskId}
      mandatoryAlertOpen={mandatoryAlertOpen}
      incompleteMandatory={incompleteMandatory}
      onBackToMandatoryTasks={handleBackToMandatoryTasks}
      onEndAnywayFromMandatory={handleEndAnywayFromMandatory}
      isTutorialDemo={isTutorialDemo}
      sessionFocus={isSessionActive}
      mileageDraftRef={mileageDraftRef}
      clockedInAt={effectiveClockedInAt}
      longShiftBreak={longShiftBreak}
    />
  );

  const dialogs = (
    <>
      <RiskAcknowledgementLoadingOverlay open={busy === "ack"} />

      {shift && !isMobile && (
        <ShiftSignatureModal
          open={signatureOpen}
          onOpenChange={handleSignatureOpenChange}
          shiftId={shift.id}
          busy={busy === "end"}
          tutorialDemo={isTutorialDemo}
          onSigned={handleSignatureComplete}
        />
      )}

      {shift && (
        <EndShiftValidationModal
          open={validationOpen}
          onOpenChange={handleValidationOpenChange}
          tasks={validationTasks}
          sessionId={liveSessionId ?? shift.session_id}
          participantFirstName={participantFirstName}
          busy={busy === "end"}
          tutorialDemo={isTutorialDemo}
          onCancel={() => handleValidationOpenChange(false)}
          onAddEvidence={handleValidationAddEvidence}
          onMarkNa={(taskId, reason) => void handleMarkTaskNa(taskId, reason)}
          onEndAnyway={handleValidationEndAnyway}
          onEndShift={handleValidationEndShift}
        />
      )}

      {shift && (
        <ClockInFlow
          open={clockInFlowOpen}
          shift={shift}
          busy={busy === "clock"}
          tutorialDemo={isTutorialDemo}
          onClose={() => setClockInFlowOpen(false)}
          onConfirm={handleVerifiedClockIn}
        />
      )}

      <AlertDialog open={clockOutOpen} onOpenChange={setClockOutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clock out without session?</AlertDialogTitle>
            <AlertDialogDescription>
              You will leave this shift without documenting a session. Use this only if you could not provide support.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleClockOut()} disabled={busy === "clockout"}>
              Clock Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={endShiftOpen} onOpenChange={(open) => {
        setEndShiftOpen(open);
        if (!open) setForceEndPending(false);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {forceEndPending ? "End shift with incomplete tasks?" : "End shift?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {forceEndPending
                ? "Mandatory tasks are not complete. Ending now will flag this shift in your compliance report."
                : "This completes the shift and locks documentation. You will not be able to edit notes after this."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#BE185D] hover:bg-[#d92854]"
              onClick={(event) => {
                event.preventDefault();
                setEndShiftOpen(false);
                setSignatureOpen(true);
              }}
              disabled={busy === "end"}
            >
              {forceEndPending ? "Continue to signature" : "Sign and end shift"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={ackConfirmOpen}
        onOpenChange={(open) => {
          if (!open && busy === "ack") return;
          setAckConfirmOpen(open);
          if (!open && !shift?.risks_acknowledged) setAckChecked(false);
        }}
      >
        <AlertDialogContent data-tutorial="risk-ack-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Acknowledge safety alerts?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm you have read and understand all safety alerts for {shift?.participant_name ?? "this participant"}.
              This will be logged with your name and timestamp.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "ack"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="gap-2"
              onClick={(event) => {
                event.preventDefault();
                void handleAcknowledge();
              }}
              disabled={busy === "ack"}
            >
              {busy === "ack" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {translate("shift.acknowledgeSaving")}
                </>
              ) : (
                translate("shift.acknowledgeRisks")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  const handleMobileAutoStartSession = async () => {
    if (busy !== null) return;
    setBusy("start");
    try {
      await startSession();
    } finally {
      setBusy(null);
    }
  };

  if (isMobile && shift) {
    return (
      <>
        <WorkerMobileShiftView
          shift={shift}
          visualState={displayVisualState}
          tasks={tasks}
          setTasks={setTasks}
          elapsed={elapsed}
          clockedInAt={effectiveClockedInAt}
          sessionId={liveSessionId ?? shift.session_id ?? null}
          busy={busy}
          participantFirstName={participantFirstName}
          onClockIn={handleClockIn}
          onAutoStartSession={handleMobileAutoStartSession}
          onShiftComplete={handleEndShift}
          ackChecked={ackChecked}
          setAckChecked={setAckChecked}
          onRequestAcknowledge={() => setAckConfirmOpen(true)}
          safetyOpen={safetyOpen}
          setSafetyOpen={setSafetyOpen}
          isTutorialDemo={isTutorialDemo}
          longShiftBreak={longShiftBreak}
          submissionComplete={mobileSubmitDone}
          mileageDraftRef={mileageDraftRef}
        />
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div className="space-y-4 pb-10" data-tutorial="shift-workspace">
        <OfflineSyncBanner syncing={syncing || offlineSyncing} pendingCount={pendingCount + pendingClockInCount} className="-mx-4 rounded-none sm:mx-0 sm:rounded-xl" />
        {showEvidenceBanner && (
          <EvidenceSyncBanner
            online={evidenceOnline}
            snapshot={evidenceSync}
            onRetry={() => void retryEvidenceSync()}
            className="-mx-4 rounded-none sm:mx-0 sm:rounded-xl"
          />
        )}
        <Link href="/my-shifts">
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-bold transition hover:opacity-80"
            style={{ color: PLUM }}
          >
            <ArrowLeft size={18} /> My Shifts
          </button>
        </Link>
        <ShiftStageBanner
          visualState={displayVisualState}
          participantName={shift.participant_name}
          elapsed={elapsed}
          onBreak={longShiftBreak.onBreak}
          breakElapsed={longShiftBreak.breakElapsed}
          onEndShift={isSessionActive ? handleAttemptEndShift : undefined}
          endShiftBusy={busy === "end"}
        />
        {workflow}
      </div>
      {dialogs}
    </>
  );
}

function ShiftWorkflow({
  shift,
  displayProfile,
  displayPreferences,
  displayContext,
  contextSyncedAt,
  participantFirstName,
  visualState,
  tasks,
  setTasks,
  elapsed,
  briefingOpen,
  setBriefingOpen,
  tasksOpen,
  setTasksOpen,
  duringShiftOpen,
  setDuringShiftOpen,
  incidentFormOpen,
  setIncidentFormOpen,
  onOpenIncidentReport,
  timelineOpen,
  setTimelineOpen,
  safetyOpen,
  setSafetyOpen,
  profileOpen,
  setProfileOpen,
  preferencesOpen,
  setPreferencesOpen,
  contextOpen,
  setContextOpen,
  supportOpen,
  setSupportOpen,
  locationOpen,
  setLocationOpen,
  ackChecked,
  setAckChecked,
  busy,
  onRequestAcknowledge,
  onViewSupportInstructions,
  onClockIn,
  onStartSession,
  onRequestClockOut,
  onAttemptEndShift,
  focusTaskId,
  mandatoryAlertOpen,
  incompleteMandatory,
  onBackToMandatoryTasks,
  onEndAnywayFromMandatory,
  isTutorialDemo = false,
  sessionFocus = false,
  mileageDraftRef,
  clockedInAt = null,
  longShiftBreak,
}: {
  shift: WorkerShift;
  displayProfile?: ParticipantProfile;
  displayPreferences?: ParticipantPreferences;
  displayContext?: ParticipantContext;
  contextSyncedAt?: string | null;
  participantFirstName?: string;
  visualState: ShiftVisualState;
  tasks: ShiftTask[];
  setTasks: (tasks: ShiftTask[]) => void;
  elapsed: string;
  briefingOpen: boolean;
  setBriefingOpen: (v: boolean) => void;
  tasksOpen: boolean;
  setTasksOpen: (v: boolean) => void;
  duringShiftOpen: boolean;
  setDuringShiftOpen: (v: boolean) => void;
  incidentFormOpen: boolean;
  setIncidentFormOpen: (v: boolean) => void;
  onOpenIncidentReport: () => void;
  timelineOpen: boolean;
  setTimelineOpen: (v: boolean) => void;
  safetyOpen: boolean;
  setSafetyOpen: (v: boolean) => void;
  profileOpen: boolean;
  setProfileOpen: (v: boolean) => void;
  preferencesOpen: boolean;
  setPreferencesOpen: (v: boolean) => void;
  contextOpen: boolean;
  setContextOpen: (v: boolean) => void;
  supportOpen: boolean;
  setSupportOpen: (v: boolean) => void;
  locationOpen: boolean;
  setLocationOpen: (v: boolean) => void;
  ackChecked: boolean;
  setAckChecked: (v: boolean) => void;
  busy: string | null;
  onRequestAcknowledge: () => void;
  onViewSupportInstructions: () => void;
  onClockIn: () => void;
  onStartSession: () => void;
  onRequestClockOut: () => void;
  onAttemptEndShift: () => void;
  focusTaskId?: string | null;
  mandatoryAlertOpen: boolean;
  incompleteMandatory: ShiftTask[];
  onBackToMandatoryTasks: () => void;
  onEndAnywayFromMandatory: () => void;
  isTutorialDemo?: boolean;
  sessionFocus?: boolean;
  mileageDraftRef: MutableRefObject<MileageDraftState>;
  clockedInAt?: string | null;
  longShiftBreak?: ReturnType<typeof useLongShiftBreak>;
}) {
  const { translate } = useAccessibility();
  const tutorial = useWorkerTutorialOptional();
  const state = STATE_STYLES[visualState] ?? STATE_STYLES.scheduled;
  const duration = shiftDurationMinutes(shift.scheduled_start, shift.scheduled_end, shift.duration_minutes);
  const durationLabel = formatDurationLabel(duration);
  const hasAlerts = shiftHasRiskAlerts(shift);
  const risksAcked = shift.risks_acknowledged ?? false;
  const needsRiskAck = shiftNeedsRiskAck(shift);
  const effectiveRiskAcked = risksAcked || (Boolean(isTutorialDemo) && ackChecked);
  const isSessionActive = visualState === "session_active";
  const isClockedIn = visualState === "clocked_in";
  const isCompleted = visualState === "completed";
  const onRiskAckTutorialStep =
    tutorial?.activeStep?.key === "risk_acknowledgement"
    || tutorial?.activeStep?.key === "risk_acknowledgement_modal";
  const tutorialPendingRiskAck =
    Boolean(isTutorialDemo)
    && onRiskAckTutorialStep
    && visualState === "scheduled"
    && !effectiveRiskAcked;
  const showRiskAckPending = !isCompleted && !effectiveRiskAcked && (needsRiskAck || tutorialPendingRiskAck);
  const riskAckAlerts =
    shift.health_alerts?.length
      ? shift.health_alerts
      : (isTutorialDemo ? TUTORIAL_DEMO_HEALTH_ALERTS : []);
  const showRiskAcknowledged =
    !isCompleted && effectiveRiskAcked && (hasAlerts || isTutorialDemo);
  const showTasks =
    visualState === "clocked_in" ||
    visualState === "session_active";
  const serviceTag = (shift.service_category || "CORE").toUpperCase();
  const tagStyle = SERVICE_TAG_STYLES[serviceTag] ?? SERVICE_TAG_STYLES.CORE;
  const entryNote = shift.entry_instructions || shift.access_instructions;
  const pulseAvatar = avatarShouldPulse(visualState);

  useEffect(() => {
    const stepKey = tutorial?.activeStep?.key;
    if (stepKey === "task_evidence" || stepKey === "evidence_attach") {
      setTasksOpen(true);
    }
    if (stepKey === "risk_acknowledgement" || stepKey === "risk_acknowledgement_modal") {
      setSafetyOpen(true);
      if (stepKey === "risk_acknowledgement") {
        requestAnimationFrame(() => {
          document.getElementById("tutorial-risk-ack-checkbox")?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        });
      }
    }
  }, [tutorial?.activeStep?.key, setTasksOpen, setSafetyOpen]);

  useEffect(() => {
    if (sessionFocus && isSessionActive) {
      setTasksOpen(true);
      setTimelineOpen(true);
    }
  }, [sessionFocus, isSessionActive, setTasksOpen, setTimelineOpen]);

  const resolvedTasks = resolveActiveShiftTasks(shift.tasks, tasks);
  const activeTasks =
    isTutorialDemo && showTasks && resolvedTasks.length === 0 ? TUTORIAL_DEMO_TASKS : resolvedTasks;
  const feedSummary = taskFeedSummary(activeTasks);
  const checklistSessionId =
    isTutorialDemo && isSessionActive ? TUTORIAL_SESSION_ID : shift.session_id;

  const [checkinPromptOpen, setCheckinPromptOpen] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const longShiftCheckin = useLongShiftCheckin(
    isSessionActive ? checklistSessionId : null,
    {
      shiftId: shift.id,
      initialStatus: shift.checkin_status,
      onBreak: longShiftBreak?.onBreak,
    },
  );

  useEffect(() => {
    if (!isSessionActive || !checklistSessionId) return;
    if (longShiftCheckin.checkinOverdue && longShiftCheckin.canSubmitRoutine) {
      setCheckinPromptOpen(true);
    }
  }, [isSessionActive, checklistSessionId, longShiftCheckin.checkinOverdue, longShiftCheckin.canSubmitRoutine]);

  useEffect(() => {
    if (!checklistSessionId || !isSessionActive) return;
    const onOffline = () => {
      void markSessionOffline(checklistSessionId);
    };
    const onOnline = () => {
      void markSessionHeartbeat(checklistSessionId);
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [checklistSessionId, isSessionActive]);

  const handlePromptCheckin = async (status: CheckinStatus) => {
    if (!checklistSessionId) return;
    setCheckinBusy(true);
    try {
      await submitLongShiftCheckin(checklistSessionId, {
        status,
        prompt_triggered_at: new Date().toISOString(),
      });
      setCheckinPromptOpen(false);
      await longShiftCheckin.refresh();
    } finally {
      setCheckinBusy(false);
    }
  };

  const { notes: complianceNotes } = useGoalLinkedTaskComplianceNotes(
    isSessionActive ? checklistSessionId : null,
    activeTasks,
  );

  const handleIncidentSubmitted = () => {
    if (!checklistSessionId) return;
    const pending = evaluateWorkerCompliance({
      notes: complianceNotes,
      tasks: activeTasks.map((task) => ({
        task_id: task.task_id,
        label: task.label,
        completed: task.completed,
        marked_na: task.marked_na,
        goal_title: task.goal_title,
      })),
      participantFirstName,
      shiftEndIso: shift.scheduled_end,
    })
      .noteFlags.filter((flag) => flag.ruleId === 9 && flag.severity === "fail")
      .map((flag) => flag.noteId);
    if (pending.length) markNotesIncidentFiled(checklistSessionId, pending);
    setIncidentFormOpen(false);
  };

  const directionsUrl = shift.participant_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shift.participant_address)}`
    : null;

  const timerLabel = longShiftBreak?.onBreak
    ? "On break — billing paused"
    : isSessionActive
      ? "Session active — documenting"
      : "At location — tap Start Session";

  const timerBg = longShiftBreak?.onBreak
    ? "var(--cc-status-warning-bg)"
    : isSessionActive
      ? "var(--cc-status-success-bg)"
      : "var(--cc-status-warning-bg)";
  const timerText = longShiftBreak?.onBreak
    ? "text-amber-800"
    : isSessionActive
      ? "text-emerald-700"
      : "text-amber-700";
  const timerDot = longShiftBreak?.onBreak
    ? "bg-amber-500 animate-pulse"
    : isSessionActive
      ? "bg-emerald-500"
      : "bg-amber-500";
  const timerMono = longShiftBreak?.onBreak
    ? "text-amber-700"
    : isSessionActive
      ? "text-emerald-600"
      : "text-amber-600";

  const taskFeedProgress = isSessionActive && (
    <div className="mb-4">
      <p className="text-xs font-semibold" style={{ color: MUTED }}>
        {feedSummary.strongEvidenceCount} task{feedSummary.strongEvidenceCount === 1 ? "" : "s"} with
        strong evidence · {feedSummary.totalUpdates} total update
        {feedSummary.totalUpdates === 1 ? "" : "s"}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-cc-soft">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${feedSummary.progressPercent}%` }}
        />
      </div>
      <p className="mt-1 text-right text-[10px] font-black text-emerald-600">
        {feedSummary.progressPercent}%
      </p>
    </div>
  );

  const taskChecklistBlock = (
    <div data-tutorial="task-evidence">
      <ShiftTaskChecklist
        shiftId={shift.id}
        sessionId={checklistSessionId}
        participantName={shift.participant_name}
        participantFirstName={participantFirstName}
        shiftEndIso={shift.scheduled_end}
        tasks={activeTasks}
        onTasksChange={setTasks}
        disabled={isCompleted}
        sessionStyle={isSessionActive}
        focusTaskId={focusTaskId}
        tutorialDemo={isTutorialDemo}
        onOpenIncidentReport={onOpenIncidentReport}
      />
    </div>
  );

  const sessionTimelineBlock =
    isSessionActive && checklistSessionId && activeTasks.length > 0 ? (
      <SessionTimeline
        sessionId={checklistSessionId}
        tasks={activeTasks}
        open={timelineOpen}
        onToggle={() => setTimelineOpen(!timelineOpen)}
        embedded
      />
    ) : null;

  const goalFeedExpanded = sessionFocus || tasksOpen;

  const goalLinkedTaskFeedSection =
    showTasks && activeTasks.length > 0 ? (
      <section
        id="shift-task-checklist"
        data-tutorial="shift-task-checklist"
        className="overflow-hidden rounded-2xl border border-cc-border bg-cc-surface shadow-sm"
      >
        {sessionFocus ? (
          <div className="flex w-full items-center justify-between bg-cc-soft px-4 py-3.5">
            <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
              <span className="grid h-7 w-7 place-items-center">
                <MessageCircle size={14} />
              </span>
              Goal-Linked Task Feed
            </span>
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-black",
                feedSummary.goalsComplete === feedSummary.goalsTotal && feedSummary.goalsTotal > 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-cc-border bg-cc-surface text-cc-plum",
              )}
            >
              {feedSummary.goalsComplete}/{feedSummary.goalsTotal}
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full items-center justify-between bg-cc-soft px-4 py-3.5 text-left"
            onClick={() => setTasksOpen(!tasksOpen)}
          >
            <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
              <span className="grid h-7 w-7 place-items-center">
                <MessageCircle size={14} />
              </span>
              Goal-Linked Task Feed
            </span>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-black",
                  feedSummary.goalsComplete === feedSummary.goalsTotal && feedSummary.goalsTotal > 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-cc-border bg-cc-surface text-cc-plum",
                )}
              >
                {feedSummary.goalsComplete}/{feedSummary.goalsTotal}
              </span>
              <ChevronDown size={18} className={cn("transition", tasksOpen && "rotate-180")} style={{ color: MUTED }} />
            </span>
          </button>
        )}
        {goalFeedExpanded && (
          <div className="border-t border-cc-border px-4 py-3">
            {taskFeedProgress}
            {taskChecklistBlock}
            {sessionTimelineBlock}
          </div>
        )}
      </section>
    ) : null;

  return (
    <div className="relative space-y-4 pb-4" data-tutorial="shift-workspace">
      {(visualState === "clocked_in" || visualState === "session_active") && (
        <div
          data-tutorial="clock-in-complete"
          className="pointer-events-none absolute left-0 top-0 h-[2px] w-[2px] overflow-hidden opacity-0"
          aria-hidden="true"
        />
      )}
      {isCompleted && (
        <ShiftCompletionSummary shift={shift} summary={shift.completion_summary} />
      )}

      <section
        className="overflow-hidden rounded-2xl border-2 bg-cc-surface shadow-sm transition-[border-color] duration-300 ease-in-out"
        style={{ borderColor: state.border }}
        data-tutorial="shift-header"
      >
        <div className="h-1 transition-[background-color] duration-300 ease-in-out" style={{ background: state.border }} />
        <div className="p-5">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                "relative grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-black text-white",
                pulseAvatar && "ring-4 ring-offset-2 animate-pulse",
              )}
              style={{
                background: state.avatar,
                ...(pulseAvatar
                  ? { boxShadow: `0 0 0 4px ${state.border}33` }
                  : {}),
              }}
            >
              {shiftInitials(shift.participant_name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black tracking-tight" style={{ color: "var(--cc-plum)" }}>
                  {shift.participant_name}
                </h1>
                <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase", tagStyle)}>
                  {serviceTag}
                </span>
                <ShiftStatusBadge visualState={visualState} onBreak={longShiftBreak?.onBreak} className="ml-auto" />
              </div>
              <p className="mt-1 text-sm font-semibold" style={{ color: TEXT }}>
                {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}
                {durationLabel ? ` — ${durationLabel} scheduled` : ""}
              </p>
              {shift.participant_address && (
                <p className="mt-1 flex items-start gap-1.5 text-sm font-medium" style={{ color: MUTED }}>
                  <MapPin size={14} className="mt-0.5 shrink-0" />
                  {shift.participant_address}
                </p>
              )}
              {entryNote && (
                <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: MUTED }}>
                  {entryNote}
                </p>
              )}
              <div className="mt-3 flex gap-2">
                {directionsUrl && (
                  <a href={directionsUrl} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-full text-xs font-bold">
                      <Navigation size={14} /> Directions
                    </Button>
                  </a>
                )}
                {shift.participant_phone && (
                  <a href={`tel:${shift.participant_phone}`}>
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-full text-xs font-bold">
                      <Phone size={14} /> Call
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </div>

          {(isClockedIn || isSessionActive) && (
            <div
              className={cn(
                "mt-4 rounded-xl px-3 py-2",
                longShiftBreak?.onBreak ? "space-y-2" : "flex items-center justify-between",
              )}
              style={{ background: timerBg }}
            >
              <span className={cn("flex items-center gap-2 text-xs font-bold", timerText)}>
                <span className={cn("h-2 w-2 rounded-full", timerDot)} />
                {timerLabel}
              </span>
              {longShiftBreak?.onBreak ? (
                <BreakStatusBanner
                  variant="card"
                  breakElapsed={longShiftBreak.breakElapsed}
                  sessionElapsed={elapsed}
                />
              ) : (
                <span className={cn("font-mono text-sm font-black", timerMono)}>
                  {elapsed}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <ShiftProgressStepper visualState={visualState} />

      {!isCompleted && (
        <ShiftMapPanel
          shiftId={shift.id}
          address={shift.participant_address}
          open={locationOpen}
          onToggle={() => setLocationOpen(!locationOpen)}
        />
      )}

      {visualState === "scheduled" && (
        <>
          <ShiftTravelExpenseCard
            shiftId={shift.id}
            shiftStatus={shift.status}
            clockedInAt={clockedInAt}
            mileageDraftRef={mileageDraftRef}
          />

          <ShiftTransitExpenseCard shiftId={shift.id} shiftStatus={shift.status} />
        </>
      )}

      {!isCompleted && visualState === "scheduled" && (
        <Button
          type="button"
          className="h-14 w-full rounded-2xl border-0 text-base font-black text-white shadow-md"
          style={{ background: "#F59E0B" }}
          disabled={busy !== null || ((needsRiskAck || tutorialPendingRiskAck) && !effectiveRiskAcked)}
          data-tutorial="clock-in"
          onClick={onClockIn}
        >
          {busy === "clock" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <MapPin size={18} className="mr-2 inline" />
              Clock In — I&apos;ve Arrived
            </>
          )}
        </Button>
      )}

      {isClockedIn && (
        <div className="space-y-2">
          <StartSessionButton
            shiftId={shift.id}
            participantName={shift.participant_name}
            onStartSession={onStartSession}
            isLoading={busy === "start"}
            disabled={(busy !== null && busy !== "start") || ((needsRiskAck || tutorialPendingRiskAck) && !effectiveRiskAcked)}
          />
          <button
            type="button"
            className="w-full text-center text-xs font-semibold underline-offset-2 hover:underline"
            style={{ color: MUTED }}
            disabled={busy !== null}
            onClick={onRequestClockOut}
          >
            Clock Out Without Session
          </button>
        </div>
      )}

      {isSessionActive && (
        <div className="space-y-3">
          {checklistSessionId && longShiftBreak && (
            <LongShiftEngagementPanel
              sessionId={checklistSessionId}
              shiftId={shift.id}
              clockedInAt={shift.clocked_in_at}
              sessionElapsed={elapsed}
              breakControl={longShiftBreak}
              initialCheckinStatus={shift.checkin_status}
            />
          )}
          <CheckInPromptModal
            open={checkinPromptOpen}
            onClose={() => setCheckinPromptOpen(false)}
            onSubmit={(status) => void handlePromptCheckin(status)}
            busy={checkinBusy}
            gapMinutes={longShiftCheckin.checkinOverdue ? 90 : undefined}
          />
          <Button
            type="button"
            className="h-14 w-full rounded-2xl border-0 text-base font-black text-white"
            style={{ background: CORAL }}
            disabled={busy !== null}
            data-tutorial="end-shift"
            onClick={(event) => {
              event.stopPropagation();
              onAttemptEndShift();
            }}
          >
            {busy === "end" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <Square size={16} className="mr-2 inline" /> End Shift
              </>
            )}
          </Button>

          {mandatoryAlertOpen && incompleteMandatory.length > 0 && (
            <MandatoryTasksAlert
              tasks={incompleteMandatory}
              busy={busy === "end"}
              onBackToTasks={onBackToMandatoryTasks}
              onEndAnyway={onEndAnywayFromMandatory}
            />
          )}
        </div>
      )}

      {showRiskAckPending && (
        <ParticipantRiskAcknowledgementSection
          alerts={riskAckAlerts}
          open={safetyOpen}
          onToggle={() => setSafetyOpen(!safetyOpen)}
          ackChecked={ackChecked}
          busy={busy === "ack"}
          onRequestAcknowledge={onRequestAcknowledge}
          onUncheck={() => setAckChecked(false)}
          onViewSupportInstructions={onViewSupportInstructions}
        />
      )}

      {showRiskAcknowledged && (
        <ParticipantRiskAcknowledgementSection
          alerts={riskAckAlerts}
          open={safetyOpen}
          onToggle={() => setSafetyOpen(!safetyOpen)}
          acknowledged
          acknowledgedAt={shift.risks_acknowledged_at}
          acknowledgedByName={shift.risks_acknowledged_by_name}
          ackChecked
          busy={false}
          onRequestAcknowledge={onRequestAcknowledge}
          onUncheck={() => {}}
        />
      )}

      <SupportInstructionsAccordion
        instructions={shift.support_instructions}
        open={supportOpen}
        onToggle={() => setSupportOpen(!supportOpen)}
        sectionId="shift-support-instructions"
      />

      {goalLinkedTaskFeedSection}

      {(isClockedIn || isSessionActive) && (
        <div id="shift-during-actions">
          <DuringShiftAccordion
            shiftId={shift.id}
            participantId={shift.participant_id}
            participantName={shift.participant_name}
            sessionId={checklistSessionId ?? shift.session_id}
            shiftAddress={shift.participant_address}
            officePhone={shift.office_contact_number ?? undefined}
            open={duringShiftOpen}
            onToggle={() => setDuringShiftOpen(!duringShiftOpen)}
            incidentFormOpen={incidentFormOpen}
            onIncidentFormOpenChange={setIncidentFormOpen}
            onIncidentSubmitted={handleIncidentSubmitted}
          />
        </div>
      )}
    </div>
  );
}

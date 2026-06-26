import { useEffect, useRef, useState } from "react";
import { recordShiftViewed } from "@/services/notificationService";
import { Link, useLocation, useParams } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useShiftTimer } from "@/hooks/useShiftTimer";
import { useShiftSessionActions } from "@/hooks/useShiftSessionActions";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  Mic,
  Square,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DuringShiftAccordion } from "@/components/shifts/DuringShiftAccordion";
import { ShiftTaskChecklist } from "@/components/shifts/ShiftTaskChecklist";
import { SessionTimeline } from "@/components/shifts/SessionTimeline";
import { ShiftProgressStepper } from "@/components/shifts/ShiftProgressStepper";
import { ShiftStatusBadge } from "@/components/shifts/ShiftStatusBadge";
import { PreShiftBriefing } from "@/components/shifts/PreShiftBriefing";
import { ShiftSessionSplitLayout } from "@/components/shifts/ShiftSessionSplitLayout";
import { LiveProgressNotePanel } from "@/components/shifts/LiveProgressNotePanel";
import { ShiftMapPanel } from "@/components/shifts/ShiftMapPanel";
import { ShiftTravelExpenseCard, type MileageDraftState } from "@/components/shifts/ShiftTravelExpenseCard";
import { ShiftTransitExpenseCard } from "@/components/shifts/ShiftTransitExpenseCard";
import { ShiftStageBanner } from "@/components/shifts/ShiftStageBanner";
import { OfflineSyncBanner } from "@/components/shifts/OfflineSyncBanner";
import { EvidenceSyncBanner } from "@/components/shifts/EvidenceSyncBanner";
import { useEvidenceSync } from "@/hooks/useEvidenceSync";
import { SupportInstructionsAccordion } from "@/components/shifts/SupportInstructionsAccordion";
import { ParticipantRiskAcknowledgementSection } from "@/components/shifts/ParticipantRiskAlerts";
import { ParticipantProfileCard } from "@/components/shifts/ParticipantProfileCard";
import { ParticipantPreferencesCard } from "@/components/shifts/ParticipantPreferencesCard";
import { ParticipantContextPanel } from "@/components/shifts/ParticipantContextPanel";
import {
  cacheParticipantContext,
  loadCachedParticipantContext,
  type CachedParticipantContext,
} from "@/lib/participant-context-cache";
import { ClockInFlow } from "@/components/shifts/ClockInFlow";
import { ParticipantSafetyPage } from "@/components/shifts/ParticipantSafetyPage";
import {
  cacheSafetyProtocol,
  loadCachedSafetyProtocol,
} from "@/lib/participant-safety-cache";
import type { SafetyProtocol } from "@/services/safetyProtocolService";
import { getWorkerSafetyProtocol } from "@/services/safetyProtocolService";
import {
  enqueueClockIn,
  getPendingClockIn,
  listPendingActions,
} from "@/lib/shift-offline-queue";
import { syncAllQueuedShiftActions } from "@/lib/sync-pending-shift-actions";
import { useOfflineSync } from "@/contexts/OfflineSyncContext";
import { setSyncTaskLabel } from "@/lib/offline-sync-registry";
import { resetShiftDataUsage } from "@/lib/shift-data-usage";
import { ShiftCompletionSummary } from "@/components/shifts/ShiftCompletionSummary";
import { EndShiftValidationModal } from "@/components/shifts/EndShiftValidationModal";
import { ShiftSignatureModal } from "@/components/shifts/ShiftSignatureModal";
import { MandatoryTasksAlert } from "@/components/shifts/MandatoryTasksAlert";
import { StartSessionButton } from "@/components/shifts/StartSessionButton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  getTutorialScene,
  isTutorialActive,
  parseTutorialStepKey,
} from "@/lib/worker-tutorial-scene";
import { useWorkerTutorialOptional } from "@/contexts/WorkerTutorialContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = { id: string };

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
    return "clocked_in";
  }
  if (instantSessionActive && shift.visual_state === "clocked_in") {
    return "session_active";
  }
  return shift.visual_state;
}

export default function MyShiftDetail({ id: idProp }: Props) {
  const params = useParams<{ id: string }>();
  const [location] = useLocation();
  const isTutorialPreview = isTutorialActive(location);
  const tutorialStepKey = parseTutorialStepKey(location);
  const tutorialScene = getTutorialScene(tutorialStepKey);
  const isTutorialDemo = isTutorialPreview && tutorialStepKey !== null;
  const id = (idProp || params.id || "").trim();
  const { user } = useAuth();
  const tutorial = useWorkerTutorialOptional();
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const orgId = user?.organizationId ?? "__no_org__";
  const [briefingOpen, setBriefingOpen] = useState(true);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [duringShiftOpen, setDuringShiftOpen] = useState(false);
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
  const [notePanelOpen, setNotePanelOpen] = useState(false);
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [clockOutOpen, setClockOutOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [mandatoryAlertOpen, setMandatoryAlertOpen] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [forceEndPending, setForceEndPending] = useState(false);
  const [ackConfirmOpen, setAckConfirmOpen] = useState(false);
  const [tutorialDemoClockedIn, setTutorialDemoClockedIn] = useState(false);
  const [tutorialSignatureDone, setTutorialSignatureDone] = useState(false);
  const [clockInFlowOpen, setClockInFlowOpen] = useState(false);
  const [safetyProtocolOpen, setSafetyProtocolOpen] = useState(false);
  const [safetyProtocolMandatory, setSafetyProtocolMandatory] = useState(false);
  const [safetyProtocolView, setSafetyProtocolView] = useState<SafetyProtocol | null>(null);
  const [pendingClockInCount, setPendingClockInCount] = useState(0);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const mileageDraftRef = useRef<MileageDraftState>({
    claimedKm: null,
    calculatedKm: null,
    isOverridden: false,
  });
  const { setActiveShiftId } = useOfflineSync();

  useEffect(() => {
    setActiveShiftId(id || null);
    try {
      if (id) sessionStorage.setItem("ccq_active_shift_id", id);
      else sessionStorage.removeItem("ccq_active_shift_id");
    } catch {
      /* noop */
    }
    return () => setActiveShiftId(null);
  }, [id, setActiveShiftId]);

  useEffect(() => {
    if (!isTutorialPreview) return;
    if (tutorialStepKey === "risk_acknowledgement") {
      setSafetyOpen(true);
    }
    setValidationOpen(Boolean(tutorialScene?.openValidationModal));
    setSignatureOpen(Boolean(tutorialScene?.openSignatureModal));
  }, [isTutorialPreview, tutorialStepKey, tutorialScene]);

  useEffect(() => {
    for (const task of tasks) {
      setSyncTaskLabel(task.task_id, task.label);
    }
  }, [tasks]);

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
  } = useShiftSessionActions({
    shiftId: id,
    orgId,
    shift,
    onTasksUpdated: setTasks,
    onSessionStarted: () => setNotePanelOpen(true),
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
    if (
      shift.requires_briefing
      && !shift.briefing_complete
      && shift.visual_state === "scheduled"
      && !isTutorialDemo
    ) {
      window.location.replace(`/my-shifts/${id}/briefing`);
    }
  }, [shift, id, isTutorialDemo]);

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
    if (shift.safety_protocol && shift.has_safety_content) {
      void cacheSafetyProtocol(shift.participant_id, shift.safety_protocol);
    }
  }, [
    shift?.participant_id,
    shift?.profile,
    shift?.preferences,
    shift?.context,
    shift?.context_synced_at,
    shift?.safety_protocol,
    shift?.has_safety_content,
  ]);

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
    if (shift?.visual_state === "session_active") {
      setInstantSessionActive(false);
      clearPendingStartSession(id);
      setNotePanelOpen(true);
    }
  }, [shift?.visual_state, id]);

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
    if (shift.participant_id && (updated.profile || updated.context || updated.safety_protocol)) {
      void cacheParticipantContext({
        participantId: shift.participant_id,
        profile: updated.profile ?? shift.profile,
        preferences: updated.preferences ?? shift.preferences,
        context: updated.context ?? shift.context,
        syncedAt: updated.context_synced_at || new Date().toISOString(),
      });
      if (updated.safety_protocol) {
        void cacheSafetyProtocol(shift.participant_id, updated.safety_protocol);
      }
    }
    invalidateShifts();
    await refetch();
  };

  const performVerifiedClockIn = async (payload: ClockInRequest) => {
    if (!shift) return;
    const mileage = mileageDraftRef.current;
    const clockInPayload: ClockInRequest = { ...payload };
    if (mileage.isOverridden && mileage.claimedKm != null && mileage.claimedKm > 0) {
      clockInPayload.claimed_km = mileage.claimedKm;
    }
    if (isTutorialDemo) {
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
      window.dispatchEvent(new CustomEvent("offline-sync-updated"));
      setClockInFlowOpen(false);
      toast({
        title: translate("toast.offlineCheckIn"),
        description: translate("toast.offlineCheckInDesc"),
      });
      return;
    }
    try {
      const updated = await clockInShift(shift.id, clockInPayload);
      await applyClockInResult(updated);
      setClockInFlowOpen(false);
      toast({
        title: translate("toast.clockedIn"),
        description: translateParams("toast.clockedInDesc", {
          name: shift.participant_name ?? "participant",
        }),
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
          title: translate("toast.checkInNotAllowed"),
          description: apiErr.message || translate("common.error"),
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
      window.dispatchEvent(new CustomEvent("offline-sync-updated"));
      setClockInFlowOpen(false);
      toast({
        title: translate("toast.checkInSavedLocal"),
        description: apiErr.message || translate("toast.checkInSavedLocalDesc"),
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
            title: translate("toast.pendingSynced"),
            description: translateParams("toast.pendingSyncedDesc", {
              count: String(result.synced),
            }),
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

  const displayVisualState = shift
    ? resolveDisplayVisualState(shift, instantSessionActive, tutorialDemoClockedIn)
    : "scheduled";
  const timerActive =
    displayVisualState === "clocked_in" || displayVisualState === "session_active";
  const timerAnchor = shift
    ? timerAnchorIso(displayVisualState, shift.session_started_at, shift.clocked_in_at)
    : null;
  const { elapsed } = useShiftTimer(shift?.session_id, {
    serverStartIso: timerAnchor,
    active: timerActive,
  });

  const invalidateShifts = () => {
    invalidate();
  };

  const closeAckDialog = (open: boolean) => {
    setAckConfirmOpen(open);
    if (!open && !shift?.risks_acknowledged) {
      setAckChecked(false);
    }
  };

  const handleAcknowledge = async () => {
    if (!shift) return;
    setBusy("ack");
    try {
      await acknowledgeShiftRisks(shift.id);
      setAckChecked(true);
      setAckConfirmOpen(false);
      invalidateShifts();
      await refetch();
    } catch (err) {
      setAckChecked(false);
      toast({
        title: translate("toast.ackRisksFailed"),
        description: (err as Error).message || translate("toast.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const openSafetyPage = async (mandatory = false) => {
    if (!shift?.participant_id) return;
    setSafetyProtocolMandatory(mandatory);
    setSafetyProtocolOpen(true);
    try {
      const fresh = await getWorkerSafetyProtocol(shift.participant_id);
      setSafetyProtocolView(fresh);
      if (fresh.has_safety_content) {
        void cacheSafetyProtocol(shift.participant_id, fresh);
      }
      return;
    } catch {
      // Fall back to shift payload or offline cache.
    }
    if (shift.safety_protocol) {
      setSafetyProtocolView(shift.safety_protocol);
      return;
    }
    const cached = await loadCachedSafetyProtocol(shift.participant_id);
    if (cached) setSafetyProtocolView(cached);
  };

  const handleClockIn = () => {
    if (!shift) return;
    if (shift.requires_briefing && !shift.briefing_complete) {
      window.location.href = `/my-shifts/${shift.id}/briefing`;
      return;
    }
    if (shift.requires_safety_ack) {
      void openSafetyPage(true);
      toast({
        title: translate("toast.safetyCardRequired"),
        description: translate("toast.safetyCardRequiredDesc"),
        variant: "destructive",
      });
      return;
    }
    if (shiftNeedsRiskAck(shift) && !ackChecked) {
      setSafetyOpen(true);
      toast({
        title: translate("toast.ackSafetyFirst"),
        description: translate("toast.ackSafetyFirstDesc"),
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
        title: translate("toast.ackSafetyFirst"),
        description: translate("toast.ackSafetySession"),
        variant: "destructive",
      });
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
        title: translate("toast.clockedOut"),
        description: translate("toast.clockedOutDesc"),
      });
    } catch (err) {
      toast({
        title: translate("toast.clockOutFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleEndShift = async () => {
    if (!shift) return;
    setBusy("end");
    try {
      const updated = await endShift(shift.id, { force: forceEndPending });
      setTasks(updated.tasks ?? []);
      setNotePanelOpen(false);
      setInstantSessionActive(false);
      setEndShiftOpen(false);
      setValidationOpen(false);
      setMandatoryAlertOpen(false);
      setForceEndPending(false);
      resetShiftDataUsage(shift.id);
      invalidateShifts();
      await refetch();
      toast({
        title: translate("toast.shiftEnded"),
        description: translateParams("toast.shiftEndedDesc", {
          name: shift.participant_name ?? "participant",
        }),
      });
    } catch (err) {
      toast({
        title: translate("toast.endShiftFailed"),
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
      toast({
        title: translate("toast.taskMarkedNa"),
        description: translate("toast.taskMarkedNaDesc"),
      });
    } catch (err) {
      toast({
        title: translate("toast.taskUpdateFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const handleValidationEndAnyway = () => {
    setValidationOpen(false);
    setForceEndPending(true);
    setSignatureOpen(true);
  };

  const handleValidationEndShift = () => {
    setValidationOpen(false);
    setForceEndPending(false);
    setSignatureOpen(true);
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

  const handleSignatureComplete = () => {
    if (isTutorialDemo) {
      setTutorialSignatureDone(true);
      setSignatureOpen(false);
      return;
    }
    void handleEndShift();
  };

  if (!id) {
    return (
      <div className="space-y-4 py-8 text-safe">
        <p className="text-sm font-bold text-red-600">{translate("shift.invalidLink")}</p>
        <Link href="/my-shifts">
          <Button variant="outline" className="min-h-11 rounded-full">{translate("shift.backToShifts")}</Button>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm font-bold text-safe" style={{ color: MUTED }} role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {translate("shift.loading")}
      </div>
    );
  }

  if (error || !shift) {
    return (
      <div className="space-y-4 py-8 text-safe">
        <p className="text-sm font-bold text-red-600">{(error as Error)?.message || translate("shift.notFound")}</p>
        <Link href="/my-shifts">
          <Button variant="outline" className="min-h-11 rounded-full">{translate("shift.backToShifts")}</Button>
        </Link>
      </div>
    );
  }

  const isSessionActive = shift.visual_state === "session_active" || instantSessionActive;
  const showLiveSession = isSessionActive && notePanelOpen && !!shift.session_id;
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
    validationOpen && isTutorialDemo && activeTasksForValidation.length === 0
      ? TUTORIAL_VALIDATION_TASKS
      : activeTasksForValidation;
  const incompleteMandatory = incompleteMandatoryTasks(activeTasksForValidation);
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
      onRequestAcknowledge={() => {
        setAckConfirmOpen(true);
        if (isTutorialPreview && tutorialStepKey === "risk_acknowledgement") {
          void tutorial?.nextStep();
        }
      }}
      onViewSupportInstructions={() => {
        setSupportOpen(true);
        requestAnimationFrame(() => {
          document.getElementById("shift-support-instructions")?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }}
      onOpenSafetyPage={() => void openSafetyPage(false)}
      onClockIn={handleClockIn}
      onStartSession={handleStartSession}
      onRequestClockOut={() => setClockOutOpen(true)}
      onAttemptEndShift={handleAttemptEndShift}
      liveNoteOpen={notePanelOpen}
      onOpenLiveNote={() => setNotePanelOpen(true)}
      focusTaskId={focusTaskId}
      mandatoryAlertOpen={mandatoryAlertOpen}
      incompleteMandatory={incompleteMandatory}
      onBackToMandatoryTasks={handleBackToMandatoryTasks}
      onEndAnywayFromMandatory={handleEndAnywayFromMandatory}
      mileageDraftRef={mileageDraftRef}
    />
  );

  const dialogs = (
    <>
      {shift && (
        <ShiftSignatureModal
          open={signatureOpen}
          onOpenChange={setSignatureOpen}
          shiftId={shift.id}
          busy={busy === "end"}
          tutorialDemo={isTutorialDemo}
          onSigned={handleSignatureComplete}
        />
      )}

      {shift && (
        <EndShiftValidationModal
          open={validationOpen}
          onOpenChange={setValidationOpen}
          tasks={validationTasks}
          busy={busy === "end"}
          tutorialDemo={isTutorialDemo}
          onCancel={() => setValidationOpen(false)}
          onAddEvidence={handleValidationAddEvidence}
          onMarkNa={(taskId, reason) => void handleMarkTaskNa(taskId, reason)}
          onEndAnyway={handleValidationEndAnyway}
          onEndShift={handleValidationEndShift}
        />
      )}

      {shift && (
        <ParticipantSafetyPage
          open={safetyProtocolOpen}
          protocol={safetyProtocolView}
          participantName={shift.participant_name}
          mandatory={safetyProtocolMandatory}
          onClose={() => {
            setSafetyProtocolOpen(false);
            setSafetyProtocolMandatory(false);
          }}
          onAcknowledged={() => {
            void refetch();
          }}
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
            <AlertDialogTitle>{translate("shift.clockOut.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {translate("shift.clockOut.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{translate("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleClockOut()} disabled={busy === "clockout"}>
              {translate("shift.clockOut.action")}
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
              {forceEndPending ? translate("shift.endShift.incompleteTitle") : translate("shift.endShift.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {forceEndPending
                ? translate("shift.endShift.incompleteDesc")
                : translate("shift.endShift.desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{translate("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-cc-coral hover:opacity-90"
              onClick={(event) => {
                event.preventDefault();
                void handleEndShift();
              }}
              disabled={busy === "end"}
            >
              {forceEndPending ? translate("shift.endShift.anyway") : translate("shift.endShiftButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={ackConfirmOpen} onOpenChange={closeAckDialog}>
        <DialogContent
          data-tutorial="risk-ack-dialog"
          id="risk-ack-dialog"
          hideCloseButton
          className={cn("max-w-lg rounded-2xl", isTutorialPreview && "z-[10002]")}
          overlayClassName={isTutorialPreview ? "z-[10002]" : undefined}
          data-state={ackConfirmOpen ? "open" : "closed"}
        >
          <DialogHeader>
            <DialogTitle>Acknowledge safety alerts?</DialogTitle>
            <DialogDescription>
              Confirm you have read and understand all safety alerts for {shift?.participant_name ?? "this participant"}.
              This will be logged with your name and timestamp.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => closeAckDialog(false)} disabled={busy === "ack"}>
              {translate("common.cancel")}
            </Button>
            <Button onClick={() => void handleAcknowledge()} disabled={busy === "ack"} className="min-h-11">
              {busy === "ack" ? translate("shift.acknowledgeSaving") : translate("shift.acknowledgeRisks")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tutorialSignatureDone && (
        <div
          data-tutorial="shift-signature-complete"
          className="pointer-events-none absolute left-0 top-0 h-[2px] w-[2px] overflow-hidden opacity-0"
          aria-hidden="true"
        />
      )}
    </>
  );

  if (showLiveSession) {
    return (
      <div className="flex h-[calc(100dvh-8.5rem)] min-h-[560px] w-full max-w-none flex-col gap-3">
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
            className="flex shrink-0 items-center gap-2 text-sm font-bold transition hover:opacity-80"
            style={{ color: PLUM }}
          >
            <ArrowLeft size={18} /> My Shifts
          </button>
        </Link>

        <ShiftStageBanner
          visualState={displayVisualState}
          participantName={shift.participant_name}
          elapsed={elapsed}
        />

        <ShiftSessionSplitLayout
          className="min-h-0 flex-1"
          left={workflow}
          right={
            <LiveProgressNotePanel
              shiftId={shift.id}
              participantName={shift.participant_name}
              sessionId={shift.session_id}
              onClose={() => setNotePanelOpen(false)}
            />
          }
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-10">
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
          className="touch-target flex items-center gap-2 text-sm font-bold transition hover:opacity-80"
          style={{ color: PLUM }}
          aria-label={translate("shift.backToShifts")}
        >
          <ArrowLeft size={18} aria-hidden /> {translate("shift.backToShifts")}
        </button>
      </Link>
      <ShiftStageBanner
        visualState={displayVisualState}
        participantName={shift.participant_name}
        elapsed={elapsed}
      />
      {workflow}
      {dialogs}
    </div>
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
  onOpenSafetyPage,
  onClockIn,
  onStartSession,
  onRequestClockOut,
  onAttemptEndShift,
  liveNoteOpen,
  onOpenLiveNote,
  focusTaskId,
  mandatoryAlertOpen,
  incompleteMandatory,
  onBackToMandatoryTasks,
  onEndAnywayFromMandatory,
  mileageDraftRef,
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
  onOpenSafetyPage: () => void;
  onClockIn: () => void;
  onStartSession: () => void;
  onRequestClockOut: () => void;
  onAttemptEndShift: () => void;
  liveNoteOpen: boolean;
  onOpenLiveNote: () => void;
  focusTaskId?: string | null;
  mandatoryAlertOpen: boolean;
  incompleteMandatory: ShiftTask[];
  onBackToMandatoryTasks: () => void;
  onEndAnywayFromMandatory: () => void;
  mileageDraftRef: import("react").MutableRefObject<MileageDraftState>;
}) {
  const { translate, translateParams } = useAccessibility();
  const state = STATE_STYLES[visualState] ?? STATE_STYLES.scheduled;
  const duration = shiftDurationMinutes(shift.scheduled_start, shift.scheduled_end, shift.duration_minutes);
  const durationLabel = formatDurationLabel(duration);
  const hasAlerts = shiftHasRiskAlerts(shift);
  const risksAcked = shift.risks_acknowledged ?? false;
  const needsRiskAck = shiftNeedsRiskAck(shift);
  const showTasks =
    visualState === "clocked_in" ||
    visualState === "session_active";
  const serviceTag = (shift.service_category || "CORE").toUpperCase();
  const tagStyle = SERVICE_TAG_STYLES[serviceTag] ?? SERVICE_TAG_STYLES.CORE;
  const entryNote = shift.entry_instructions || shift.access_instructions;
  const isSessionActive = visualState === "session_active";
  const isClockedIn = visualState === "clocked_in";
  const isCompleted = visualState === "completed";
  const pulseAvatar = avatarShouldPulse(visualState);
  const activeTasks = resolveActiveShiftTasks(shift.tasks, tasks);
  const feedSummary = taskFeedSummary(activeTasks);

  const directionsUrl = shift.participant_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shift.participant_address)}`
    : null;

  const timerLabel = isSessionActive
    ? translate("shift.sessionActive")
    : translate("shift.atLocation");

  const timerBg = isSessionActive ? "var(--cc-status-success-bg)" : "var(--cc-status-warning-bg)";
  const timerText = isSessionActive ? "text-emerald-700" : "text-amber-700";
  const timerDot = isSessionActive ? "bg-emerald-500" : "bg-amber-500";
  const timerMono = isSessionActive ? "text-emerald-600" : "text-amber-600";

  return (
    <div className="relative space-y-4 pb-4 text-safe" data-tutorial="shift-workspace">
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
        className="overflow-hidden rounded-2xl border-2 bg-[var(--cc-surface)] shadow-sm transition-[border-color] duration-300 ease-in-out"
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
                <h1 className="text-lg font-black" style={{ color: TEXT }}>
                  {shift.participant_name}
                </h1>
                <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase", tagStyle)}>
                  {serviceTag}
                </span>
                <ShiftStatusBadge visualState={visualState} className="ml-auto" />
              </div>
              <p className="mt-1 text-sm font-semibold" style={{ color: TEXT }}>
                {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}
                {durationLabel ? ` — ${durationLabel} ${translate("shift.scheduledDuration")}` : ""}
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
                    <Button variant="outline" size="sm" className="min-h-10 gap-1.5 rounded-full text-xs font-bold">
                      <Navigation size={14} aria-hidden /> {translate("shift.directions")}
                    </Button>
                  </a>
                )}
                {shift.participant_phone && (
                  <a href={`tel:${shift.participant_phone}`}>
                    <Button variant="outline" size="sm" className="min-h-10 gap-1.5 rounded-full text-xs font-bold">
                      <Phone size={14} aria-hidden /> {translate("shift.call")}
                    </Button>
                  </a>
                )}
              </div>
            </div>
          </div>

          {(isClockedIn || isSessionActive) && (
            <div
              className="mt-4 flex items-center justify-between rounded-xl px-3 py-2"
              style={{ background: timerBg }}
            >
              <span className={cn("flex items-center gap-2 text-xs font-bold", timerText)}>
                <span className={cn("h-2 w-2 rounded-full", timerDot)} />
                {timerLabel}
              </span>
              <span className={cn("font-mono text-sm font-black", timerMono)}>
                {elapsed}
              </span>
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

      <ShiftTravelExpenseCard
        shiftId={shift.id}
        shiftStatus={shift.status}
        clockedInAt={shift.clocked_in_at}
        mileageDraftRef={mileageDraftRef}
      />

      <ShiftTransitExpenseCard shiftId={shift.id} shiftStatus={shift.status} />

      {!isCompleted && visualState === "scheduled" && (
        <Button
          type="button"
          data-tutorial="clock-in"
          className="touch-target h-14 w-full rounded-2xl border-0 text-base font-black text-white shadow-md"
          style={{ background: "linear-gradient(135deg, #F59E0B 0%, #F97316 100%)" }}
          disabled={busy !== null || (needsRiskAck && !ackChecked)}
          onClick={onClockIn}
          aria-label={translate("shift.clockIn")}
        >
          {busy === "clock" ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : (
            <>
              <MapPin size={18} className="mr-2 inline" aria-hidden />
              {translate("shift.clockIn")}
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
            disabled={(busy !== null && busy !== "start") || needsRiskAck}
          />
          <button
            type="button"
            className="touch-target w-full text-center text-xs font-semibold underline-offset-2 hover:underline"
            style={{ color: MUTED }}
            disabled={busy !== null}
            onClick={onRequestClockOut}
          >
            {translate("shift.clockOutWithoutSession")}
          </button>
        </div>
      )}

      {isSessionActive && (
        <div className="space-y-3">
          {!liveNoteOpen ? (
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                data-tutorial="session-notes"
                className="touch-target h-14 rounded-2xl border-2 bg-[var(--cc-surface)] text-base font-black shadow-sm"
                style={{ borderColor: PLUM, color: PLUM }}
                disabled={busy !== null}
                onClick={onOpenLiveNote}
                aria-label={translate("shift.notes")}
              >
                <Mic size={18} className="mr-2 inline" aria-hidden /> {translate("shift.notes")}
              </Button>
              <Button
                className="touch-target h-14 rounded-2xl border-0 text-base font-black text-white"
                data-tutorial="end-shift"
                style={{ background: CORAL }}
                disabled={busy !== null}
                onClick={onAttemptEndShift}
                aria-label={translate("shift.endShiftButton")}
              >
                {busy === "end" ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                ) : (
                  <>
                    <Square size={16} className="mr-2 inline" aria-hidden /> {translate("shift.endShiftButton")}
                  </>
                )}
              </Button>
            </div>
          ) : (
            <Button
              className="touch-target h-14 w-full rounded-2xl border-0 text-base font-black text-white"
              data-tutorial="end-shift"
              style={{ background: CORAL }}
              disabled={busy !== null}
              onClick={onAttemptEndShift}
              aria-label={translate("shift.endShiftButton")}
            >
              {busy === "end" ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <>
                  <Square size={16} className="mr-2 inline" aria-hidden /> {translate("shift.endShiftButton")}
                </>
              )}
            </Button>
          )}

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

      {needsRiskAck && !isCompleted && (
        <ParticipantRiskAcknowledgementSection
          alerts={shift.health_alerts ?? []}
          open={safetyOpen}
          onToggle={() => setSafetyOpen(!safetyOpen)}
          ackChecked={ackChecked}
          busy={busy === "ack"}
          onRequestAcknowledge={onRequestAcknowledge}
          onUncheck={() => setAckChecked(false)}
          onViewSupportInstructions={onViewSupportInstructions}
        />
      )}

      {hasAlerts && risksAcked && (
        <ParticipantRiskAcknowledgementSection
          alerts={shift.health_alerts ?? []}
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

      <ParticipantProfileCard
        profile={displayProfile}
        fallbackName={shift.participant_name}
        open={profileOpen}
        onToggle={() => setProfileOpen(!profileOpen)}
      />

      <ParticipantPreferencesCard
        preferences={displayPreferences}
        open={preferencesOpen}
        onToggle={() => setPreferencesOpen(!preferencesOpen)}
      />

      <ParticipantContextPanel
        context={displayContext}
        participantFirstName={participantFirstName}
        syncedAt={contextSyncedAt}
        open={contextOpen}
        onToggle={() => setContextOpen(!contextOpen)}
      />

      <SupportInstructionsAccordion
        instructions={shift.support_instructions}
        open={supportOpen}
        onToggle={() => setSupportOpen(!supportOpen)}
        sectionId="shift-support-instructions"
      />

      {(shift.has_safety_content || shift.safety_protocol) && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-violet-900">Safety protocols</p>
              <p className="text-xs text-violet-700">
                {shift.requires_safety_ack
                  ? translate("shift.safetyRequired")
                  : translate("shift.safetyOffline")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="font-bold"
              onClick={onOpenSafetyPage}
            >
              View safety page
            </Button>
          </div>
        </section>
      )}

      <PreShiftBriefing shift={shift} open={briefingOpen} onToggle={() => setBriefingOpen(!briefingOpen)} />

      {showTasks && activeTasks.length > 0 && (
        <section
          id="shift-task-checklist"
          data-tutorial="shift-task-checklist"
          className="overflow-hidden rounded-2xl border bg-cc-surface shadow-sm"
          style={{ borderColor: BORDER }}
        >
          <button
            type="button"
            className="flex w-full items-center justify-between bg-cc-bg px-4 py-3.5 text-left"
            onClick={() => setTasksOpen(!tasksOpen)}
          >
            <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
              <span
                className="grid h-7 w-7 place-items-center"
              >
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
          {tasksOpen && (
            <div className="border-t px-4 py-3" style={{ borderColor: BORDER }}>
              {isSessionActive && (
                <div className="mb-4">
                  <p className="text-xs font-semibold" style={{ color: MUTED }}>
                    {feedSummary.strongEvidenceCount} task{feedSummary.strongEvidenceCount === 1 ? "" : "s"} with
                    strong evidence · {feedSummary.totalUpdates} total update
                    {feedSummary.totalUpdates === 1 ? "" : "s"}
                  </p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E8E4F4]">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${feedSummary.progressPercent}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-[10px] font-black text-emerald-600">
                    {feedSummary.progressPercent}%
                  </p>
                </div>
              )}
              <div data-tutorial="task-evidence">
              <ShiftTaskChecklist
                shiftId={shift.id}
                sessionId={shift.session_id}
                participantName={shift.participant_name}
                tasks={activeTasks}
                onTasksChange={setTasks}
                disabled={isCompleted}
                sessionStyle={isSessionActive}
                focusTaskId={focusTaskId}
              />
              </div>

              {isSessionActive && shift.session_id && activeTasks.length > 0 && (
                <div className="mt-4">
                  <SessionTimeline
                    sessionId={shift.session_id}
                    tasks={activeTasks}
                    open={timelineOpen}
                    onToggle={() => setTimelineOpen(!timelineOpen)}
                  />
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {(isClockedIn || isSessionActive) && (
        <DuringShiftAccordion
          shiftId={shift.id}
          participantId={shift.participant_id}
          participantName={shift.participant_name}
          sessionId={shift.session_id}
          shiftAddress={shift.participant_address}
          officePhone={shift.office_contact_number ?? undefined}
          open={duringShiftOpen}
          onToggle={() => setDuringShiftOpen(!duringShiftOpen)}
        />
      )}
    </div>
  );
}

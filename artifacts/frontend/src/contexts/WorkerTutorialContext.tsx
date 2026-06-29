import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import type { Driver } from "driver.js";
import {
  destroyTutorialDriver,
  launchTutorialStep,
  waitForTutorialStepReady,
} from "@/lib/worker-tutorial-driver";
import {
  completeTutorialStep,
  getTutorialProgress,
  resetTutorialProgress,
  type TutorialProgress,
} from "@/services/helpService";
import { getWorkerShifts } from "@/services/shiftService";
import { confirmTutorialDismiss } from "@/lib/worker-tutorial-dismiss";
import { clearTutorialModalBlocking } from "@/lib/worker-tutorial-modal";
import { TutorialGuideLoadingOverlay } from "@/components/help/TutorialGuideLoadingOverlay";
import { useAuth } from "@/contexts/AuthContext";
import {
  getNextTutorialStepIndex,
  isTutorialEndShiftFlowModalOpen,
  isTutorialStepApplicable,
  resolveTutorialResumeIndex,
  resolveTutorialStartIndex,
  shouldAdvanceFromDismissedStep,
  shouldAutoSkipMissingTutorialTarget,
  shouldAutoSkipStepInAdvance,
  shouldSkipInapplicableTutorialStep,
  waitForShiftTutorialReady,
} from "@/lib/worker-tutorial-gates";
import {
  WORKER_TUTORIAL_STEPS,
  tutorialRouteMatches,
  tutorialStepRoute,
  type TutorialStepKey,
} from "@/lib/worker-tutorial-steps";

const LOCAL_KEY = "ccq_tutorial_progress";
const DISMISSED_KEY = "ccq_tutorial_dismissed_session";
const IN_PROGRESS_KEY = "ccq_tutorial_in_progress";

type WorkerTutorialContextValue = {
  loading: boolean;
  progress: TutorialProgress;
  activeIndex: number | null;
  activeStep: (typeof WORKER_TUTORIAL_STEPS)[number] | null;
  tutorialShiftId: string | null;
  isTutorialMode: boolean;
  start: (fromIndex?: number, topicKey?: TutorialStepKey) => Promise<void>;
  resume: () => Promise<void>;
  skipStep: () => Promise<void>;
  nextStep: () => Promise<void>;
  replay: () => Promise<void>;
  close: (skipConfirm?: boolean) => void;
  /** Tear down the driver overlay so modal buttons stay clickable; pass false to restore. */
  setDriverSuppressed: (suppressed: boolean) => void;
  /** Pause the loading overlay while a tutorial flow modal (validation / signature) is open. */
  setFlowModalBlocking: (blocking: boolean) => void;
  /** True while the step popover is not ready — block page interaction. */
  isStepGuideBlocking: boolean;
};

const WorkerTutorialContext = createContext<WorkerTutorialContextValue | null>(null);

function loadLocalProgress(): TutorialProgress {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw) as TutorialProgress;
  } catch {
    /* noop */
  }
  return { steps: {}, completed: false };
}

function saveLocalProgress(progress: TutorialProgress) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(progress));
  } catch {
    /* noop */
  }
}

async function resolveTutorialShiftId(): Promise<string | null> {
  try {
    const today = await getWorkerShifts("today");
    const active =
      today.shifts?.find((s) => s.status !== "completed" && s.status !== "cancelled") ??
      today.shifts?.[0];
    if (active?.id) return active.id;
    const upcoming = await getWorkerShifts("upcoming");
    return upcoming.shifts?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export function WorkerTutorialProvider({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const [progress, setProgress] = useState<TutorialProgress>(loadLocalProgress);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tutorialShiftId, setTutorialShiftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [driverSuppressed, setDriverSuppressedState] = useState(false);
  const [stepPromptHidden, setStepPromptHidden] = useState(false);
  const [stepGuideReady, setStepGuideReady] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [flowModalBlocking, setFlowModalBlocking] = useState(false);
  const driverRef = useRef<Driver | null>(null);
  const activeIndexRef = useRef<number | null>(null);

  const isTutorialMode = activeIndex !== null || location.includes("tutorial=1");

  const isFlowModalPaused = flowModalBlocking || isTutorialEndShiftFlowModalOpen();

  const isStepGuideBlocking = useMemo(
    () =>
      !stepPromptHidden
      && !driverSuppressed
      && !isFlowModalPaused
      && (bootstrapping || (activeIndex !== null && !stepGuideReady)),
    [stepPromptHidden, driverSuppressed, isFlowModalPaused, bootstrapping, activeIndex, stepGuideReady],
  );

  useEffect(() => {
    if (!isStepGuideBlocking) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isStepGuideBlocking]);

  const refresh = useCallback(async () => {
    try {
      const remote = await getTutorialProgress();
      setProgress(remote);
      saveLocalProgress(remote);
    } catch {
      setProgress(loadLocalProgress());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    if (isAuthenticated) return;
    destroyTutorialDriver(driverRef.current);
    driverRef.current = null;
    setActiveIndex(null);
    setDriverSuppressedState(false);
    setStepPromptHidden(false);
    clearTutorialModalBlocking();
    sessionStorage.setItem(DISMISSED_KEY, "1");
    sessionStorage.removeItem(IN_PROGRESS_KEY);
  }, [isAuthenticated]);

  const finishTutorial = useCallback(() => {
    setActiveIndex(null);
    setStepGuideReady(false);
    setFlowModalBlocking(false);
    sessionStorage.removeItem(IN_PROGRESS_KEY);
    if (location.includes("tutorial=1")) {
      navigate(location.replace(/[?&]tutorial=1(&step=[^&]*)?/, "").replace(/\?$/, "") || "/my-shifts");
    }
  }, [location, navigate]);

  const persistStepAtIndex = useCallback(async (index: number, skipped: boolean) => {
    const step = WORKER_TUTORIAL_STEPS[index];
    if (!step) return;
    try {
      const next = await completeTutorialStep(step.key, skipped);
      setProgress(next);
      saveLocalProgress(next);
    } catch {
      const local = loadLocalProgress();
      local.steps[step.key] = { skipped, completed_at: new Date().toISOString() };
      local.completed = WORKER_TUTORIAL_STEPS.every((s) => Boolean(local.steps[s.key]));
      setProgress(local);
      saveLocalProgress(local);
    }
  }, []);

  const activateStep = useCallback(
    (index: number, shiftId: string | null) => {
      const step = WORKER_TUTORIAL_STEPS[index];
      if (!step) return;
      setStepPromptHidden(false);
      if (!flowModalBlocking && !isTutorialEndShiftFlowModalOpen()) {
        setStepGuideReady(false);
      }
      setActiveIndex(index);
      const currentLocation = window.location.pathname + window.location.search;
      if (!tutorialRouteMatches(step, shiftId, currentLocation)) {
        navigate(tutorialStepRoute(step, shiftId));
      }
    },
    [navigate, flowModalBlocking],
  );

  const skipInapplicableFromCurrent = useCallback(async () => {
    if (isTutorialSessionDismissed()) {
      setActiveIndex(null);
      return;
    }

    let index = activeIndexRef.current;
    if (index === null) return;

    let shiftId = tutorialShiftId;
    if (!shiftId) shiftId = await resolveTutorialShiftId();
    setTutorialShiftId(shiftId);

    while (index !== null) {
      const step = WORKER_TUTORIAL_STEPS[index];
      if (!step || !shouldSkipInapplicableTutorialStep(step)) break;
      await persistStepAtIndex(index, true);
      index = index + 1 < WORKER_TUTORIAL_STEPS.length ? index + 1 : null;
    }

    if (index === null) {
      finishTutorial();
      return;
    }

    activateStep(index, shiftId);
  }, [tutorialShiftId, persistStepAtIndex, finishTutorial, activateStep]);

  const goToStep = useCallback(
    async (index: number, shiftId: string | null) => {
      if (isTutorialSessionDismissed()) return;
      const step = WORKER_TUTORIAL_STEPS[index];
      if (!step) return;
      activateStep(index, shiftId);
    },
    [activateStep],
  );

  const start = useCallback(
    async (fromIndex = 0, topicKey?: TutorialStepKey) => {
      setBootstrapping(true);
      try {
        sessionStorage.removeItem(DISMISSED_KEY);
        sessionStorage.setItem(IN_PROGRESS_KEY, "1");
        setStepPromptHidden(false);
        const requested = topicKey
          ? WORKER_TUTORIAL_STEPS.findIndex((step) => step.key === topicKey)
          : fromIndex;
        const shiftId = await resolveTutorialShiftId();
        setTutorialShiftId(shiftId);
        const index = resolveTutorialStartIndex(requested, WORKER_TUTORIAL_STEPS, topicKey);
        const step = WORKER_TUTORIAL_STEPS[index];
        if (step && !location.includes("tutorial=1")) {
          navigate(tutorialStepRoute(step, shiftId));
        }
        await goToStep(index, shiftId);
      } finally {
        setBootstrapping(false);
      }
    },
    [goToStep, location, navigate],
  );

  const resume = useCallback(async () => {
    if (progress.completed || isTutorialSessionDismissed()) return;
    setBootstrapping(true);
    try {
      sessionStorage.removeItem(DISMISSED_KEY);
      sessionStorage.setItem(IN_PROGRESS_KEY, "1");
      const shiftId = await resolveTutorialShiftId();
      setTutorialShiftId(shiftId);

      const index = resolveTutorialStartIndex(
        resolveTutorialResumeIndex(progress),
        WORKER_TUTORIAL_STEPS,
      );
      if (index >= WORKER_TUTORIAL_STEPS.length) return;

      const step = WORKER_TUTORIAL_STEPS[index];
      if (step.requiresShift && shiftId) {
        const currentLocation = window.location.pathname + window.location.search;
        if (!tutorialRouteMatches(step, shiftId, currentLocation)) {
          navigate(tutorialStepRoute(step, shiftId));
        }
        await waitForShiftTutorialReady(shiftId);
      }

      await goToStep(index, shiftId);
    } finally {
      setBootstrapping(false);
    }
  }, [progress, goToStep, navigate]);

  const persistStep = useCallback(async (skipped: boolean) => {
    const index = activeIndexRef.current;
    if (index === null) return;
    await persistStepAtIndex(index, skipped);
  }, [persistStepAtIndex]);

  const advance = useCallback(async () => {
    if (isTutorialSessionDismissed()) {
      setActiveIndex(null);
      return;
    }

    const index = activeIndexRef.current;
    if (index === null) return;

    let nextIndex: number | null =
      index + 1 < WORKER_TUTORIAL_STEPS.length ? index + 1 : null;
    while (nextIndex !== null && shouldAutoSkipStepInAdvance(WORKER_TUTORIAL_STEPS[nextIndex])) {
      await persistStepAtIndex(nextIndex, true);
      nextIndex = nextIndex + 1 < WORKER_TUTORIAL_STEPS.length ? nextIndex + 1 : null;
    }

    if (nextIndex === null) {
      finishTutorial();
      return;
    }

    let shiftId = tutorialShiftId;
    if (!shiftId) shiftId = await resolveTutorialShiftId();
    setTutorialShiftId(shiftId);
    activateStep(nextIndex, shiftId);
  }, [tutorialShiftId, persistStepAtIndex, finishTutorial, activateStep]);

  const skipStep = useCallback(async () => {
    setStepPromptHidden(true);
    destroyTutorialDriver(driverRef.current);
    driverRef.current = null;
    clearTutorialModalBlocking();
    document.body.classList.remove(
      "ccq-tutorial-active",
      "ccq-tutorial-allow-interaction",
      "ccq-tutorial-modal-open",
    );
  }, []);

  const nextStep = useCallback(async () => {
    await persistStep(false);
    await advance();
  }, [advance, persistStep]);

  const replay = useCallback(async () => {
    setBootstrapping(true);
    try {
      sessionStorage.removeItem(DISMISSED_KEY);
      sessionStorage.setItem(IN_PROGRESS_KEY, "1");
      destroyTutorialDriver(driverRef.current);
      driverRef.current = null;
      setActiveIndex(null);
      setStepPromptHidden(false);
      setStepGuideReady(false);
      try {
        const reset = await resetTutorialProgress();
        setProgress(reset);
        saveLocalProgress(reset);
      } catch {
        const empty = { steps: {}, completed: false };
        setProgress(empty);
        saveLocalProgress(empty);
      }
      navigate("/my-shifts?tutorial=1&step=shift_list");
      await start(0);
    } finally {
      setBootstrapping(false);
    }
  }, [start, navigate]);

  const close = useCallback((skipConfirm = false) => {
    if (!skipConfirm && !confirmTutorialDismiss()) return;
    destroyTutorialDriver(driverRef.current);
    driverRef.current = null;
    setActiveIndex(null);
    setDriverSuppressedState(false);
    setStepPromptHidden(false);
    setStepGuideReady(false);
    setFlowModalBlocking(false);
    setBootstrapping(false);
    sessionStorage.setItem(DISMISSED_KEY, "1");
    sessionStorage.removeItem(IN_PROGRESS_KEY);
    if (location.includes("tutorial=1")) {
      navigate("/my-shifts");
    }
  }, [location, navigate]);

  const setDriverSuppressed = useCallback((suppressed: boolean) => {
    setDriverSuppressedState(suppressed);
    if (suppressed) {
      destroyTutorialDriver(driverRef.current);
      driverRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (activeIndex === null || stepPromptHidden) {
      destroyTutorialDriver(driverRef.current);
      driverRef.current = null;
      return;
    }

    if (flowModalBlocking || driverSuppressed || isTutorialEndShiftFlowModalOpen()) {
      destroyTutorialDriver(driverRef.current);
      driverRef.current = null;
      setStepGuideReady((ready) => (ready ? ready : true));
      return;
    }

    const step = WORKER_TUTORIAL_STEPS[activeIndex];
    if (!step) return;

    let cancelled = false;

    const run = async () => {
      destroyTutorialDriver(driverRef.current);
      driverRef.current = null;

      if (isTutorialEndShiftFlowModalOpen() || flowModalBlocking) {
        setStepGuideReady((ready) => (ready ? ready : true));
        return;
      }

      setStepGuideReady(false);

      if (step.requiresShift && tutorialShiftId) {
        await waitForShiftTutorialReady(tutorialShiftId, 12000);
      }
      if (cancelled || activeIndexRef.current !== activeIndex) return;

      if (shouldSkipInapplicableTutorialStep(step)) {
        void skipInapplicableFromCurrent();
        return;
      }

      const target = await waitForTutorialStepReady(
        step,
        tutorialShiftId,
        () => window.location.pathname + window.location.search,
        10000,
      );
      if (cancelled || activeIndexRef.current !== activeIndex) return;

      if (!target) {
        setStepGuideReady(true);
        if (shouldAutoSkipMissingTutorialTarget(step)) {
          await persistStepAtIndex(activeIndex, true);
          void advance();
        } else {
          driverRef.current = launchTutorialStep({
            step,
            stepIndex: activeIndex,
            shiftId: tutorialShiftId,
            target: null,
            callbacks: {
              onNext: () => void nextStep(),
              onSkip: () => void skipStep(),
              onClose: () => close(true),
            },
          });
        }
        return;
      }

      driverRef.current = launchTutorialStep({
        step,
        stepIndex: activeIndex,
        shiftId: tutorialShiftId,
        target,
        callbacks: {
          onNext: () => void nextStep(),
          onSkip: () => void skipStep(),
          onClose: () => close(true),
        },
      });
      setStepGuideReady(true);
    };

    const timer = window.setTimeout(() => void run(), 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      destroyTutorialDriver(driverRef.current);
      driverRef.current = null;
    };
  }, [activeIndex, driverSuppressed, flowModalBlocking, stepPromptHidden, tutorialShiftId, close, nextStep, skipStep, skipInapplicableFromCurrent, persistStepAtIndex, advance]);

  useEffect(() => {
    if (activeIndex === null || !stepPromptHidden) return;

    const check = () => {
      if (activeIndexRef.current !== activeIndex) return;
      if (shouldAdvanceFromDismissedStep(activeIndex)) {
        void nextStep();
      }
    };

    check();
    const timer = window.setInterval(check, 400);
    return () => window.clearInterval(timer);
  }, [activeIndex, stepPromptHidden, nextStep]);

  const activeStep = activeIndex !== null ? WORKER_TUTORIAL_STEPS[activeIndex] : null;

  const value = useMemo(
    () => ({
      loading,
      progress,
      activeIndex,
      activeStep,
      tutorialShiftId,
      isTutorialMode,
      start,
      resume,
      skipStep,
      nextStep,
      replay,
      close,
      setDriverSuppressed,
      setFlowModalBlocking,
      isStepGuideBlocking,
    }),
    [
      loading,
      progress,
      activeIndex,
      activeStep,
      tutorialShiftId,
      isTutorialMode,
      start,
      resume,
      skipStep,
      nextStep,
      replay,
      close,
      setDriverSuppressed,
      setFlowModalBlocking,
      isStepGuideBlocking,
    ],
  );

  return (
    <WorkerTutorialContext.Provider value={value}>
      {children}
      <TutorialGuideLoadingOverlay />
    </WorkerTutorialContext.Provider>
  );
}

export function useWorkerTutorial() {
  const ctx = useContext(WorkerTutorialContext);
  if (!ctx) {
    throw new Error("useWorkerTutorial must be used within WorkerTutorialProvider");
  }
  return ctx;
}

export function useWorkerTutorialOptional() {
  return useContext(WorkerTutorialContext);
}

export function isTutorialSessionDismissed() {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export { IN_PROGRESS_KEY as TUTORIAL_IN_PROGRESS_KEY };

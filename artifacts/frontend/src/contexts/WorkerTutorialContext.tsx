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
import {
  getNextTutorialStepIndex,
  isTutorialStepApplicable,
  resolveTutorialStartIndex,
} from "@/lib/worker-tutorial-gates";
import {
  WORKER_TUTORIAL_STEPS,
  tutorialStepRoute,
  type TutorialStepKey,
} from "@/lib/worker-tutorial-steps";

const LOCAL_KEY = "ccq_tutorial_progress";
const DISMISSED_KEY = "ccq_tutorial_dismissed_session";

type WorkerTutorialContextValue = {
  loading: boolean;
  progress: TutorialProgress;
  activeIndex: number | null;
  activeStep: (typeof WORKER_TUTORIAL_STEPS)[number] | null;
  tutorialShiftId: string | null;
  isTutorialMode: boolean;
  start: (fromIndex?: number, topicKey?: TutorialStepKey) => Promise<void>;
  skipStep: () => Promise<void>;
  nextStep: () => Promise<void>;
  replay: () => Promise<void>;
  close: (skipConfirm?: boolean) => void;
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
  const [progress, setProgress] = useState<TutorialProgress>(loadLocalProgress);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tutorialShiftId, setTutorialShiftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const driverRef = useRef<Driver | null>(null);
  const activeIndexRef = useRef<number | null>(null);

  const isTutorialMode = activeIndex !== null || location.includes("tutorial=1");

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

  const goToStep = useCallback(
    async (index: number, shiftId: string | null) => {
      const step = WORKER_TUTORIAL_STEPS[index];
      if (!step) return;
      setActiveIndex(index);
      const route = tutorialStepRoute(step, shiftId);
      navigate(route);
    },
    [navigate],
  );

  const start = useCallback(
    async (fromIndex = 0, topicKey?: TutorialStepKey) => {
      sessionStorage.removeItem(DISMISSED_KEY);
      const requested = topicKey
        ? WORKER_TUTORIAL_STEPS.findIndex((step) => step.key === topicKey)
        : fromIndex;
      const shiftId = await resolveTutorialShiftId();
      setTutorialShiftId(shiftId);
      const index = resolveTutorialStartIndex(requested, WORKER_TUTORIAL_STEPS, topicKey);
      await goToStep(index, shiftId);
    },
    [goToStep],
  );

  const persistStep = useCallback(async (skipped: boolean) => {
    const index = activeIndexRef.current;
    if (index === null) return;
    const step = WORKER_TUTORIAL_STEPS[index];
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

  const advance = useCallback(async () => {
    const index = activeIndexRef.current;
    if (index === null) return;
    const nextIndex = getNextTutorialStepIndex(index, WORKER_TUTORIAL_STEPS);
    if (nextIndex !== null) {
      let shiftId = tutorialShiftId;
      if (!shiftId) shiftId = await resolveTutorialShiftId();
      setTutorialShiftId(shiftId);
      await goToStep(nextIndex, shiftId);
      return;
    }
    setActiveIndex(null);
    if (location.includes("tutorial=1")) {
      navigate(location.replace(/[?&]tutorial=1/, "").replace(/\?$/, "") || "/my-shifts");
    }
  }, [tutorialShiftId, goToStep, location, navigate]);

  const skipStep = useCallback(async () => {
    await persistStep(true);
    await advance();
  }, [advance, persistStep]);

  const nextStep = useCallback(async () => {
    await persistStep(false);
    await advance();
  }, [advance, persistStep]);

  const replay = useCallback(async () => {
    sessionStorage.removeItem(DISMISSED_KEY);
    try {
      const reset = await resetTutorialProgress();
      setProgress(reset);
      saveLocalProgress(reset);
    } catch {
      const empty = { steps: {}, completed: false };
      setProgress(empty);
      saveLocalProgress(empty);
    }
    await start(0);
  }, [start]);

  const close = useCallback((skipConfirm = false) => {
    if (!skipConfirm && !confirmTutorialDismiss()) return;
    destroyTutorialDriver(driverRef.current);
    driverRef.current = null;
    setActiveIndex(null);
    sessionStorage.setItem(DISMISSED_KEY, "1");
    if (location.includes("tutorial=1")) {
      navigate("/my-shifts");
    }
  }, [location, navigate]);

  useEffect(() => {
    if (activeIndex === null) {
      destroyTutorialDriver(driverRef.current);
      driverRef.current = null;
      return;
    }

    const step = WORKER_TUTORIAL_STEPS[activeIndex];
    if (!step) return;

    let cancelled = false;

    const run = async () => {
      destroyTutorialDriver(driverRef.current);
      driverRef.current = null;

      if (!isTutorialStepApplicable(step)) {
        void nextStep();
        return;
      }

      const target = await waitForTutorialStepReady(
        step,
        tutorialShiftId,
        () => window.location.pathname + window.location.search,
        10000,
      );
      if (cancelled || activeIndexRef.current !== activeIndex) return;

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
    };

    const timer = window.setTimeout(() => void run(), 450);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      destroyTutorialDriver(driverRef.current);
      driverRef.current = null;
    };
  }, [activeIndex, location, tutorialShiftId, close, nextStep, skipStep]);

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
      skipStep,
      nextStep,
      replay,
      close,
    }),
    [
      loading,
      progress,
      activeIndex,
      activeStep,
      tutorialShiftId,
      isTutorialMode,
      start,
      skipStep,
      nextStep,
      replay,
      close,
    ],
  );

  return <WorkerTutorialContext.Provider value={value}>{children}</WorkerTutorialContext.Provider>;
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

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { isTutorialSessionDismissed, TUTORIAL_IN_PROGRESS_KEY, useWorkerTutorial } from "@/contexts/WorkerTutorialContext";

const IN_PROGRESS_KEY = TUTORIAL_IN_PROGRESS_KEY;

/** Auto-starts or resumes the tutorial for workers who have not completed it. */
export function WorkerTutorialLauncher() {
  const { user } = useAuth();
  const [location] = useLocation();
  const tutorial = useWorkerTutorial();

  useEffect(() => {
    if (user?.role !== "support_worker" || tutorial.loading) return;
    if (tutorial.progress.completed || tutorial.activeIndex !== null) return;
    if (isTutorialSessionDismissed()) return;

    const hasProgress = Object.keys(tutorial.progress.steps).length > 0;
    const wasInProgress =
      sessionStorage.getItem(IN_PROGRESS_KEY) === "1" || location.includes("tutorial=1");

    if (hasProgress || wasInProgress) {
      void tutorial.resume();
      return;
    }

    void tutorial.start(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when loading completes
  }, [user?.role, tutorial.loading, tutorial.progress.completed, tutorial.activeIndex]);

  return null;
}

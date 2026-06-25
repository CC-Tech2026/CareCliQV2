import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isTutorialSessionDismissed, useWorkerTutorial } from "@/contexts/WorkerTutorialContext";

/** Auto-starts the tutorial once for workers who have not completed it. */
export function WorkerTutorialLauncher() {
  const { user } = useAuth();
  const tutorial = useWorkerTutorial();

  useEffect(() => {
    if (user?.role !== "support_worker" || tutorial.loading) return;
    if (tutorial.progress.completed || tutorial.activeIndex !== null) return;
    if (isTutorialSessionDismissed()) return;
    void tutorial.start(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when loading completes
  }, [user?.role, tutorial.loading, tutorial.progress.completed, tutorial.activeIndex]);

  return null;
}

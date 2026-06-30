import { Loader2 } from "lucide-react";
import { useWorkerTutorial } from "@/contexts/WorkerTutorialContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { WORKER_TUTORIAL_ENABLED } from "@/lib/worker-tutorial-feature";

/** Blocks scroll and clicks until the tutorial popover is on screen. */
export function TutorialGuideLoadingOverlay() {
  const { isStepGuideBlocking } = useWorkerTutorial();
  const { translate } = useAccessibility();

  if (!WORKER_TUTORIAL_ENABLED || !isStepGuideBlocking) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-3 bg-black/45 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={translate("help.tutorial.preparing")}
    >
      <Loader2 className="h-10 w-10 animate-spin text-white" aria-hidden />
      <p className="text-sm font-bold text-white">{translate("help.tutorial.preparing")}</p>
    </div>
  );
}

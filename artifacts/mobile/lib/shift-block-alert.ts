import { showAlert } from "@/lib/alert";
import type { TranslationKey } from "@/lib/i18n/translations";

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

type ActiveShiftLike = {
  id: string;
  participant_name?: string | null;
} | null;

/**
 * Clear confirmation when the worker tries to open/start another shift
 * while one is still in progress.
 */
export function showBlockedByInProgressAlert(
  t: Translate,
  inProgress: ActiveShiftLike,
  openActive: (shiftId: string) => void,
): void {
  const name = inProgress?.participant_name?.trim() || t("shifts.listCard.participant");
  showAlert(
    t("shifts.blockedInProgress.title"),
    t("shifts.blockedInProgress.body", { name }),
    [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("shifts.blockedInProgress.goToActive"),
        onPress: () => {
          if (inProgress?.id) openActive(inProgress.id);
        },
      },
    ],
  );
}

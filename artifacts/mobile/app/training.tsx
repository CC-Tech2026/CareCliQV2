import React from "react";

import { ProfileTrainingPanel } from "@/components/worker/profile/ProfileTrainingPanel";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useT } from "@/context/PreferencesContext";

export default function TrainingScreen() {
  const t = useT();

  return (
    <WorkerStackScreen headerTitle={t("nav.training")} cardsOnBackground showBack>
      <ProfileTrainingPanel bottomInset={24} />
    </WorkerStackScreen>
  );
}

import React from "react";

import { ProfileAvailabilityPanel } from "@/components/worker/profile/ProfileAvailabilityPanel";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useT } from "@/context/PreferencesContext";

export default function WorkerAvailabilityScreen() {
  const t = useT();

  return (
    <WorkerStackScreen headerTitle={t("nav.availability")} cardsOnBackground showBack>
      <ProfileAvailabilityPanel bottomInset={24} footerBottom={0} />
    </WorkerStackScreen>
  );
}

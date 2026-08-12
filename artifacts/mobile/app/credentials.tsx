import React from "react";

import { ProfileCredentialsPanel } from "@/components/worker/profile/ProfileCredentialsPanel";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useT } from "@/context/PreferencesContext";

export default function CredentialsScreen() {
  const t = useT();

  return (
    <WorkerStackScreen headerTitle={t("nav.credentials")} cardsOnBackground showBack>
      <ProfileCredentialsPanel bottomInset={24} showSectionHeader />
    </WorkerStackScreen>
  );
}

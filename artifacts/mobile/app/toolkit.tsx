import React from "react";

import { ProfileToolkitPanel } from "@/components/worker/profile/ProfileToolkitPanel";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useT } from "@/context/PreferencesContext";

export default function ToolkitScreen() {
  const t = useT();

  return (
    <WorkerStackScreen headerTitle={t("nav.toolkit")} cardsOnBackground showBack>
      <ProfileToolkitPanel bottomInset={24} />
    </WorkerStackScreen>
  );
}

import React from "react";

import { ActiveSessionsPanel } from "@/components/worker/security/ActiveSessionsPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function ActiveSessionsScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("security.activeSessions")} showBack>
      <ActiveSessionsPanel />
    </SettingsSubScreen>
  );
}

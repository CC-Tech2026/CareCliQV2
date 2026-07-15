import React from "react";

import { SettingsAccountPanel } from "@/components/worker/settings/SettingsAccountPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function SettingsAccountScreen() {
  const t = useT();

  return (
    <SettingsSubScreen showBottomNav={false} title={t("settings.row.profileDetails")}>
      <SettingsAccountPanel />
    </SettingsSubScreen>
  );
}

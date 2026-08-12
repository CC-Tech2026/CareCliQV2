import React from "react";

import { SettingsDefaultsPanel } from "@/components/worker/settings/SettingsDefaultsPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function SettingsDefaultsScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("settings.nav.defaults")}>
      <SettingsDefaultsPanel />
    </SettingsSubScreen>
  );
}

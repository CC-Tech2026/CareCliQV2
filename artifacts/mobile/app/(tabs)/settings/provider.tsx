import React from "react";

import { SettingsProviderPanel } from "@/components/worker/settings/SettingsProviderPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function SettingsProviderScreen() {
  const t = useT();

  return (
    <SettingsSubScreen showBottomNav={false} title={t("settings.nav.provider")}>
      <SettingsProviderPanel />
    </SettingsSubScreen>
  );
}

import React from "react";

import { SettingsCompliancePanel } from "@/components/worker/settings/SettingsCompliancePanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function SettingsComplianceScreen() {
  const t = useT();

  return (
    <SettingsSubScreen showBottomNav={false} title={t("settings.nav.compliance")}>
      <SettingsCompliancePanel />
    </SettingsSubScreen>
  );
}

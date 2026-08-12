import React from "react";

import { AccessibilityPreferencesPanel } from "@/components/worker/settings/AccessibilityPreferencesPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function AccessibilityScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("nav.accessibility")} showBack={false}>
      <AccessibilityPreferencesPanel />
    </SettingsSubScreen>
  );
}

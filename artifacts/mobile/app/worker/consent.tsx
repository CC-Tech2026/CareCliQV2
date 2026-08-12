import React from "react";

import { ConsentPreferencesPanel } from "@/components/worker/privacy/ConsentPreferencesPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function ConsentPreferencesScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("settings.row.consent")} showBack>
      <ConsentPreferencesPanel />
    </SettingsSubScreen>
  );
}

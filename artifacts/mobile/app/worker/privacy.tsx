import React from "react";

import { PrivacyPanel } from "@/components/worker/privacy/PrivacyPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function WorkerPrivacyScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("nav.privacy")} showBack={false}>
      <PrivacyPanel />
    </SettingsSubScreen>
  );
}

import React from "react";

import { SecurityPanel } from "@/components/worker/security/SecurityPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function WorkerSecurityScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("security.twoFactor")} showBack>
      <SecurityPanel />
    </SettingsSubScreen>
  );
}

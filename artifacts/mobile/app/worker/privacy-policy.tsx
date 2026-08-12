import React from "react";

import { PrivacyPolicyPanel } from "@/components/worker/privacy/PrivacyPolicyPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function PrivacyPolicyScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("privacy.policy")} showBack>
      <PrivacyPolicyPanel />
    </SettingsSubScreen>
  );
}

import React from "react";

import { AddCredentialPanel } from "@/components/worker/credentials/AddCredentialPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function AddCredentialScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("credentials.add")}>
      <AddCredentialPanel />
    </SettingsSubScreen>
  );
}

import React from "react";

import { CredentialFormPanel } from "@/components/worker/credentials/CredentialFormPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function AddCredentialScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("credentials.add")}>
      <CredentialFormPanel />
    </SettingsSubScreen>
  );
}

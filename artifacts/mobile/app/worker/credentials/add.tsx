import { useLocalSearchParams } from "expo-router";
import React from "react";

import { CredentialFormPanel } from "@/components/worker/credentials/CredentialFormPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";
import type { CredentialTypeOption } from "@/lib/credential-utils";

export default function AddCredentialScreen() {
  const t = useT();
  const { type } = useLocalSearchParams<{ type?: string }>();

  return (
    <SettingsSubScreen title={t("credentials.add")}>
      <CredentialFormPanel presetType={type as CredentialTypeOption | undefined} />
    </SettingsSubScreen>
  );
}

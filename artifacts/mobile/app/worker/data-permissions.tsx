import React from "react";

import { DataPermissionsPanel } from "@/components/worker/privacy/DataPermissionsPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";

export default function DataPermissionsScreen() {
  const t = useT();

  return (
    <SettingsSubScreen title={t("settings.row.dataPermissions")} showBack>
      <DataPermissionsPanel />
    </SettingsSubScreen>
  );
}

import { useLocalSearchParams } from "expo-router";
import React from "react";

import { IncidentDetailPanel } from "@/components/worker/incidents/IncidentDetailPanel";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useT } from "@/context/PreferencesContext";

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();

  return (
    <WorkerStackScreen
      headerTitle={t("incidents.detail.pageTitle")}
      cardsOnBackground
      showBack
    >
      <IncidentDetailPanel incidentId={id ?? ""} />
    </WorkerStackScreen>
  );
}

import React from "react";

import { IncidentsPanel } from "@/components/worker/incidents/IncidentsPanel";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useT } from "@/context/PreferencesContext";

export default function IncidentsListScreen() {
  const t = useT();

  return (
    <WorkerStackScreen
      headerTitle={t("nav.incidents")}
      pageTitle={t("incidents.title")}
      subtitle={t("incidents.subtitle")}
      cardsOnBackground
      showBack={false}
    >
      <IncidentsPanel />
    </WorkerStackScreen>
  );
}

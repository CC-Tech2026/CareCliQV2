import { useRouter } from "expo-router";
import React from "react";

import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { WorkerIncidentReportForm } from "@/components/worker/WorkerIncidentReportForm";
import { useT } from "@/context/PreferencesContext";

export default function NewIncidentScreen() {
  const router = useRouter();
  const t = useT();

  const handleDone = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/incidents" as never);
  };

  return (
    <WorkerStackScreen headerTitle={t("incidents.log")} cardsOnBackground showBack>
      <WorkerIncidentReportForm onSubmitted={handleDone} onCancel={handleDone} />
    </WorkerStackScreen>
  );
}

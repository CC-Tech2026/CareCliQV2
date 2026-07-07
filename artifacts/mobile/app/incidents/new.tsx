import { useRouter } from "expo-router";
import React from "react";

import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { WorkerIncidentReportForm } from "@/components/worker/WorkerIncidentReportForm";

export default function NewIncidentScreen() {
  const router = useRouter();

  const handleDone = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/incidents" as never);
  };

  return (
    <WorkerStackScreen
      headerTitle="New incident"
      pageTitle="New incident report"
      subtitle="Report a safety hazard or participant incident"
    >
      <WorkerIncidentReportForm onSubmitted={handleDone} onCancel={handleDone} />
    </WorkerStackScreen>
  );
}

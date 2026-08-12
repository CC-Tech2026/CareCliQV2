import React from "react";

import { WorkerProfileScreen } from "@/components/worker/profile/WorkerProfileScreen";

export default function WorkerAvailabilityScreen() {
  return <WorkerProfileScreen initialTab="availability" bottomInset={24} />;
}

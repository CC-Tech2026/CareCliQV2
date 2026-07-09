import React from "react";

import { WorkerProfileScreen } from "@/components/worker/profile/WorkerProfileScreen";

export default function ProfileTabScreen() {
  return <WorkerProfileScreen initialTab="availability" bottomInset={100} />;
}

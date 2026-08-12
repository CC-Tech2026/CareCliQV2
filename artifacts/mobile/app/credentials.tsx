import React from "react";

import { WorkerProfileScreen } from "@/components/worker/profile/WorkerProfileScreen";

export default function CredentialsScreen() {
  return <WorkerProfileScreen initialTab="credentials" bottomInset={24} />;
}

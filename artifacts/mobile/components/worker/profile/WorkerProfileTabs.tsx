import React from "react";

import { WorkerSegmentTabs, type SegmentTabConfig } from "@/components/worker/WorkerSegmentTabs";

export type ProfileTab = "availability" | "toolkit" | "credentials" | "training";

const TABS: SegmentTabConfig<ProfileTab>[] = [
  { id: "availability", labelKey: "nav.availability" },
  { id: "toolkit", labelKey: "nav.toolkit" },
  { id: "credentials", labelKey: "nav.credentials" },
  { id: "training", labelKey: "nav.training" },
];

type Props = {
  activeTab: ProfileTab;
  onChange: (tab: ProfileTab) => void;
};

export function WorkerProfileTabs({ activeTab, onChange }: Props) {
  return <WorkerSegmentTabs tabs={TABS} activeTab={activeTab} onChange={onChange} />;
}

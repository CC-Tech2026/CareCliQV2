import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";

import { ProfileAvailabilityPanel } from "@/components/worker/profile/ProfileAvailabilityPanel";
import { ProfileCredentialsPanel } from "@/components/worker/profile/ProfileCredentialsPanel";
import { ProfileToolkitPanel } from "@/components/worker/profile/ProfileToolkitPanel";
import { WorkerProfileHeader } from "@/components/worker/profile/WorkerProfileHeader";
import { WorkerProfileTabs, type ProfileTab } from "@/components/worker/profile/WorkerProfileTabs";
import { OfflineBanner } from "@/components/OfflineBanner";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { getWorkerProfile } from "@/lib/user-api";

type Props = {
  initialTab?: ProfileTab;
  bottomInset?: number;
};

export function WorkerProfileScreen({ initialTab = "availability", bottomInset = 100 }: Props) {
  const colors = useColors();
  const t = useT();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);

  const { data: profile } = useQuery({
    queryKey: ["worker", "profile"],
    queryFn: getWorkerProfile,
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("profile.title")} />
      <WorkerProfileHeader profile={profile} fallbackName={user?.full_name} fallbackRole={user?.role} />
      <WorkerProfileTabs activeTab={activeTab} onChange={setActiveTab} />

      <View style={styles.panel}>
        {activeTab === "availability" ? (
          <ProfileAvailabilityPanel bottomInset={bottomInset} footerBottom={bottomInset > 50 ? bottomInset - 24 : 0} />
        ) : null}
        {activeTab === "toolkit" ? <ProfileToolkitPanel bottomInset={bottomInset} /> : null}
        {activeTab === "credentials" ? <ProfileCredentialsPanel bottomInset={bottomInset} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  panel: { flex: 1 },
});

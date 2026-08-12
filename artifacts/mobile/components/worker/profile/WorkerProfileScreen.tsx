import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
  const { user, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);

  const { data: profile, isError, refetch } = useQuery({
    queryKey: ["users", "me"],
    queryFn: getWorkerProfile,
    enabled: isAuthenticated,
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("profile.title")} />
      <WorkerProfileHeader profile={profile} fallbackName={user?.full_name} fallbackRole={user?.role} />
      {isError ? (
        <Pressable
          onPress={() => void refetch()}
          style={[styles.errorBanner, { backgroundColor: colors.destructive + "1A", borderColor: colors.destructive }]}
        >
          <Text style={[styles.errorBannerText, { color: colors.destructive, fontFamily: "Inter_500Medium" }]}>
            {t("profile.loadError")}
          </Text>
        </Pressable>
      ) : null}
      <WorkerProfileTabs activeTab={activeTab} onChange={setActiveTab} />

      <View style={styles.panel}>
        <View style={activeTab === "availability" ? styles.panel : styles.hidden}>
          <ProfileAvailabilityPanel bottomInset={bottomInset} footerBottom={bottomInset > 50 ? bottomInset - 24 : 0} />
        </View>
        <View style={activeTab === "toolkit" ? styles.panel : styles.hidden}>
          <ProfileToolkitPanel bottomInset={bottomInset} />
        </View>
        <View style={activeTab === "credentials" ? styles.panel : styles.hidden}>
          <ProfileCredentialsPanel bottomInset={bottomInset} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  panel: { flex: 1 },
  hidden: { display: "none" },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorBannerText: { fontSize: 13, textAlign: "center" },
});

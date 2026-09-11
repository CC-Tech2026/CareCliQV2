import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { CredentialFormPanel } from "@/components/worker/credentials/CredentialFormPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { listMyCredentials } from "@/lib/resource-api";

export default function UpdateCredentialScreen() {
  const t = useT();
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isAuthenticated } = useAuth();

  // Same query key ProfileCredentialsPanel already populated — this is
  // navigated to from that list, so the cache is normally warm and this
  // resolves instantly rather than adding a second "get one credential"
  // network round trip the backend doesn't even expose.
  const { data: credentials = [], isLoading } = useQuery({
    queryKey: ["credentials", "me"],
    queryFn: listMyCredentials,
    enabled: isAuthenticated,
  });
  const credential = credentials.find((c) => c.id === id);

  return (
    <SettingsSubScreen title={t("credentials.update")}>
      {isLoading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : credential ? (
        <CredentialFormPanel credential={credential} />
      ) : (
        <View style={{ paddingVertical: 40, paddingHorizontal: 24, alignItems: "center" }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 14, textAlign: "center" }}>
            {t("credentials.notFound")}
          </Text>
        </View>
      )}
    </SettingsSubScreen>
  );
}

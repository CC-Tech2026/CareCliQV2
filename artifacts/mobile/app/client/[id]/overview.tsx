import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { ClientOverviewContent } from "@/components/worker/client/ClientOverviewContent";
import { ClientProfileHeader } from "@/components/worker/client/ClientProfileHeader";
import { ClientScreenShell } from "@/components/worker/client/ClientScreenShell";
import { useWorkerClientDetail } from "@/hooks/worker/useWorkerClientDetail";
import { useColors } from "@/hooks/useColors";

export default function ClientOverviewScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error } = useWorkerClientDetail(id);

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !data?.participant) {
    return (
      <ClientScreenShell title="Overview" backHref={`/client/${id}`}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error)?.message ?? "Client not found"}
          </Text>
        </View>
      </ClientScreenShell>
    );
  }

  const client = data.participant;

  return (
    <ClientScreenShell title="Overview" subtitle={client.full_name} backHref={`/client/${id}`}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <ClientProfileHeader client={client} />
        <ClientOverviewContent client={client} />
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scroll: { padding: 16, gap: 16 },
  errorText: { fontSize: 15, textAlign: "center" },
});

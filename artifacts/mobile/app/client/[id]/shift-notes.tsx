import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { ClientScreenShell } from "@/components/worker/client/ClientScreenShell";
import { ClientSessionList } from "@/components/worker/client/ClientSessionList";
import { useWorkerClientDetail } from "@/hooks/worker/useWorkerClientDetail";
import { useColors } from "@/hooks/useColors";

export default function ClientShiftNotesScreen() {
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
      <ClientScreenShell title="Shift Notes" backHref={`/client/${id}`}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error)?.message ?? "Client not found"}
          </Text>
        </View>
      </ClientScreenShell>
    );
  }

  const records = [...data.sessions, ...data.notes].sort((a, b) => {
    const aDate = a.session_date ? new Date(a.session_date).getTime() : 0;
    const bDate = b.session_date ? new Date(b.session_date).getTime() : 0;
    return bDate - aDate;
  });

  return (
    <ClientScreenShell title="Shift Notes" subtitle={data.participant.full_name} backHref={`/client/${id}`}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
          SHIFT NOTES
        </Text>
        <Text style={[styles.helperText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          Notes are finalised during the shift they were recorded in and cannot be added or edited here.
        </Text>
        <ClientSessionList rows={records} emptyLabel="No shift notes yet" />
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scroll: { padding: 16, gap: 12 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.8 },
  helperText: { fontSize: 12, lineHeight: 17, marginTop: -6 },
  errorText: { fontSize: 15, textAlign: "center" },
});

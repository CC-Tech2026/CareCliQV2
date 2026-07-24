import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  formatIncidentDate,
  incidentSeverityLabelKey,
  incidentStatusLabelKey,
  incidentTypeLabelKey,
} from "@/lib/incident-utils";
import { listIncidents, type IncidentSummary } from "@/lib/resource-api";
import * as Haptics from "@/lib/haptics";

function statusChipTone(
  status: string,
  colors: ReturnType<typeof useColors>,
): { color: string; bg: string } {
  if (status === "closed" || status === "resolved") {
    return { color: colors.mutedForeground, bg: colors.soft };
  }
  if (status === "under_investigation") {
    return { color: colors.warning, bg: colors.statusProgressBg };
  }
  return { color: colors.primary, bg: colors.activeBg };
}

function statusDisplayKey(status: string): ReturnType<typeof incidentStatusLabelKey> {
  if (status === "under_investigation") return "incidents.status.underReview";
  return incidentStatusLabelKey(status);
}

type CardProps = {
  incident: IncidentSummary;
  onPress: () => void;
};

function MyIncidentCard({ incident, onPress }: CardProps) {
  const colors = useColors();
  const t = useT();
  const tone = statusChipTone(incident.status, colors);
  const closed = incident.status === "closed" || incident.status === "resolved";
  const typeLabel = t(incidentTypeLabelKey(incident.incident_type));
  const severityLabel = t(incidentSeverityLabelKey(incident.severity));
  const dateLabel = formatIncidentDate(incident.incident_date);
  const metaLine = [dateLabel, incident.title].filter(Boolean).join(" · ");

  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.cardTop}>
        <Feather
          name="alert-triangle"
          size={16}
          color={closed ? colors.mutedForeground : colors.destructive}
        />
        <Text
          style={[styles.cardName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}
          numberOfLines={1}
        >
          {incident.participant_name || incident.title || t("incidents.noParticipant")}
        </Text>
        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.chipText, { color: tone.color, fontFamily: "Inter_600SemiBold" }]}>
            {t(statusDisplayKey(incident.status))}
          </Text>
        </View>
      </View>
      <Text style={[styles.cardType, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
        {typeLabel} · {severityLabel}
      </Text>
      {metaLine ? (
        <Text style={[styles.cardMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
          {metaLine}
        </Text>
      ) : null}
    </Pressable>
  );
}

type Props = {
  contentBottomPad?: number;
};

export function ComplianceIncidentsSection({ contentBottomPad = 110 }: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const { isAuthenticated } = useAuth();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["incidents"],
    queryFn: listIncidents,
    enabled: isAuthenticated,
  });

  const incidents = data ?? [];

  const renderItem = useCallback(
    ({ item }: { item: IncidentSummary }) => (
      <MyIncidentCard
        incident={item}
        onPress={() => router.push(`/incidents/${item.id}` as never)}
      />
    ),
    [router],
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
          {(error as Error).message}
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={incidents}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListHeaderComponent={
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/incidents/new" as never);
            }}
            style={[styles.reportBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.reportBtnText, { fontFamily: "Inter_600SemiBold" }]}>
              {t("compliance.reportIncident")}
            </Text>
          </Pressable>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {t("compliance.myIncidentReports")}
          </Text>
        </View>
      }
      contentContainerStyle={[styles.list, { paddingBottom: contentBottomPad }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("incidents.noIncidentsYet")}
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { fontSize: 14, textAlign: "center" },
  list: { paddingHorizontal: 16, paddingTop: 4 },
  header: { gap: 0, marginBottom: 2 },
  reportBtn: {
    height: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  reportBtnText: { color: "#FFFFFF", fontSize: 14 },
  sectionTitle: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 6,
    marginHorizontal: 4,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  cardName: { flex: 1, fontSize: 13 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipText: { fontSize: 10 },
  cardType: { fontSize: 11.5, marginBottom: 2, fontWeight: "500" },
  cardMeta: { fontSize: 11 },
  empty: { fontSize: 13, paddingTop: 8, marginHorizontal: 4 },
});

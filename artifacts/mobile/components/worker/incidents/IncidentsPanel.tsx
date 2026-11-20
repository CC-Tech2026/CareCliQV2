import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FontFamily } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";
import {
  formatIncidentDate,
  incidentSeverityLabelKey,
  incidentTypeLabelKey,
  severityMeta,
} from "@/lib/incident-utils";
import { listIncidents, type IncidentSummary } from "@/lib/resource-api";

type Tab = "open" | "closed";

/** Search only earns its space once there are a few reports to look through. */
const SEARCH_FROM = 6;

const isClosed = (status: string) =>
  status === "resolved" || status === "closed";

/** The worker's view of where a report is, in plain words. */
function statusKey(status: string): TranslationKey {
  if (status === "under_investigation") return "incidents.worker.stepReview";
  if (isClosed(status)) return "incidents.worker.stepClosed";
  return "incidents.worker.stepReported";
}

function IncidentCard({
  incident,
  onPress,
}: {
  incident: IncidentSummary;
  onPress: () => void;
}) {
  const colors = useColors();
  const t = useT();
  const severity = severityMeta(incident.severity);
  const closed = isClosed(incident.status);
  const meta = [
    incident.participant_name || t("incidents.noParticipant"),
    formatIncidentDate(incident.incident_date, incident.timezone),
  ].filter(Boolean);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <Text
          style={[
            styles.cardType,
            {
              color: colors.mutedForeground,
              fontFamily: FontFamily.interMedium,
            },
          ]}
        >
          {t(incidentTypeLabelKey(incident.incident_type))}
        </Text>
        <View
          style={[
            styles.status,
            { backgroundColor: closed ? colors.soft : colors.activeBg },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              {
                color: closed ? colors.mutedForeground : colors.primary,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {t(statusKey(incident.status))}
          </Text>
        </View>
      </View>
      <Text
        numberOfLines={2}
        style={[
          styles.cardTitle,
          { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
        ]}
      >
        {incident.title}
      </Text>
      <View style={styles.cardBottom}>
        <Text
          numberOfLines={1}
          style={[
            styles.cardMeta,
            {
              color: colors.mutedForeground,
              fontFamily: FontFamily.interRegular,
            },
          ]}
        >
          {meta.join("  ·  ")}
        </Text>
        <View style={styles.severity}>
          <View
            style={[styles.severityDot, { backgroundColor: severity.dot }]}
          />
          <Text
            style={[
              styles.severityText,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interMedium,
              },
            ]}
          >
            {t(incidentSeverityLabelKey(incident.severity))}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

type Props = {
  contentBottomPad?: number;
};

export function IncidentsPanel({ contentBottomPad }: Props = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { isAuthenticated } = useAuth();

  const [tab, setTab] = useState<Tab>("open");
  const [search, setSearch] = useState("");

  const {
    data: incidents = [],
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["incidents"],
    queryFn: async () => {
      const result = await listIncidents();
      return Array.isArray(result)
        ? result
        : ((result as { items?: IncidentSummary[] }).items ?? []);
    },
    enabled: isAuthenticated,
  });

  const openList = useMemo(
    () => incidents.filter((i) => !isClosed(i.status)),
    [incidents],
  );
  const closedList = useMemo(
    () => incidents.filter((i) => isClosed(i.status)),
    [incidents],
  );

  const shown = useMemo(() => {
    const list = tab === "open" ? openList : closedList;
    const q = search.trim().toLowerCase();
    const matched = q
      ? list.filter((i) =>
          [
            i.title,
            i.participant_name,
            t(incidentTypeLabelKey(i.incident_type)),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : list;
    return [...matched].sort((a, b) =>
      String(b.incident_date).localeCompare(String(a.incident_date)),
    );
  }, [tab, openList, closedList, search, t]);

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/incidents/new" as never)}
        style={({ pressed }) => [
          styles.reportCard,
          { backgroundColor: colors.primary, opacity: pressed ? 0.9 : 1 },
        ]}
      >
        <View style={styles.reportIcon}>
          <Feather name="alert-circle" size={22} color={colors.primary} />
        </View>
        <View style={styles.reportCopy}>
          <Text
            style={[
              styles.reportTitle,
              {
                color: colors.primaryForeground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {t("incidents.worker.reportCta")}
          </Text>
          <Text
            style={[
              styles.reportHint,
              {
                color: colors.primaryForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {t("incidents.worker.reportCtaHint")}
          </Text>
        </View>
        <Feather
          name="chevron-right"
          size={20}
          color={colors.primaryForeground}
        />
      </Pressable>

      <View style={[styles.emergency, { backgroundColor: colors.dangerBg }]}>
        <Feather name="phone" size={15} color={colors.dangerIcon} />
        <Text
          style={[
            styles.emergencyText,
            { color: colors.dangerText, fontFamily: FontFamily.interMedium },
          ]}
        >
          {t("incidents.worker.emergency")}
        </Text>
      </View>

      <Text
        style={[
          styles.sectionTitle,
          { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
        ]}
      >
        {t("incidents.worker.yourReports")}
      </Text>

      <View
        style={[styles.tabs, { backgroundColor: colors.soft }]}
        accessibilityRole="tablist"
      >
        {(
          [
            ["open", t("incidents.worker.open"), openList.length],
            ["closed", t("incidents.worker.closed"), closedList.length],
          ] as const
        ).map(([key, label, count]) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(key)}
              style={[styles.tab, active && { backgroundColor: colors.card }]}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    color: active ? colors.foreground : colors.mutedForeground,
                    fontFamily: active
                      ? FontFamily.interSemiBold
                      : FontFamily.interMedium,
                  },
                ]}
              >
                {label} {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {incidents.length >= SEARCH_FROM ? (
        <View
          style={[
            styles.search,
            { borderColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("incidents.worker.searchPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel={t("incidents.worker.searchPlaceholder")}
            style={[
              styles.searchInput,
              { color: colors.foreground, fontFamily: FontFamily.interRegular },
            ]}
          />
        </View>
      ) : null}
    </View>
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
        <Text
          style={[
            styles.errorText,
            { color: colors.foreground, fontFamily: FontFamily.interMedium },
          ]}
        >
          {t("incidents.worker.loadFailed")}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void refetch()}>
          <Text
            style={[
              styles.retry,
              { color: colors.primary, fontFamily: FontFamily.interSemiBold },
            ]}
          >
            {t("incidents.worker.retry")}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={shown}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[
        styles.list,
        { paddingBottom: contentBottomPad ?? insets.bottom + 24 },
      ]}
      showsVerticalScrollIndicator={false}
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListEmptyComponent={
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Feather
            name={tab === "open" ? "check-circle" : "archive"}
            size={22}
            color={colors.mutedForeground}
          />
          <Text
            style={[
              styles.emptyText,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {search.trim()
              ? t("incidents.worker.noMatch")
              : tab === "open"
                ? t("incidents.worker.emptyOpen")
                : t("incidents.worker.emptyClosed")}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <IncidentCard
          incident={item}
          onPress={() => router.push(`/incidents/${item.id}` as never)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
  },
  errorText: { fontSize: 15, textAlign: "center" },
  retry: { fontSize: 15 },
  list: { paddingHorizontal: 16 },
  header: { gap: 12, paddingTop: 8, paddingBottom: 12 },
  reportCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  reportIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  reportCopy: { flex: 1, gap: 3 },
  reportTitle: { fontSize: 17 },
  reportHint: { fontSize: 13, lineHeight: 18, opacity: 0.88 },
  emergency: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emergencyText: { flex: 1, fontSize: 14, lineHeight: 19 },
  sectionTitle: { fontSize: 18, marginTop: 10 },
  tabs: { flexDirection: "row", borderRadius: 14, padding: 4 },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: { fontSize: 15 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 10 },
  separator: { height: 10 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, gap: 6 },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardType: { fontSize: 13, flexShrink: 1 },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12 },
  cardTitle: { fontSize: 17, lineHeight: 23 },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cardMeta: { fontSize: 14, flexShrink: 1 },
  severity: { flexDirection: "row", alignItems: "center", gap: 6 },
  severityDot: { width: 8, height: 8, borderRadius: 4 },
  severityText: { fontSize: 13 },
  empty: {
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 18,
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  emptyText: { fontSize: 15, lineHeight: 21, textAlign: "center" },
});

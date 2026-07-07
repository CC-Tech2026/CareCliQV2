import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WorkerCardSection } from "@/components/worker/WorkerCardSection";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { usePreferences } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { listMyCredentials, type Credential } from "@/lib/resource-api";

const CREDENTIAL_TYPE_LABELS: Record<string, string> = {
  ndis_screening: "NDIS Worker Screening",
  wwcc: "Working with Children Check",
  code_of_conduct: "Code of Conduct",
  first_aid: "First Aid",
  cpr: "CPR",
  manual_handling: "Manual handling",
  infection_control: "Infection control",
  medication_admin: "Medication administration",
  drivers_licence: "Driver Licence",
};

const STATUS_FILTERS = ["all", "pending_review", "expiring", "expired", "valid"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function typeLabel(type: string) {
  return CREDENTIAL_TYPE_LABELS[type] ?? humanize(type);
}

function statusMeta(status: string): { color: string; bg: string; border: string } {
  if (status === "valid") return { color: "#15803D", bg: "#DCFCE7", border: "#BBF7D0" };
  if (status === "expiring") return { color: "#854F0B", bg: "#FEF3C7", border: "#FDE68A" };
  if (status === "expired" || status === "rejected") return { color: "#B91C1C", bg: "#FEE2E2", border: "#FECACA" };
  return { color: "#3730A3", bg: "#EEF0FF", border: "#E5E7EB" };
}

export default function CredentialsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = usePreferences();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["credentials", "me"],
    queryFn: listMyCredentials,
  });

  const summary = useMemo(
    () => ({
      total: data.length,
      pending: data.filter((c) => c.status === "pending_review").length,
      expiring: data.filter((c) => c.status === "expiring").length,
      expired: data.filter((c) => c.status === "expired").length,
    }),
    [data],
  );

  const filtered = useMemo(
    () => (statusFilter === "all" ? data : data.filter((c) => c.status === statusFilter)),
    [data, statusFilter],
  );

  const summaryCards = [
    { key: "total", label: t("credentials.total"), value: summary.total, tone: colors.foreground },
    { key: "pending", label: t("credentials.pendingReview"), value: summary.pending, tone: colors.foreground },
    { key: "expiring", label: t("credentials.expiring"), value: summary.expiring, tone: summary.expiring > 0 ? "#854F0B" : colors.foreground },
    { key: "expired", label: t("credentials.expired"), value: summary.expired, tone: summary.expired > 0 ? "#B91C1C" : colors.foreground },
  ];

  return (
    <WorkerStackScreen
      headerTitle={t("nav.credentials")}
      pageTitle={t("credentials.title")}
      subtitle={t("credentials.subtitle")}
      cardsOnBackground
    >
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error).message}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.summaryGrid}>
            {summaryCards.map((card) => (
              <View key={card.key} style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                  {card.label}
                </Text>
                <Text style={[styles.summaryValue, { color: card.tone, fontFamily: "Inter_700Bold" }]}>{card.value}</Text>
              </View>
            ))}
          </View>

          <View style={styles.filters}>
            {STATUS_FILTERS.map((filter) => {
              const active = statusFilter === filter;
              return (
                <Pressable
                  key={filter}
                  onPress={() => setStatusFilter(filter)}
                  style={[
                    styles.filterChip,
                    { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.activeBg : colors.card },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      { color: active ? colors.primary : colors.mutedForeground, fontFamily: active ? "Inter_700Bold" : "Inter_500Medium" },
                    ]}
                  >
                    {filter === "all" ? t("common.all") : humanize(filter)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <WorkerCardSection icon="award" title={t("credentials.myCredentials")}>
            {data.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {t("credentials.empty")}
              </Text>
            ) : filtered.length === 0 ? (
              <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {t("credentials.noMatch")}
              </Text>
            ) : (
              <View>
                {filtered.map((credential, index) => (
                  <CredentialRow
                    key={credential.id}
                    credential={credential}
                    isLast={index === filtered.length - 1}
                  />
                ))}
              </View>
            )}
          </WorkerCardSection>
        </ScrollView>
      )}
    </WorkerStackScreen>
  );
}

function CredentialRow({ credential, isLast }: { credential: Credential; isLast: boolean }) {
  const colors = useColors();
  const { t } = usePreferences();
  const meta = statusMeta(credential.status);

  return (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.rowTop}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
          {credential.title}
        </Text>
        <View style={[styles.badge, { backgroundColor: meta.bg, borderColor: meta.border }]}>
          <Text style={[styles.badgeText, { color: meta.color, fontFamily: "Inter_700Bold" }]}>
            {humanize(credential.status)}
          </Text>
        </View>
      </View>
      <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {typeLabel(credential.credential_type)}
        {credential.issuer ? ` · ${credential.issuer}` : ""}
        {credential.expiry_date ? ` · ${t("credentials.expiresOn", { date: credential.expiry_date })}` : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  error: { fontSize: 14, textAlign: "center" },
  empty: { fontSize: 14 },
  scroll: { padding: 16, gap: 14 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  summaryCard: { flexGrow: 1, flexBasis: "45%", borderRadius: 16, borderWidth: 1, padding: 14, gap: 4 },
  summaryLabel: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  summaryValue: { fontSize: 22 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  filterText: { fontSize: 12 },
  row: { paddingVertical: 14, gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { flex: 1, fontSize: 15, lineHeight: 20 },
  badge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  meta: { fontSize: 12, lineHeight: 18 },
});

import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
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

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { SettingsSection } from "@/components/worker/settings/settings-ui";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { listMyCredentials, type Credential } from "@/lib/resource-api";

function statusMeta(status: string): {
  labelKey: "credentials.valid" | "credentials.expiring" | "credentials.expired" | "credentials.pendingReview";
  color: string;
  bg: string;
  bar: string;
} {
  if (status === "valid") {
    return { labelKey: "credentials.valid", color: "#15803D", bg: "#DCFCE7", bar: "#22C55E" };
  }
  if (status === "expiring") {
    return { labelKey: "credentials.expiring", color: "#B45309", bg: "#FEF3C7", bar: "#F59E0B" };
  }
  if (status === "expired" || status === "rejected") {
    return { labelKey: "credentials.expired", color: "#B91C1C", bg: "#FEE2E2", bar: "#EF4444" };
  }
  return { labelKey: "credentials.pendingReview", color: "#3730A3", bg: "#EEF0FF", bar: "#6366F1" };
}

function formatCredentialDate(credential: Credential, t: ReturnType<typeof useT>): string {
  if (credential.status === "expired" && credential.expiry_date) {
    return t("profile.credentials.expiredOn", { date: credential.expiry_date });
  }
  if (credential.status === "expiring" && credential.expiry_date) {
    return t("profile.credentials.expiresOn", { date: credential.expiry_date });
  }
  if (credential.expiry_date) {
    return t("profile.credentials.validUntil", { date: credential.expiry_date });
  }
  if (credential.status === "valid") {
    return t("profile.credentials.completed");
  }
  return t("common.notRecorded");
}

function statusBadgeLabel(status: string, t: ReturnType<typeof useT>): string {
  if (status === "expiring") return t("profile.credentials.badge.expiringSoon");
  if (status === "valid") return t("credentials.valid");
  if (status === "expired") return t("credentials.expired");
  if (status === "pending_review") return t("credentials.pendingReview");
  return status.replace(/_/g, " ");
}

type Props = {
  bottomInset?: number;
  showSectionHeader?: boolean;
};

export function ProfileCredentialsPanel({ bottomInset = 24, showSectionHeader = false }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const isDark = colors.scheme === "dark";

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["credentials", "me"],
    queryFn: listMyCredentials,
  });

  const summary = useMemo(
    () => ({
      valid: data.filter((item) => item.status === "valid").length,
      expiring: data.filter((item) => item.status === "expiring").length,
      expired: data.filter((item) => item.status === "expired").length,
    }),
    [data],
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
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      {showSectionHeader ? (
        <SettingsSection
          title={t("credentials.title")}
          description={t("settings.credentials.subtitle")}
          icon="award"
        />
      ) : null}
      <View style={styles.summaryRow}>
        <SummaryPill
          label={t("profile.credentials.summary.valid", { count: summary.valid })}
          backgroundColor="#DCFCE7"
          textColor="#15803D"
        />
        <SummaryPill
          label={t("profile.credentials.summary.expiring", { count: summary.expiring })}
          backgroundColor="#FEF3C7"
          textColor="#B45309"
        />
        <SummaryPill
          label={t("profile.credentials.summary.expired", { count: summary.expired })}
          backgroundColor="#FEE2E2"
          textColor="#B91C1C"
        />
      </View>

      <Pressable
        onPress={() => router.push("/worker/credentials/add" as never)}
        style={[styles.addBtn, { backgroundColor: colors.accent }]}
      >
        <Feather name="plus" size={16} color="#FFFFFF" />
        <Text style={[styles.addBtnText, { fontFamily: "Inter_700Bold" }]}>{t("credentials.add")}</Text>
      </Pressable>

      {data.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("credentials.empty")}
        </Text>
      ) : (
        <View style={styles.list}>
          {data.map((credential) => (
            <CredentialCard key={credential.id} credential={credential} isDark={isDark} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function SummaryPill({
  label,
  backgroundColor,
  textColor,
}: {
  label: string;
  backgroundColor: string;
  textColor: string;
}) {
  return (
    <View style={[styles.summaryPill, { backgroundColor }]}>
      <Text style={[styles.summaryText, { color: textColor, fontFamily: "Inter_700Bold" }]}>{label}</Text>
    </View>
  );
}

function CredentialCard({ credential, isDark }: { credential: Credential; isDark: boolean }) {
  const colors = useColors();
  const t = useT();
  const meta = statusMeta(credential.status);
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      onPress={() => setExpanded((value) => !value)}
      style={[
        styles.credentialCard,
        elevatedCardShadow(isDark),
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={[styles.statusBar, { backgroundColor: meta.bar }]} />
      <View style={styles.credentialBody}>
        <View style={styles.credentialTop}>
          <View style={styles.credentialCopy}>
            <Text style={[styles.credentialTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
              {credential.title}
            </Text>
            {credential.issuer ? (
              <Text style={[styles.credentialIssuer, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {credential.issuer}
              </Text>
            ) : null}
          </View>
          <View style={[styles.badge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.badgeText, { color: meta.color, fontFamily: "Inter_700Bold" }]}>
              {statusBadgeLabel(credential.status, t)}
            </Text>
          </View>
        </View>

        <View style={styles.credentialBottom}>
          <Text style={[styles.dateText, { color: meta.color, fontFamily: "Inter_600SemiBold" }]}>
            {formatCredentialDate(credential, t)}
          </Text>
          <Feather
            name={expanded ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.mutedForeground}
          />
        </View>

        {expanded ? (
          <View style={[styles.expandedBlock, { borderTopColor: colors.border }]}>
            {credential.credential_number ? (
              <Text style={[styles.expandedLine, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {t("profile.credentials.number", { number: credential.credential_number })}
              </Text>
            ) : null}
            {credential.file_url ? (
              <Text style={[styles.expandedLine, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {t("profile.credentials.documentOnFile")}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  error: { fontSize: 14, textAlign: "center" },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },
  summaryRow: { flexDirection: "row", gap: 10 },
  summaryPill: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  summaryText: { fontSize: 13, textAlign: "center" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 14,
  },
  addBtnText: { color: "#FFFFFF", fontSize: 14 },
  empty: { fontSize: 14, textAlign: "center", paddingTop: 24 },
  list: { gap: 12 },
  credentialCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    flexDirection: "row",
  },
  statusBar: { width: 4 },
  credentialBody: { flex: 1, paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  credentialTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  credentialCopy: { flex: 1, gap: 4 },
  credentialTitle: { fontSize: 15, lineHeight: 20 },
  credentialIssuer: { fontSize: 13, lineHeight: 18 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11 },
  credentialBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dateText: { fontSize: 12 },
  expandedBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    gap: 4,
  },
  expandedLine: { fontSize: 12, lineHeight: 18 },
});

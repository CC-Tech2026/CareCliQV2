import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { listMyCredentials, type Credential } from "@/lib/resource-api";
import { getWorkerProfile } from "@/lib/user-api";

function daysUntil(expiry?: string | null): number | null {
  if (!expiry) return null;
  const end = new Date(`${expiry}T00:00:00`);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
}

function credentialBadge(
  credential: Credential,
  t: ReturnType<typeof useT>,
): { label: string; color: string; bg: string } {
  if (credential.status === "valid") {
    return { label: t("credentials.valid"), color: "#15803D", bg: "#DCFCE7" };
  }
  if (credential.status === "expiring") {
    const days = daysUntil(credential.expiry_date);
    return {
      label: days != null && days >= 0 ? t("settings.account.daysLeft", { days: String(days) }) : t("profile.credentials.badge.expiringSoon"),
      color: "#C2410C",
      bg: "#FFEDD5",
    };
  }
  if (credential.status === "expired" || credential.status === "rejected") {
    return { label: t("credentials.expired"), color: "#B91C1C", bg: "#FEE2E2" };
  }
  return { label: t("credentials.pendingReview"), color: "#3730A3", bg: "#EEF0FF" };
}

function DetailRow({
  icon,
  label,
  value,
  onPress,
  showDivider = true,
  trailing,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  showDivider?: boolean;
  trailing?: React.ReactNode;
}) {
  const colors = useColors();
  const content = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: colors.soft }]}>
        <Feather name={icon} size={15} color={colors.primary} />
      </View>
      <View style={styles.rowCopy}>
        {value ? (
          <>
            <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
              {label}
            </Text>
            <Text style={[styles.rowValue, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
              {value}
            </Text>
          </>
        ) : (
          <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
            {label}
          </Text>
        )}
      </View>
      {trailing ?? (onPress ? <Feather name="chevron-right" size={15} color={colors.mutedForeground} /> : null)}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          showDivider && { borderBottomColor: colors.soft, borderBottomWidth: 1 },
          pressed && { backgroundColor: colors.soft },
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View style={[styles.row, showDivider && { borderBottomColor: colors.soft, borderBottomWidth: 1 }]}>
      {content}
    </View>
  );
}

type Props = {
  bottomInset?: number;
};

export function SettingsAccountPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { user, isAuthenticated } = useAuth();

  const credentialsQuery = useQuery({
    queryKey: ["credentials", "me"],
    queryFn: listMyCredentials,
    enabled: isAuthenticated,
  });
  const profileQuery = useQuery({
    queryKey: ["users", "me"],
    queryFn: getWorkerProfile,
    enabled: isAuthenticated,
  });

  const credentials = credentialsQuery.data ?? [];
  const phone = profileQuery.data?.phone?.trim() || "";
  const email = profileQuery.data?.email?.trim() || user?.email?.trim() || "";
  const emergency = profileQuery.data?.emergency_contact;
  const emergencyLabel =
    typeof emergency === "string"
      ? emergency.trim() || t("settings.account.emergencyContact")
      : emergency?.name?.trim()
        ? emergency.name.trim()
        : t("settings.account.emergencyContact");

  const credentialRows = useMemo(() => credentials.slice(0, 8), [credentials]);

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
          {t("settings.account.section.credentials")}
        </Text>
        <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {credentialsQuery.isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : credentialRows.length === 0 ? (
            <Pressable
              onPress={() => router.push("/credentials" as never)}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.soft }]}
            >
              <View style={[styles.rowIcon, { backgroundColor: colors.soft }]}>
                <Feather name="award" size={15} color={colors.primary} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular", flex: 1 }]}>
                {t("settings.account.noCredentials")}
              </Text>
              <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
            </Pressable>
          ) : (
            credentialRows.map((credential, index) => {
              const badge = credentialBadge(credential, t);
              return (
                <Pressable
                  key={credential.id}
                  onPress={() => router.push("/credentials" as never)}
                  style={({ pressed }) => [
                    styles.row,
                    index < credentialRows.length - 1 && { borderBottomColor: colors.soft, borderBottomWidth: 1 },
                    pressed && { backgroundColor: colors.soft },
                  ]}
                >
                  <View style={[styles.rowIcon, { backgroundColor: colors.soft }]}>
                    <Feather name="award" size={15} color={colors.primary} />
                  </View>
                  <Text
                    style={[styles.rowLabel, { color: colors.foreground, fontFamily: "Inter_400Regular", flex: 1 }]}
                    numberOfLines={1}
                  >
                    {credential.title}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeText, { color: badge.color, fontFamily: "Inter_600SemiBold" }]}>
                      {badge.label}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
          {t("settings.account.section.details")}
        </Text>
        <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <DetailRow
            icon="phone"
            label={t("settings.contact.title")}
            value={phone || t("settings.account.noPhone")}
            onPress={() => router.push("/(tabs)/settings/contact" as never)}
            showDivider
          />
          <DetailRow
            icon="mail"
            label={email || t("settings.account.noEmail")}
            showDivider
          />
          <DetailRow
            icon="alert-circle"
            label={t("settings.account.emergencyContact")}
            value={emergencyLabel !== t("settings.account.emergencyContact") ? emergencyLabel : undefined}
            onPress={() => router.push("/(tabs)/settings/emergency-contact" as never)}
            showDivider
          />
          <DetailRow
            icon="edit-3"
            label={t("settings.signature.label")}
            onPress={() => router.push("/(tabs)/settings/signature" as never)}
            showDivider={false}
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 18 },
  group: { gap: 8 },
  groupTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    paddingHorizontal: 4,
  },
  groupCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 56,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 15, lineHeight: 20 },
  rowValue: { fontSize: 12, lineHeight: 16 },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11 },
  loadingRow: { paddingVertical: 24, alignItems: "center" },
});

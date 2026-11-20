import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FontFamily } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { formatDayKey } from "@/hooks/worker/useWorkerCalendar";
import { useColors } from "@/hooks/useColors";
import { listMyCredentials } from "@/lib/resource-api";
import { getWorkerProfile } from "@/lib/user-api";

function Row({
  icon,
  label,
  value,
  valueTone = "muted",
  onPress,
  last = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value?: string;
  valueTone?: "muted" | "warning" | "danger";
  onPress: () => void;
  last?: boolean;
}) {
  const colors = useColors();
  const tone =
    valueTone === "danger"
      ? colors.destructive
      : valueTone === "warning"
        ? colors.warning
        : colors.mutedForeground;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && {
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        pressed && { backgroundColor: colors.soft },
      ]}
    >
      <View style={[styles.rowIcon, { backgroundColor: colors.soft }]}>
        <Feather name={icon} size={17} color={colors.primary} />
      </View>
      <View style={styles.rowCopy}>
        <Text
          style={[
            styles.rowLabel,
            { color: colors.foreground, fontFamily: FontFamily.interMedium },
          ]}
        >
          {label}
        </Text>
        {value ? (
          <Text
            numberOfLines={1}
            style={[
              styles.rowValue,
              { color: tone, fontFamily: FontFamily.interRegular },
            ]}
          >
            {value}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

type Props = {
  bottomInset?: number;
};

/**
 * Account details: one short list. Personal details all live in My profile;
 * the rest are single rows that open their own screen.
 */
export function SettingsAccountPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { isAuthenticated } = useAuth();

  const profile = useQuery({
    queryKey: ["users", "me"],
    queryFn: getWorkerProfile,
    enabled: isAuthenticated,
  });
  const credentials = useQuery({
    queryKey: ["credentials", "me"],
    queryFn: listMyCredentials,
    enabled: isAuthenticated,
  });

  const p = profile.data;
  const emergency = p?.emergency_contact;
  const emergencyName =
    typeof emergency === "string"
      ? emergency.trim()
      : emergency?.name?.trim() || "";
  const profileSummary = [p?.phone?.trim(), p?.suburb?.trim()]
    .filter(Boolean)
    .join("  ·  ");

  const list = credentials.data ?? [];
  const expired = list.filter(
    (c) => c.status === "expired" || c.status === "rejected",
  ).length;
  const expiring = list.filter((c) => c.status === "expiring").length;
  const credentialLine =
    expired > 0
      ? t("account.credentials.expired", { count: String(expired) })
      : expiring > 0
        ? t("account.credentials.expiring", { count: String(expiring) })
        : list.length > 0
          ? t("account.credentials.allValid", { count: String(list.length) })
          : t("account.credentials.none");

  const card = [
    styles.card,
    { backgroundColor: colors.card, borderColor: colors.border },
  ];
  const title = [
    styles.groupTitle,
    { color: colors.mutedForeground, fontFamily: FontFamily.interSemiBold },
  ];

  return (
    <ScrollView
      contentContainerStyle={[
        styles.scroll,
        { paddingBottom: insets.bottom + bottomInset },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.group}>
        <Text style={title}>{t("account.section.you")}</Text>
        <View style={card}>
          <Row
            icon="user"
            label={t("myProfile.title")}
            value={profileSummary || t("myProfile.rowHint")}
            onPress={() => router.push("/(tabs)/settings/profile" as never)}
          />
          <Row
            icon="life-buoy"
            label={t("settings.account.emergencyContact")}
            value={emergencyName || t("account.notAdded")}
            valueTone={emergencyName ? "muted" : "warning"}
            onPress={() =>
              router.push("/(tabs)/settings/emergency-contact" as never)
            }
          />
          <Row
            icon="gift"
            label={t("birthday.settings.title")}
            value={
              p?.date_of_birth
                ? formatDayKey(p.date_of_birth, {
                    day: "numeric",
                    month: "long",
                  })
                : t("account.notAdded")
            }
            onPress={() => router.push("/(tabs)/settings/birthday" as never)}
          />
          <Row
            icon="edit-3"
            label={t("settings.signature.label")}
            onPress={() => router.push("/(tabs)/settings/signature" as never)}
            last
          />
        </View>
      </View>

      <View style={styles.group}>
        <Text style={title}>{t("account.section.work")}</Text>
        <View style={card}>
          <Row
            icon="award"
            label={t("nav.credentials")}
            value={credentialLine}
            valueTone={
              expired > 0 ? "danger" : expiring > 0 ? "warning" : "muted"
            }
            onPress={() => router.push("/credentials" as never)}
          />
          <Row
            icon="book-open"
            label={t("nav.training")}
            onPress={() => router.push("/training" as never)}
            last
          />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 20 },
  group: { gap: 8 },
  groupTitle: { fontSize: 13, paddingHorizontal: 4 },
  card: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 64,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { fontSize: 16, lineHeight: 21 },
  rowValue: { fontSize: 13, lineHeight: 18 },
});

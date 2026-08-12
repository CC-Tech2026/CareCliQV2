import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { UserNotification } from "@/lib/worker-api";

function notificationIcon(eventType: string): keyof typeof Feather.glyphMap {
  if (eventType.includes("incident")) return "alert-triangle";
  if (eventType.includes("compliance") || eventType.includes("checkin")) return "shield";
  if (eventType.includes("shift") || eventType.includes("schedule")) return "calendar";
  if (eventType.includes("message")) return "message-circle";
  return "bell";
}

type Props = {
  item: UserNotification;
  onDismiss: (id: string) => void;
  onPress: () => void;
};

export function NotificationListItem({ item, onDismiss, onPress }: Props) {
  const colors = useColors();
  const t = useT();
  const isDark = colors.scheme === "dark";
  const unread = !item.read_at && !item.dismissed_at;
  const icon = notificationIcon(item.event_type);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        elevatedCardShadow(isDark),
        {
          backgroundColor: colors.card,
          borderColor: unread ? colors.primary : colors.border,
          opacity: pressed ? 0.92 : 1,
        },
      ]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: unread ? colors.activeBg : colors.soft }]}>
          <Feather name={icon} size={16} color={unread ? colors.primary : colors.mutedForeground} />
        </View>
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
              numberOfLines={2}
            >
              {item.title}
            </Text>
            {unread ? <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} /> : null}
          </View>
          <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {item.body}
          </Text>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Text style={[styles.time, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {new Date(item.created_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}
        </Text>
        {!item.dismissed_at ? (
          <Pressable onPress={() => onDismiss(item.id)} hitSlop={8}>
            <Text style={[styles.dismiss, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
              {t("notifications.dismiss")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 6 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, fontSize: 14, lineHeight: 20 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  body: { fontSize: 13, lineHeight: 19 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  time: { fontSize: 11, letterSpacing: 0.3, textTransform: "uppercase" },
  dismiss: { fontSize: 12 },
});

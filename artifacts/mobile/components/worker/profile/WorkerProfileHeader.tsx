import { Image } from "expo-image";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { formatProfileSubtitle, formatWorkerRole } from "@/components/worker/profile/profile-ui";
import { FontFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import type { WorkerProfile } from "@/lib/user-api";
import { shiftInitials } from "@/lib/shift-utils";

type Props = {
  profile?: WorkerProfile | null;
  fallbackName?: string | null;
  fallbackRole?: string | null;
};

export function WorkerProfileHeader({ profile, fallbackName, fallbackRole }: Props) {
  const colors = useColors();
  const displayName = profile?.full_name ?? fallbackName ?? "Worker";
  const role = formatWorkerRole(profile?.membership_role ?? profile?.role ?? fallbackRole);
  const subtitle = formatProfileSubtitle([
    role,
    profile?.business_name,
    profile?.employee_id ? profile.employee_id : null,
  ]);

  return (
    <View style={[styles.wrap, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
      <View style={[styles.avatarShell, { backgroundColor: colors.activeBg, borderColor: colors.border }]}>
        {profile?.profile_photo_url ? (
          <Image source={{ uri: profile.profile_photo_url }} style={styles.avatarImage} contentFit="cover" />
        ) : (
          <Text style={[styles.avatarText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
            {shiftInitials(displayName)}
          </Text>
        )}
      </View>
      <View style={styles.textBlock}>
        <Text style={[styles.name, { color: colors.foreground, fontFamily: FontFamily.h1 }]} numberOfLines={1}>
          {displayName}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarShell: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: 52, height: 52 },
  avatarText: { fontSize: 17 },
  textBlock: { flex: 1, gap: 4 },
  name: { fontSize: 18, letterSpacing: -0.2, lineHeight: 22 },
  subtitle: { fontSize: 13, lineHeight: 18 },
});

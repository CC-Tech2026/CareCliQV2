import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

type Props = {
  title?: string;
  subtitle?: string;
  showSignOut?: boolean;
};

export function WorkerPageSubheader({ title, subtitle, showSignOut = false }: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const { logout } = useAuth();

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      {title ? (
        <Text style={[styles.title, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>{title}</Text>
      ) : null}
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {subtitle}
        </Text>
      ) : null}
      {showSignOut ? (
        <Pressable
          onPress={() => void logout().then(() => router.replace("/login" as never))}
          style={styles.signOutBtn}
        >
          <Feather name="log-out" size={16} color={colors.mutedForeground} />
          <Text style={[styles.signOutText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            {t("common.signOut")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, marginTop: 2 },
  signOutBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  signOutText: { fontSize: 13 },
});

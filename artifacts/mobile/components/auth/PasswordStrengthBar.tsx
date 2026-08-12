import React from "react";
import { StyleSheet, Text, View } from "react-native";

import type { AuthColors } from "@/constants/auth-colors";
import { usePreferences } from "@/context/PreferencesContext";

const BAR_COLORS = ["#EF4444", "#F97316", "#FBBF24", "#22C55E"];

function getScore(password: string): number {
  let score = 0;
  if (password.length >= 10) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

export function PasswordStrengthBar({ password, auth }: { password: string; auth: AuthColors }) {
  const { t } = usePreferences();
  const score = getScore(password);
  const labels = [
    t("auth.signup.passwordWeak"),
    t("auth.signup.passwordFair"),
    t("auth.signup.passwordGood"),
    t("auth.signup.passwordStrong"),
  ];

  if (!password) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {Array.from({ length: 4 }, (_, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { backgroundColor: i < score ? BAR_COLORS[score - 1] : auth.inputBorder },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.label, { color: BAR_COLORS[Math.max(score - 1, 0)], fontFamily: "Inter_500Medium" }]}>
        {labels[Math.max(score - 1, 0)]}
      </Text>
      <Text style={[styles.hint, { color: auth.muted, fontFamily: "Inter_400Regular" }]}>
        {t("auth.signup.passwordHint")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 10 },
  bars: { flexDirection: "row", gap: 6 },
  bar: { flex: 1, height: 6, borderRadius: 999 },
  label: { fontSize: 11 },
  hint: { fontSize: 11, lineHeight: 15 },
});

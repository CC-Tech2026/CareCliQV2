import { FontFamily } from "@/constants/typography";
import { Image } from "expo-image";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { getAuthColors } from "@/constants/auth-colors";
import { usePreferences } from "@/context/PreferencesContext";

type Props = {
  compact?: boolean;
  taglineKey: "auth.login.marketing.tagline" | "auth.signup.marketing.tagline";
};

export function AuthBrandHeader({ taglineKey, compact = false }: Props) {
  const { resolvedScheme, t } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: auth.marketingBg },
        compact && styles.compactWrap,
      ]}
    >
      <Image
        source={require("@/assets/images/logo.png")}
        style={[styles.logo, compact && styles.compactLogo]}
        contentFit="contain"
        accessibilityLabel="CareCliQ"
      />
      <Text
        style={[
          styles.tagline,
          compact && styles.compactTagline,
          { color: auth.marketingMuted, fontFamily: FontFamily.interBold },
        ]}
      >
        {compact ? t(taglineKey) : t(taglineKey).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  compactWrap: {
    paddingHorizontal: 0,
    paddingTop: 14,
    paddingBottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
  },
  compactLogo: { width: 100, height: 44 },
  compactTagline: { flexShrink: 1, letterSpacing: 0, textAlign: "right" },
  wrap: {
    paddingHorizontal: 24,
    paddingTop: 24,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    paddingBottom: 20,
    gap: 8,
  },
  logo: {
    width: 96,
    height: 64,
  },
  tagline: {
    fontSize: 12,
    letterSpacing: 1.1,
  },
});

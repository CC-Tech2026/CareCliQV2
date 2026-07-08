import { Image } from "expo-image";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { getAuthColors } from "@/constants/auth-colors";
import { usePreferences } from "@/context/PreferencesContext";

type Props = {
  taglineKey: "auth.login.marketing.tagline" | "auth.signup.marketing.tagline";
};

export function AuthBrandHeader({ taglineKey }: Props) {
  const { resolvedScheme, t } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  return (
    <View style={[styles.wrap, { backgroundColor: auth.marketingBg }]}>
      <Image
        source={require("@/assets/images/logo.png")}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel="CareCliQ"
      />
      <Text style={[styles.tagline, { color: auth.marketingMuted, fontFamily: "Inter_700Bold" }]}>
        {t(taglineKey).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 20,
    gap: 8,
  },
  logo: {
    width: 96,
    height: 64,
  },
  tagline: {
    fontSize: 10,
    letterSpacing: 2.2,
  },
});

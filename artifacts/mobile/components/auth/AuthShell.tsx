import { Image } from "expo-image";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { KeyboardAvoidingViewCompat } from "@/components/KeyboardAvoidingViewCompat";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { getAuthColors } from "@/constants/auth-colors";
import { usePreferences } from "@/context/PreferencesContext";

type Props = {
  children: React.ReactNode;
  /** Small print pinned to the bottom of the screen. */
  footer?: React.ReactNode;
};

/**
 * The frame shared by sign in, activate account and forgot password.
 * The page uses the splash screen's warm canvas, so the logo the splash ends
 * on carries straight into this screen, sitting on the page with no box.
 */
export function AuthShell({ children, footer }: Props) {
  const { resolvedScheme } = usePreferences();
  const auth = getAuthColors(resolvedScheme);
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingViewCompat
      style={[styles.root, { backgroundColor: auth.shellBg }]}
      behavior="padding"
    >
      <View style={[styles.toggle, { top: insets.top + 10 }]}>
        <AuthThemeToggle variant="icon" />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 },
        ]}
      >
        <View style={styles.column}>
          <View style={styles.brand}>
            <Image
              source={require("@/assets/animate/carecliq-logo-final.png")}
              style={styles.logo}
              contentFit="contain"
              accessibilityLabel="CareCliQ"
            />
            {/* The logo's two colours as a short rule, pink leading. */}
            <View
              style={styles.rule}
              importantForAccessibility="no-hide-descendants"
            >
              <View
                style={[styles.ruleLong, { backgroundColor: auth.coral }]}
              />
              <View
                style={[styles.ruleShort, { backgroundColor: auth.plum }]}
              />
            </View>
          </View>

          {children}

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingViewCompat>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toggle: { position: "absolute", right: 16, zIndex: 20 },
  scroll: { flexGrow: 1, paddingHorizontal: 24 },
  column: { flexGrow: 1, width: "100%", maxWidth: 460, alignSelf: "center" },
  brand: { alignItems: "center", marginBottom: 24 },
  logo: { width: 210, height: 196 },
  rule: { flexDirection: "row", gap: 4, marginTop: -10 },
  ruleLong: { width: 28, height: 4, borderRadius: 2 },
  ruleShort: { width: 12, height: 4, borderRadius: 2 },
  footer: { marginTop: "auto", paddingTop: 32 },
});

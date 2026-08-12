import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { getAuthColors } from "@/constants/auth-colors";
import { usePreferences } from "@/context/PreferencesContext";
import { requestPasswordReset } from "@/lib/auth-api";

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { resolvedScheme, t } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.forgot.error.sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: auth.shellBg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.themeToggle, { top: insets.top + 8 }]}>
        <AuthThemeToggle />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandRow}>
          <Image source={require("@/assets/images/logo.png")} style={styles.logo} contentFit="contain" />
          <View style={[styles.brandDivider, { backgroundColor: auth.inputBorder }]} />
          <Text style={[styles.workspace, { color: auth.marketingMuted, fontFamily: "Inter_700Bold" }]}>
            {t("auth.forgot.workspace").toUpperCase()}
          </Text>
        </View>

        <Pressable onPress={() => router.replace("/login" as never)} style={styles.backLink}>
          <Feather name="arrow-left" size={14} color={auth.plum} />
          <Text style={[styles.backLinkText, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
            {t("auth.forgot.backToLogin")}
          </Text>
        </Pressable>

        <View style={styles.intro}>
          <Text style={[styles.title, { color: auth.text, fontFamily: "Inter_700Bold" }]}>
            {t("auth.forgot.title")}
          </Text>
          <Text style={[styles.subtitle, { color: auth.muted, fontFamily: "Inter_500Medium" }]}>
            {t("auth.forgot.subtitle")}
          </Text>
        </View>

        {sent ? (
          <View style={[styles.successCard, { borderColor: auth.inputBorder, backgroundColor: auth.inputBg }]}>
            <Feather name="check-circle" size={32} color={auth.plum} />
            <Text style={[styles.successTitle, { color: auth.text, fontFamily: "Inter_700Bold" }]}>
              {t("auth.forgot.checkEmail")}
            </Text>
            <Text style={[styles.successBody, { color: auth.muted, fontFamily: "Inter_400Regular" }]}>
              {t("auth.forgot.sentMessage")}
            </Text>
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={[styles.label, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
              {t("auth.forgot.email").toUpperCase()}
            </Text>
            <View style={[styles.inputWrap, { backgroundColor: auth.inputBg, borderColor: auth.inputBorder }]}>
              <Feather name="mail" size={16} color={auth.muted} style={styles.inputIcon} />
              <TextInput
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  if (error) setError(null);
                }}
                placeholder={t("auth.forgot.emailPlaceholder")}
                placeholderTextColor={auth.muted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!busy}
                style={[styles.input, { color: auth.text, fontFamily: "Inter_500Medium" }]}
              />
            </View>
            {error ? (
              <Text style={[styles.error, { color: auth.coral, fontFamily: "Inter_500Medium" }]}>{error}</Text>
            ) : null}
            <Pressable
              onPress={handleSubmit}
              disabled={busy || !email.trim()}
              style={[styles.submitBtn, { backgroundColor: auth.cta, opacity: busy || !email.trim() ? 0.4 : 1 }]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>{t("auth.forgot.submit")}</Text>
              )}
            </Pressable>
          </View>
        )}

        <Text style={[styles.footer, { color: auth.footer, fontFamily: "Inter_500Medium" }]}>
          {t("auth.forgot.footer")}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  themeToggle: { position: "absolute", right: 16, zIndex: 20 },
  scroll: { paddingHorizontal: 24, gap: 20 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 54, height: 36 },
  brandDivider: { width: 1, height: 16 },
  workspace: { fontSize: 10, letterSpacing: 2 },
  backLink: { flexDirection: "row", alignItems: "center", gap: 6 },
  backLinkText: { fontSize: 12 },
  intro: { gap: 6 },
  title: { fontSize: 26, letterSpacing: -0.3 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  form: { gap: 12 },
  label: { fontSize: 11, letterSpacing: 0.8 },
  inputWrap: {
    height: 48,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 14 },
  error: { fontSize: 12 },
  submitBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  submitText: { color: "#FFFFFF", fontSize: 15 },
  successCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    gap: 8,
  },
  successTitle: { fontSize: 15, marginTop: 4 },
  successBody: { fontSize: 13, lineHeight: 19 },
  footer: { fontSize: 11, lineHeight: 16, marginTop: 12 },
});

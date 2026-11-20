import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AuthShell } from "@/components/auth/AuthShell";
import { FontFamily } from "@/constants/typography";
import { getAuthColors } from "@/constants/auth-colors";
import { usePreferences } from "@/context/PreferencesContext";
import { requestPasswordReset } from "@/lib/auth-api";

export default function ForgotPasswordScreen() {
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
      setError(
        err instanceof Error ? err.message : t("auth.forgot.error.sendFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <View style={styles.stack}>
        <Pressable
          onPress={() => router.replace("/login" as never)}
          style={styles.backLink}
          accessibilityRole="link"
        >
          <Feather name="arrow-left" size={16} color={auth.plum} />
          <Text
            style={[
              styles.backLinkText,
              { color: auth.plum, fontFamily: FontFamily.interSemiBold },
            ]}
          >
            {t("auth.forgot.backToLogin")}
          </Text>
        </Pressable>

        <View style={styles.intro}>
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              { color: auth.text, fontFamily: FontFamily.display },
            ]}
          >
            {t("auth.forgot.title")}
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: auth.muted, fontFamily: FontFamily.interRegular },
            ]}
          >
            {t("auth.forgot.subtitle")}
          </Text>
        </View>

        {sent ? (
          <View
            style={[styles.successCard, { backgroundColor: auth.noticeBg }]}
          >
            <Feather name="check-circle" size={28} color={auth.plum} />
            <Text
              style={[
                styles.successTitle,
                { color: auth.text, fontFamily: FontFamily.interSemiBold },
              ]}
            >
              {t("auth.forgot.checkEmail")}
            </Text>
            <Text
              style={[
                styles.successBody,
                { color: auth.muted, fontFamily: FontFamily.interRegular },
              ]}
            >
              {t("auth.forgot.sentMessage")}
            </Text>
          </View>
        ) : (
          <View style={styles.form}>
            <Text
              style={[
                styles.label,
                { color: auth.text, fontFamily: FontFamily.interSemiBold },
              ]}
            >
              {t("auth.forgot.email")}
            </Text>
            <View
              style={[
                styles.inputWrap,
                {
                  backgroundColor: auth.inputBg,
                  borderColor: error ? auth.error : auth.inputBorder,
                },
              ]}
            >
              <Feather
                name="mail"
                size={18}
                color={auth.muted}
                style={styles.inputIcon}
              />
              <TextInput
                accessibilityLabel={t("auth.forgot.email")}
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
                returnKeyType="send"
                onSubmitEditing={() => void handleSubmit()}
                style={[
                  styles.input,
                  { color: auth.text, fontFamily: FontFamily.interMedium },
                ]}
              />
            </View>
            {error ? (
              <Text
                style={[
                  styles.error,
                  { color: auth.error, fontFamily: FontFamily.interMedium },
                ]}
              >
                {error}
              </Text>
            ) : null}
            <Pressable
              onPress={handleSubmit}
              disabled={busy || !email.trim()}
              accessibilityRole="button"
              style={[
                styles.submitBtn,
                {
                  backgroundColor: auth.cta,
                  opacity: busy || !email.trim() ? 0.4 : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text
                  style={[
                    styles.submitText,
                    { fontFamily: FontFamily.interSemiBold },
                  ]}
                >
                  {t("auth.forgot.submit")}
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 20, flexGrow: 1 },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    minHeight: 32,
  },
  backLinkText: { fontSize: 15 },
  intro: { gap: 8, alignItems: "center" },
  title: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 320,
  },
  form: { gap: 8 },
  label: { fontSize: 14 },
  inputWrap: {
    height: 54,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 16, height: "100%" },
  error: { fontSize: 13 },
  submitBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  submitText: { color: "#FFFFFF", fontSize: 16 },
  successCard: { borderRadius: 16, padding: 20, gap: 8 },
  successTitle: { fontSize: 17, marginTop: 4 },
  successBody: { fontSize: 15, lineHeight: 22 },
});

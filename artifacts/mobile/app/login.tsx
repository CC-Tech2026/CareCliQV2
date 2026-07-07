import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, completeMfa } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    setBusy(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const result = await login(identifier.trim(), password);
      if (result.status === "mfa_required") {
        setMfaChallenge(result.challengeToken);
        return;
      }
      router.replace("/(tabs)" as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBusy(false);
    }
  };

  const handleMfa = async () => {
    if (!mfaChallenge || !mfaCode.trim()) {
      setError("Enter your verification code.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await completeMfa(mfaChallenge, mfaCode.trim());
      router.replace("/(tabs)" as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid verification code");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad + 32, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={styles.logo}
            contentFit="contain"
            accessibilityLabel="CareCliQ"
          />
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            CareCliQ
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {mfaChallenge ? "Enter verification code" : "Sign in to your worker account"}
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {mfaChallenge ? (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                VERIFICATION CODE
              </Text>
              <TextInput
                value={mfaCode}
                onChangeText={setMfaCode}
                placeholder="000000"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, fontFamily: "Inter_500Medium" }]}
              />
              <Pressable
                onPress={handleMfa}
                disabled={busy}
                style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>Verify</Text>
                )}
              </Pressable>
              <Pressable onPress={() => { setMfaChallenge(null); setMfaCode(""); setError(null); }}>
                <Text style={[styles.link, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                  Back to sign in
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                EMAIL OR USERNAME
              </Text>
              <TextInput
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="you@provider.com"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, fontFamily: "Inter_400Regular" }]}
              />

              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                PASSWORD
              </Text>
              <View style={[styles.passwordRow, { borderColor: colors.border }]}>
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  style={[styles.passwordInput, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </Pressable>
              </View>

              {error ? (
                <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_500Medium" }]}>
                  {error}
                </Text>
              ) : null}

              <Pressable
                onPress={handleLogin}
                disabled={busy}
                style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>Sign In</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, gap: 24 },
  brand: { alignItems: "center", gap: 8 },
  logo: {
    width: 120,
    height: 80,
    marginBottom: 4,
  },
  title: { fontSize: 32, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, textAlign: "center" },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  label: { fontSize: 11, letterSpacing: 0.8, marginTop: 4 },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 14,
  },
  passwordInput: { flex: 1, fontSize: 15 },
  eyeBtn: { padding: 4 },
  error: { fontSize: 13 },
  submitBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  submitText: { color: "#FFFFFF", fontSize: 16 },
  link: { fontSize: 14, textAlign: "center", marginTop: 8 },
});

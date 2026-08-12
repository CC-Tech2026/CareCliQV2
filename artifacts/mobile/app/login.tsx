import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

import { AuthBrandHeader } from "@/components/auth/AuthBrandHeader";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { OtpInput } from "@/components/auth/OtpInput";
import { getAuthColors } from "@/constants/auth-colors";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import * as Haptics from "@/lib/haptics";
import {
  authenticateWithBiometrics,
  canUseBiometricLogin,
  isBiometricHardwareAvailable,
  readBiometricCredentials,
} from "@/lib/biometric-auth";
import { validateLoginIdentifier } from "@/lib/auth-login-validation";
import { WorkerApiError } from "@/lib/worker-fetch";

const LOGIN_NETWORK_MAX_ATTEMPTS = 3;

function isNetworkLoginError(err: unknown): boolean {
  if (err instanceof WorkerApiError && err.status === 0) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /network request failed|failed to fetch|network error|timed out|econnrefused|enotfound/i.test(msg);
}

async function withNetworkRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= LOGIN_NETWORK_MAX_ATTEMPTS; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      if (!isNetworkLoginError(err) || i >= LOGIN_NETWORK_MAX_ATTEMPTS) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * i));
    }
  }
  throw lastErr;
}

function AuthField({
  label,
  error,
  valid,
  right,
  children,
}: {
  label: string;
  error?: string | null;
  valid?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { resolvedScheme } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={[styles.fieldLabel, { color: auth.muted, fontFamily: "Inter_700Bold" }]}>
          {label.toUpperCase()}
        </Text>
        {right}
      </View>
      <View style={styles.fieldInputWrap}>
        {children}
        {valid && !error ? (
          <Text style={[styles.validMark, { color: auth.valid }]}>✓</Text>
        ) : null}
      </View>
      {error ? (
        <Text style={[styles.fieldError, { color: auth.error, fontFamily: "Inter_500Medium" }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function AuthCheckbox({
  checked,
  onToggle,
  label,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  const { resolvedScheme } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  return (
    <Pressable onPress={onToggle} disabled={disabled} style={styles.checkboxRow}>
      <View
        style={[
          styles.checkbox,
          {
            borderColor: checked ? auth.plum : auth.inputBorder,
            backgroundColor: checked ? auth.plum : "transparent",
          },
        ]}
      >
        {checked ? <Feather name="check" size={12} color="#FFFFFF" /> : null}
      </View>
      <Text style={[styles.checkboxLabel, { color: auth.muted, fontFamily: "Inter_500Medium" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, completeMfa } = useAuth();
  const { resolvedScheme, t } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [identifierError, setIdentifierError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [mfaCodeError, setMfaCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
  const [pendingCreds, setPendingCreds] = useState<{ identifier: string; password: string } | null>(null);
  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricHardware, setBiometricHardware] = useState(false);

  const mfaStep = Boolean(mfaChallenge);
  const identifierOk = !validateLoginIdentifier(identifier) && identifier.trim().length > 0;
  const mfaComplete = mfaCode.length === 6;

  const refreshBiometric = useCallback(async () => {
    const [ready, hardware] = await Promise.all([
      canUseBiometricLogin(),
      isBiometricHardwareAvailable(),
    ]);
    setBiometricReady(ready);
    setBiometricHardware(hardware);
  }, []);

  useEffect(() => {
    void refreshBiometric();
  }, [refreshBiometric]);

  const finishAuthenticated = () => {
    router.replace("/(tabs)" as never);
  };

  const showLoginError = (err: unknown) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (isNetworkLoginError(err)) {
      Alert.alert(
        t("auth.login.error.signInFailed"),
        t("auth.login.error.networkContactAdmin"),
      );
      setPasswordError(null);
      return;
    }
    const msg = err instanceof Error ? err.message : t("auth.login.error.invalidCredentials");
    Alert.alert(t("auth.login.error.signInFailed"), msg);
    setPasswordError(null);
  };

  const handleSignIn = async () => {
    const idErr = validateLoginIdentifier(identifier);
    const pwdErr = !password.trim() ? t("auth.login.error.passwordRequired") : null;
    setIdentifierError(idErr);
    setPasswordError(pwdErr);
    if (idErr || pwdErr) return;

    setBusy(true);
    setPasswordError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const result = await withNetworkRetry(() =>
        login(identifier.trim(), password, rememberDevice),
      );
      if (result.status === "mfa_required") {
        setPendingCreds({ identifier: identifier.trim(), password });
        setMfaChallenge(result.challengeToken);
        setMfaCode("");
        setTrustDevice(true);
        return;
      }
      finishAuthenticated();
    } catch (err) {
      showLoginError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleBiometricLogin = async (preferred: "face" | "fingerprint" = "fingerprint") => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const method =
      preferred === "face"
        ? t("settings.biometric.face")
        : t("settings.biometric.fingerprint");

    if (!biometricHardware) {
      Alert.alert(
        t("auth.login.biometricUnavailableTitle"),
        t("auth.login.biometricUnavailableMessage"),
      );
      return;
    }

    if (!biometricReady) {
      Alert.alert(
        t("auth.login.biometricSetupTitle", { method }),
        t("auth.login.biometricSetupMessage", { method }),
      );
      return;
    }

    setBusy(true);
    setPasswordError(null);
    try {
      const ok = await authenticateWithBiometrics(
        t("auth.login.biometricPrompt", { method }),
      );
      if (!ok) {
        Alert.alert(t("auth.login.error.signInFailed"), t("auth.login.biometricCancelled"));
        setBusy(false);
        return;
      }
      const creds = await readBiometricCredentials();
      if (!creds) {
        Alert.alert(t("auth.login.error.signInFailed"), t("auth.login.biometricMissingCreds"));
        setBusy(false);
        return;
      }
      const result = await withNetworkRetry(() =>
        login(creds.identifier, creds.password, true),
      );
      if (result.status === "mfa_required") {
        setPendingCreds(creds);
        setIdentifier(creds.identifier);
        setMfaChallenge(result.challengeToken);
        setMfaCode("");
        setTrustDevice(true);
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      finishAuthenticated();
    } catch (err) {
      showLoginError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleMfaSubmit = async () => {
    if (!mfaChallenge) return;
    if (!mfaCode.trim()) {
      setMfaCodeError(t("auth.login.error.mfaRequired"));
      return;
    }

    setBusy(true);
    setMfaCodeError(null);

    try {
      await completeMfa(mfaChallenge, mfaCode.trim(), trustDevice, pendingCreds ?? undefined);
      finishAuthenticated();
    } catch (err) {
      setMfaCodeError(err instanceof Error ? err.message : t("auth.login.error.invalidMfa"));
    } finally {
      setBusy(false);
    }
  };

  const resetMfa = () => {
    setMfaChallenge(null);
    setMfaCode("");
    setMfaCodeError(null);
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
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <AuthBrandHeader taglineKey="auth.login.marketing.tagline" />

        <View
          style={[
            styles.formPanel,
            {
              backgroundColor: auth.formBg,
              borderColor: auth.inputBorder,
            },
          ]}
        >
          <View style={styles.dragHandleWrap}>
            <View style={[styles.dragHandle, { backgroundColor: auth.dragHandle }]} />
          </View>

          <View style={styles.formBody}>
            <View style={styles.formIntro}>
              <Text style={[styles.formTitle, { color: auth.text, fontFamily: "Inter_700Bold" }]}>
                {mfaStep ? t("auth.login.mfaTitle") : t("auth.login.title")}
              </Text>
              <Text style={[styles.formSubtitle, { color: auth.muted, fontFamily: "Inter_500Medium" }]}>
                {mfaStep ? t("auth.login.mfaSubtitle") : t("auth.login.subtitle")}
              </Text>
            </View>

            {mfaStep ? (
              <View style={styles.formStack}>
                <Pressable onPress={resetMfa} style={styles.backLink}>
                  <Feather name="arrow-left" size={14} color={auth.plum} />
                  <Text style={[styles.backLinkText, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
                    {t("auth.login.backToSignIn")}
                  </Text>
                </Pressable>

                <View style={[styles.infoCard, { borderColor: auth.inputBorder, backgroundColor: auth.inputBg }]}>
                  <Feather name="shield" size={18} color={auth.plum} />
                  <Text style={[styles.infoText, { color: auth.muted, fontFamily: "Inter_500Medium" }]}>
                    {t("auth.login.mfaInfo")}
                  </Text>
                </View>

                <View>
                  <Text style={[styles.fieldLabel, { color: auth.muted, fontFamily: "Inter_700Bold", marginBottom: 12 }]}>
                    {t("auth.login.verificationCode").toUpperCase()}
                  </Text>
                  <OtpInput
                    value={mfaCode}
                    onChange={(value) => {
                      setMfaCode(value);
                      if (mfaCodeError) setMfaCodeError(null);
                    }}
                    disabled={busy}
                    error={Boolean(mfaCodeError)}
                    auth={auth}
                  />
                  {mfaCodeError ? (
                    <Text style={[styles.fieldError, { color: auth.error, fontFamily: "Inter_500Medium" }]}>
                      {mfaCodeError}
                    </Text>
                  ) : null}
                </View>

                <AuthCheckbox
                  checked={trustDevice}
                  onToggle={() => setTrustDevice((v) => !v)}
                  label={t("auth.login.trustDevice")}
                  disabled={busy}
                />

                <Pressable
                  onPress={handleMfaSubmit}
                  disabled={busy || !mfaComplete}
                  style={[
                    styles.submitBtn,
                    { backgroundColor: auth.cta, opacity: busy || !mfaComplete ? 0.4 : 1 },
                  ]}
                >
                  {busy ? (
                    <>
                      <ActivityIndicator color="#FFFFFF" size="small" />
                      <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>
                        {t("auth.login.verifying")}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>
                        {t("auth.login.verify")}
                      </Text>
                      <Feather name="arrow-right" size={16} color="#FFFFFF" />
                    </>
                  )}
                </Pressable>
              </View>
            ) : (
              <View style={styles.formStack}>
                <AuthField
                  label={t("auth.login.identifier")}
                  error={identifierError}
                  valid={identifierOk && !identifierError}
                >
                  <TextInput
                    value={identifier}
                    onChangeText={(value) => {
                      setIdentifier(value);
                      if (identifierError) setIdentifierError(null);
                    }}
                    placeholder={t("auth.login.identifierPlaceholder")}
                    placeholderTextColor={auth.muted}
                    autoCapitalize="none"
                    autoComplete="username"
                    keyboardType="email-address"
                    editable={!busy}
                    style={[
                      styles.input,
                      {
                        backgroundColor: auth.inputBg,
                        borderColor: identifierError ? auth.error : identifierOk ? auth.valid : auth.inputBorder,
                        color: auth.text,
                        fontFamily: "Inter_500Medium",
                        paddingRight: identifierOk && !identifierError ? 36 : 16,
                      },
                    ]}
                  />
                </AuthField>

                <AuthField
                  label={t("auth.login.password")}
                  error={passwordError}
                  right={
                    <Pressable hitSlop={8} onPress={() => router.push("/forgot-password" as never)}>
                      <Text style={[styles.forgotLink, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
                        {t("auth.login.forgotPassword")}
                      </Text>
                    </Pressable>
                  }
                >
                  <View
                    style={[
                      styles.passwordRow,
                      {
                        backgroundColor: auth.inputBg,
                        borderColor: passwordError ? auth.error : auth.inputBorder,
                      },
                    ]}
                  >
                    <TextInput
                      value={password}
                      onChangeText={(value) => {
                        setPassword(value);
                        if (passwordError) setPasswordError(null);
                      }}
                      placeholder="••••••••"
                      placeholderTextColor={auth.muted}
                      secureTextEntry={!showPassword}
                      autoComplete="password"
                      editable={!busy}
                      style={[styles.passwordInput, { color: auth.text, fontFamily: "Inter_500Medium" }]}
                    />
                    <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                      <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={auth.muted} />
                    </Pressable>
                  </View>
                </AuthField>

                <AuthCheckbox
                  checked={rememberDevice}
                  onToggle={() => setRememberDevice((v) => !v)}
                  label={t("auth.login.rememberDevice")}
                  disabled={busy}
                />

                <Pressable
                  onPress={handleSignIn}
                  disabled={busy}
                  style={[styles.submitBtn, { backgroundColor: auth.cta, opacity: busy ? 0.7 : 1 }]}
                >
                  {busy ? (
                    <>
                      <ActivityIndicator color="#FFFFFF" size="small" />
                      <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>
                        {t("auth.login.signingIn")}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>
                        {t("auth.login.submit")}
                      </Text>
                      <Feather name="arrow-right" size={16} color="#FFFFFF" />
                    </>
                  )}
                </Pressable>

                <View style={styles.biometricStack}>
                  <Pressable
                    onPress={() => void handleBiometricLogin("face")}
                    disabled={busy}
                    style={[
                      styles.biometricBtn,
                      {
                        borderColor: auth.inputBorder,
                        backgroundColor: auth.inputBg,
                        opacity: busy ? 0.55 : 1,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons name="face-recognition" size={22} color={auth.plum} />
                    <Text style={[styles.biometricText, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
                      {t("auth.login.useBiometric", { method: t("settings.biometric.face") })}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void handleBiometricLogin("fingerprint")}
                    disabled={busy}
                    style={[
                      styles.biometricBtn,
                      {
                        borderColor: auth.inputBorder,
                        backgroundColor: auth.inputBg,
                        opacity: busy ? 0.55 : 1,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons name="fingerprint" size={22} color={auth.plum} />
                    <Text style={[styles.biometricText, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
                      {t("auth.login.useBiometric", { method: t("settings.biometric.fingerprint") })}
                    </Text>
                  </Pressable>
                </View>

                <Pressable onPress={() => router.push("/signup" as never)}>
                  <Text style={[styles.signupLine, { color: auth.muted, fontFamily: "Inter_500Medium" }]}>
                    {t("auth.login.noAccount")}{" "}
                    <Text style={{ color: auth.plum, fontFamily: "Inter_700Bold" }}>
                      {t("auth.login.createAccount")}
                    </Text>
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          <Text style={[styles.footer, { color: auth.footer, fontFamily: "Inter_500Medium" }]}>
            {t("auth.login.footer")}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  themeToggle: {
    position: "absolute",
    right: 16,
    zIndex: 20,
  },
  formPanel: {
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginBottom: 16,
    minHeight: 420,
    overflow: "hidden",
  },
  dragHandleWrap: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  formBody: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  formIntro: {
    marginBottom: 28,
    gap: 6,
  },
  formTitle: {
    fontSize: 24,
    letterSpacing: -0.3,
  },
  formSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  formStack: {
    gap: 20,
  },
  field: {
    gap: 6,
  },
  fieldInputWrap: {
    position: "relative",
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
  },
  fieldError: {
    marginTop: 6,
    fontSize: 12,
  },
  validMark: {
    position: "absolute",
    right: 12,
    top: 14,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    height: 48,
    paddingHorizontal: 16,
  },
  passwordInput: {
    flex: 1,
    fontSize: 14,
  },
  eyeBtn: {
    padding: 4,
  },
  forgotLink: {
    fontSize: 12,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
  },
  submitBtn: {
    height: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitText: {
    color: "#FFFFFF",
    fontSize: 15,
  },
  biometricBtn: {
    height: 48,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  biometricStack: {
    gap: 10,
    marginTop: 4,
  },
  biometricText: {
    fontSize: 14,
  },
  signupLine: {
    textAlign: "center",
    fontSize: 13,
    marginTop: 4,
  },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backLinkText: {
    fontSize: 13,
  },
  infoCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
    fontSize: 11,
    lineHeight: 16,
  },
});

import { FontFamily } from "@/constants/typography";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AuthShell } from "@/components/auth/AuthShell";
import { OtpInput } from "@/components/auth/OtpInput";
import { getAuthColors } from "@/constants/auth-colors";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import * as Haptics from "@/lib/haptics";
import {
  authenticateWithBiometrics,
  getAvailableBiometricKinds,
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
  return /network request failed|failed to fetch|network error|timed out|econnrefused|enotfound/i.test(
    msg,
  );
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
        <Text
          style={[
            styles.fieldLabel,
            { color: auth.muted, fontFamily: FontFamily.interBold },
          ]}
        >
          {label}
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
        <Text
          style={[
            styles.fieldError,
            { color: auth.error, fontFamily: FontFamily.interMedium },
          ]}
        >
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
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      style={styles.checkboxRow}
    >
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
      <Text
        style={[
          styles.checkboxLabel,
          { color: auth.muted, fontFamily: FontFamily.interMedium },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function LoginScreen() {
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
  const [pendingCreds, setPendingCreds] = useState<{
    identifier: string;
    password: string;
  } | null>(null);
  const passwordInput = useRef<TextInput>(null);
  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricHardware, setBiometricHardware] = useState(false);
  const [biometricKinds, setBiometricKinds] = useState<
    ("face" | "fingerprint")[]
  >([]);

  const mfaStep = Boolean(mfaChallenge);
  const identifierOk =
    !validateLoginIdentifier(identifier) && identifier.trim().length > 0;
  const mfaComplete = mfaCode.length === 6;

  const refreshBiometric = useCallback(async () => {
    const [ready, hardware, kinds] = await Promise.all([
      canUseBiometricLogin(),
      isBiometricHardwareAvailable(),
      getAvailableBiometricKinds(),
    ]);
    setBiometricReady(ready);
    setBiometricHardware(hardware);
    setBiometricKinds(kinds);
  }, []);

  useEffect(() => {
    void refreshBiometric().catch(() => setBiometricReady(false));
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
    const msg =
      err instanceof Error
        ? err.message
        : t("auth.login.error.invalidCredentials");
    Alert.alert(t("auth.login.error.signInFailed"), msg);
    setPasswordError(null);
  };

  const handleSignIn = async () => {
    if (busy) return;
    const idErr = validateLoginIdentifier(identifier);
    const pwdErr = !password.trim()
      ? t("auth.login.error.passwordRequired")
      : null;
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

  const handleBiometricLogin = async (
    preferred: "face" | "fingerprint" = "fingerprint",
  ) => {
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
        Alert.alert(
          t("auth.login.error.signInFailed"),
          t("auth.login.biometricCancelled"),
        );
        setBusy(false);
        return;
      }
      const creds = await readBiometricCredentials();
      if (!creds) {
        Alert.alert(
          t("auth.login.error.signInFailed"),
          t("auth.login.biometricMissingCreds"),
        );
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
      await completeMfa(
        mfaChallenge,
        mfaCode.trim(),
        trustDevice,
        pendingCreds ?? undefined,
      );
      finishAuthenticated();
    } catch (err) {
      setMfaCodeError(
        err instanceof Error ? err.message : t("auth.login.error.invalidMfa"),
      );
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
    <AuthShell>
      <View style={styles.formPanel}>
        <View style={styles.formBody}>
          {/* Sign in needs no heading under the logo; the two-step check
              keeps one so the code request makes sense. */}
          {mfaStep ? (
            <View style={styles.formIntro}>
              <Text
                accessibilityRole="header"
                style={[
                  styles.formTitle,
                  { color: auth.text, fontFamily: FontFamily.display },
                ]}
              >
                {t("auth.login.mfaTitle")}
              </Text>
              <Text
                style={[
                  styles.formSubtitle,
                  { color: auth.muted, fontFamily: FontFamily.interMedium },
                ]}
              >
                {t("auth.login.mfaSubtitle")}
              </Text>
            </View>
          ) : null}

          {mfaStep ? (
            <View style={styles.formStack}>
              <Pressable onPress={resetMfa} style={styles.backLink}>
                <Feather name="arrow-left" size={14} color={auth.plum} />
                <Text
                  style={[
                    styles.backLinkText,
                    { color: auth.plum, fontFamily: FontFamily.interBold },
                  ]}
                >
                  {t("auth.login.backToSignIn")}
                </Text>
              </Pressable>

              <View
                style={[
                  styles.infoCard,
                  {
                    backgroundColor: auth.noticeBg,
                  },
                ]}
              >
                <Feather name="shield" size={18} color={auth.plum} />
                <Text
                  style={[
                    styles.infoText,
                    { color: auth.muted, fontFamily: FontFamily.interMedium },
                  ]}
                >
                  {t("auth.login.mfaInfo")}
                </Text>
              </View>

              <View>
                <Text
                  style={[
                    styles.fieldLabel,
                    {
                      color: auth.muted,
                      fontFamily: FontFamily.interBold,
                      marginBottom: 12,
                    },
                  ]}
                >
                  {t("auth.login.verificationCode")}
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
                  <Text
                    style={[
                      styles.fieldError,
                      {
                        color: auth.error,
                        fontFamily: FontFamily.interMedium,
                      },
                    ]}
                  >
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
                  {
                    backgroundColor: auth.cta,
                    opacity: busy || !mfaComplete ? 0.4 : 1,
                  },
                ]}
              >
                {busy ? (
                  <>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text
                      style={[
                        styles.submitText,
                        { fontFamily: FontFamily.interBold },
                      ]}
                    >
                      {t("auth.login.verifying")}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text
                      style={[
                        styles.submitText,
                        { fontFamily: FontFamily.interBold },
                      ]}
                    >
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
                  accessibilityLabel={t("auth.login.identifier")}
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInput.current?.focus()}
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
                      borderColor: identifierError
                        ? auth.error
                        : identifierOk
                          ? auth.valid
                          : auth.inputBorder,
                      color: auth.text,
                      fontFamily: FontFamily.interMedium,
                      paddingRight: identifierOk && !identifierError ? 36 : 16,
                    },
                  ]}
                />
              </AuthField>

              <AuthField
                label={t("auth.login.password")}
                error={passwordError}
                right={
                  <Pressable
                    hitSlop={8}
                    onPress={() => router.push("/forgot-password" as never)}
                  >
                    <Text
                      style={[
                        styles.forgotLink,
                        {
                          color: auth.plum,
                          fontFamily: FontFamily.interBold,
                        },
                      ]}
                    >
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
                      borderColor: passwordError
                        ? auth.error
                        : auth.inputBorder,
                    },
                  ]}
                >
                  <TextInput
                    ref={passwordInput}
                    accessibilityLabel={t("auth.login.password")}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={() => void handleSignIn()}
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
                    style={[
                      styles.passwordInput,
                      {
                        color: auth.text,
                        fontFamily: FontFamily.interMedium,
                      },
                    ]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(
                      showPassword
                        ? "auth.password.hide"
                        : "auth.password.show",
                    )}
                    onPress={() => setShowPassword((v) => !v)}
                    style={styles.eyeBtn}
                  >
                    <Feather
                      name={showPassword ? "eye-off" : "eye"}
                      size={18}
                      color={auth.muted}
                    />
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
                style={[
                  styles.submitBtn,
                  { backgroundColor: auth.cta, opacity: busy ? 0.7 : 1 },
                ]}
              >
                {busy ? (
                  <>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text
                      style={[
                        styles.submitText,
                        { fontFamily: FontFamily.interBold },
                      ]}
                    >
                      {t("auth.login.signingIn")}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text
                      style={[
                        styles.submitText,
                        { fontFamily: FontFamily.interBold },
                      ]}
                    >
                      {t("auth.login.submit")}
                    </Text>
                    <Feather name="arrow-right" size={16} color="#FFFFFF" />
                  </>
                )}
              </Pressable>

              {biometricReady &&
              biometricHardware &&
              biometricKinds.length > 0 ? (
                <View style={styles.biometricStack}>
                  {biometricKinds.map((kind) => (
                    <Pressable
                      key={kind}
                      accessibilityRole="button"
                      onPress={() => void handleBiometricLogin(kind)}
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
                      <MaterialCommunityIcons
                        name={
                          kind === "face" ? "face-recognition" : "fingerprint"
                        }
                        size={22}
                        color={auth.plum}
                      />
                      <Text
                        style={[
                          styles.biometricText,
                          {
                            color: auth.plum,
                            fontFamily: FontFamily.interBold,
                          },
                        ]}
                      >
                        {t("auth.login.useBiometric", {
                          method: t(
                            kind === "face"
                              ? "settings.biometric.face"
                              : "settings.biometric.fingerprint",
                          ),
                        })}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Pressable
                onPress={() => router.push("/activate-account" as never)}
              >
                <Text
                  style={[
                    styles.signupLine,
                    { color: auth.muted, fontFamily: FontFamily.interMedium },
                  ]}
                >
                  {t("auth.login.noAccount")}{" "}
                  <Text
                    style={{
                      color: auth.plum,
                      fontFamily: FontFamily.interBold,
                    }}
                  >
                    {t("auth.login.createAccount")}
                  </Text>
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        <Text
          style={[
            styles.footer,
            { color: auth.footer, fontFamily: FontFamily.interMedium },
          ]}
        >
          {t("auth.login.footer")}
        </Text>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  formPanel: { width: "100%", flexGrow: 1 },
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
  formBody: { paddingBottom: 4 },
  formIntro: { marginBottom: 28, gap: 8, alignItems: "center" },
  formTitle: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
    textAlign: "center",
  },
  formSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 320,
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
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  fieldLabel: { fontSize: 14 },
  fieldError: {
    marginTop: 6,
    fontSize: 12,
  },
  validMark: {
    position: "absolute",
    right: 14,
    top: 17,
    fontSize: 14,
    fontFamily: FontFamily.interBold,
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    height: 54,
    paddingLeft: 16,
    paddingRight: 4,
  },
  passwordInput: { flex: 1, fontSize: 16, height: "100%" },
  eyeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  forgotLink: { fontSize: 14 },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxLabel: { flex: 1, fontSize: 14 },
  submitBtn: {
    height: 54,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitText: { color: "#FFFFFF", fontSize: 16 },
  biometricBtn: {
    height: 54,
    borderRadius: 14,
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
  biometricText: { fontSize: 15 },
  signupLine: {
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
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
    borderRadius: 14,
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
    marginTop: "auto",
    paddingTop: 32,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
});

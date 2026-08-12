import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
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

import { AuthBrandHeader } from "@/components/auth/AuthBrandHeader";
import { AuthSelect } from "@/components/auth/AuthSelect";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { PasswordStrengthBar } from "@/components/auth/PasswordStrengthBar";
import { getAuthColors } from "@/constants/auth-colors";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import { completeOnboarding, registerAccount } from "@/lib/auth-api";

type FormData = {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
  sp_organisation_name: string;
  sp_provider_type: string;
  sp_registration_status: string;
  sp_team_size: string;
  sp_participant_volume: string;
  sp_contact_number: string;
};

const EMPTY: FormData = {
  full_name: "",
  email: "",
  password: "",
  confirm_password: "",
  sp_organisation_name: "",
  sp_provider_type: "",
  sp_registration_status: "",
  sp_team_size: "",
  sp_participant_volume: "",
  sp_contact_number: "",
};

function AuthLabel({ children, auth }: { children: string; auth: ReturnType<typeof getAuthColors> }) {
  return (
    <Text style={[styles.label, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
      {children.toUpperCase()}
    </Text>
  );
}

function AuthInput({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  showToggle,
  showPassword,
  onTogglePassword,
  auth,
  error,
  keyboardType,
  autoCapitalize,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  showToggle?: boolean;
  showPassword?: boolean;
  onTogglePassword?: () => void;
  auth: ReturnType<typeof getAuthColors>;
  error?: boolean;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "words";
}) {
  return (
    <View
      style={[
        styles.inputRow,
        {
          backgroundColor: auth.inputBg,
          borderColor: error ? "#EF4444" : auth.inputBorder,
        },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={auth.muted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[styles.input, { color: auth.text, fontFamily: "Inter_500Medium" }]}
      />
      {showToggle ? (
        <Pressable onPress={onTogglePassword} style={styles.eyeBtn}>
          <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={auth.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, updateSession } = useAuth();
  const { resolvedScheme, t } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [emailVerify, setEmailVerify] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateField = useCallback((field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const stepLabels = [t("auth.signup.step.details"), t("auth.signup.step.organisation")];
  const mismatch = Boolean(form.confirm_password) && form.password !== form.confirm_password;
  const short = Boolean(form.password) && form.password.length < 8;

  const step1Valid =
    form.full_name.trim() !== "" &&
    form.email.trim() !== "" &&
    form.password.length >= 8 &&
    form.password === form.confirm_password;

  const step2Valid = form.sp_organisation_name.trim() !== "";

  const handleSubmit = async () => {
    if (!step2Valid || busy) return;
    setBusy(true);
    setError(null);

    try {
      await registerAccount({
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim(),
        account_type: "small_provider",
      });

      try {
        const result = await login(form.email.trim(), form.password);
        if (result.status === "mfa_required") {
          setEmailVerify(true);
          setStep(3);
          return;
        }

        const onboarding = await completeOnboarding({
          account_type: "small_provider",
          organization_name: form.sp_organisation_name.trim(),
          ...(form.sp_provider_type ? { provider_type: form.sp_provider_type } : {}),
          ...(form.sp_registration_status ? { registration_status: form.sp_registration_status } : {}),
          ...(form.sp_team_size ? { team_size: form.sp_team_size } : {}),
          ...(form.sp_participant_volume ? { participant_volume: form.sp_participant_volume } : {}),
          ...(form.sp_contact_number ? { contact_number: form.sp_contact_number } : {}),
        });

        if (onboarding.access_token && result.status === "authenticated") {
          await updateSession(onboarding.access_token, result.user);
        }
      } catch {
        setEmailVerify(true);
        setStep(3);
        return;
      }

      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.signup.error.tryAgain"));
    } finally {
      setBusy(false);
    }
  };

  const finishSignup = () => {
    if (emailVerify) {
      router.replace("/login" as never);
      return;
    }
    router.replace("/(tabs)/shifts" as never);
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
        <AuthBrandHeader taglineKey="auth.signup.marketing.tagline" />

        <View
          style={[
            styles.formPanel,
            {
              backgroundColor: auth.formBg,
              borderColor: auth.cardBorder,
            },
          ]}
        >
          <View style={styles.dragHandleWrap}>
            <View style={[styles.dragHandle, { backgroundColor: auth.dragHandle }]} />
          </View>

          {step < 3 ? (
            <View style={[styles.stepBar, { backgroundColor: auth.formBg, borderColor: auth.cardBorder }]}>
              {stepLabels.map((label, index) => (
                <View key={label} style={styles.stepItem}>
                  <View
                    style={[
                      styles.stepTrack,
                      { backgroundColor: index + 1 <= step ? auth.plum : auth.inputBorder },
                    ]}
                  />
                  <Text
                    style={[
                      styles.stepLabel,
                      {
                        color: index + 1 <= step ? auth.plum : auth.muted,
                        fontFamily: "Inter_700Bold",
                      },
                    ]}
                  >
                    {label.split(" ")[0]?.toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: auth.formBg, borderColor: auth.cardBorder }]}>
            {step === 1 ? (
              <View style={styles.stack}>
                <View>
                  <Text style={[styles.cardTitle, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
                    {t("auth.signup.title")}
                  </Text>
                  <Text style={[styles.cardSubtitle, { color: auth.muted, fontFamily: "Inter_400Regular" }]}>
                    {t("auth.signup.subtitle")}
                  </Text>
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>{t("auth.signup.fullName")}</AuthLabel>
                  <AuthInput
                    value={form.full_name}
                    onChangeText={(v) => updateField("full_name", v)}
                    placeholder={t("auth.signup.namePlaceholder")}
                    auth={auth}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>{t("auth.signup.email")}</AuthLabel>
                  <AuthInput
                    value={form.email}
                    onChangeText={(v) => updateField("email", v)}
                    placeholder={t("auth.signup.emailPlaceholder")}
                    auth={auth}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>{t("auth.signup.password")}</AuthLabel>
                  <AuthInput
                    value={form.password}
                    onChangeText={(v) => updateField("password", v)}
                    placeholder={t("auth.signup.passwordPlaceholder")}
                    auth={auth}
                    secureTextEntry={!showPassword}
                    showToggle
                    showPassword={showPassword}
                    onTogglePassword={() => setShowPassword((v) => !v)}
                    error={short}
                  />
                  <PasswordStrengthBar password={form.password} auth={auth} />
                </View>

                <View style={styles.field}>
                  <View style={styles.confirmHeader}>
                    <AuthLabel auth={auth}>{t("auth.signup.confirmPassword")}</AuthLabel>
                    {form.confirm_password ? (
                      <Text
                        style={{
                          color: mismatch ? "#EF4444" : auth.valid,
                          fontFamily: "Inter_700Bold",
                          fontSize: 11,
                        }}
                      >
                        {mismatch ? t("auth.signup.passwordMismatch") : t("auth.signup.passwordMatch")}
                      </Text>
                    ) : null}
                  </View>
                  <AuthInput
                    value={form.confirm_password}
                    onChangeText={(v) => updateField("confirm_password", v)}
                    placeholder={t("auth.signup.confirmPlaceholder")}
                    auth={auth}
                    secureTextEntry={!showPassword}
                    error={mismatch}
                  />
                </View>

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => router.replace("/login" as never)}
                    style={[styles.secondaryBtn, { borderColor: auth.inputBorder }]}
                  >
                    <Text style={[styles.secondaryBtnText, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
                      {t("auth.signup.back")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => step1Valid && setStep(2)}
                    disabled={!step1Valid}
                    style={[styles.primaryBtn, { backgroundColor: auth.plum, opacity: step1Valid ? 1 : 0.4 }]}
                  >
                    <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
                      {t("auth.signup.continue")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {step === 2 ? (
              <View style={styles.stack}>
                <Text style={[styles.cardTitle, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
                  {t("auth.signup.setupOrganisation")}
                </Text>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>{t("auth.signup.field.organisationName")}</AuthLabel>
                  <AuthInput
                    value={form.sp_organisation_name}
                    onChangeText={(v) => updateField("sp_organisation_name", v)}
                    placeholder={t("auth.signup.placeholder.organisation")}
                    auth={auth}
                  />
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>{t("auth.signup.field.providerType")}</AuthLabel>
                  <AuthSelect
                    value={form.sp_provider_type}
                    onChange={(v) => updateField("sp_provider_type", v)}
                    placeholder={t("auth.signup.placeholder.selectType")}
                    disabled={busy}
                    auth={auth}
                    options={[
                      { value: "registered_ndis", label: t("auth.signup.providerType.registeredNdis") },
                      { value: "unregistered", label: t("auth.signup.providerType.unregistered") },
                      { value: "plan_management", label: t("auth.signup.providerType.planManagement") },
                      { value: "support_coord", label: t("auth.signup.providerType.supportCoord") },
                    ]}
                  />
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>{t("auth.signup.field.registrationStatus")}</AuthLabel>
                  <AuthSelect
                    value={form.sp_registration_status}
                    onChange={(v) => updateField("sp_registration_status", v)}
                    placeholder={t("auth.signup.placeholder.selectStatus")}
                    disabled={busy}
                    auth={auth}
                    options={[
                      { value: "registered", label: t("auth.signup.regStatus.registered") },
                      { value: "unregistered", label: t("auth.signup.status.unregistered") },
                      { value: "in_progress", label: t("auth.signup.regStatus.inProgress") },
                    ]}
                  />
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>{t("auth.signup.field.teamSize")}</AuthLabel>
                  <AuthSelect
                    value={form.sp_team_size}
                    onChange={(v) => updateField("sp_team_size", v)}
                    placeholder={t("auth.signup.placeholder.selectSize")}
                    disabled={busy}
                    auth={auth}
                    options={[
                      { value: "1_5", label: t("auth.signup.teamSize.1_5") },
                      { value: "5_20", label: t("auth.signup.teamSize.5_20") },
                      { value: "20_plus", label: t("auth.signup.teamSize.20_plus") },
                    ]}
                  />
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>{t("auth.signup.field.participantVolume")}</AuthLabel>
                  <AuthSelect
                    value={form.sp_participant_volume}
                    onChange={(v) => updateField("sp_participant_volume", v)}
                    placeholder={t("auth.signup.placeholder.participantCount")}
                    disabled={busy}
                    auth={auth}
                    options={[
                      { value: "1_10", label: t("auth.signup.participantVolume.1_10") },
                      { value: "10_50", label: t("auth.signup.participantVolume.10_50") },
                      { value: "50_plus", label: t("auth.signup.participantVolume.50_plus") },
                    ]}
                  />
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>{t("auth.signup.field.contactNumber")}</AuthLabel>
                  <AuthInput
                    value={form.sp_contact_number}
                    onChangeText={(v) => updateField("sp_contact_number", v)}
                    placeholder={t("auth.signup.placeholder.contact")}
                    auth={auth}
                  />
                </View>

                {error ? (
                  <Text style={[styles.error, { color: auth.coral, fontFamily: "Inter_500Medium" }]}>{error}</Text>
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => setStep(1)}
                    style={[styles.secondaryBtn, { borderColor: auth.inputBorder }]}
                  >
                    <Text style={[styles.secondaryBtnText, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
                      {t("auth.signup.back")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSubmit}
                    disabled={!step2Valid || busy}
                    style={[styles.primaryBtn, { backgroundColor: auth.plum, opacity: !step2Valid || busy ? 0.4 : 1 }]}
                  >
                    {busy ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
                          {t("auth.signup.completeSetup")}
                        </Text>
                        <Feather name="arrow-right" size={16} color="#FFFFFF" />
                      </>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}

            {step === 3 ? (
              <View style={styles.successWrap}>
                <Feather name="check-circle" size={70} color={auth.coral} />
                <Text style={[styles.successTitle, { color: auth.plum, fontFamily: "Inter_700Bold" }]}>
                  {emailVerify ? t("auth.signup.checkEmail") : t("auth.signup.allSet")}
                </Text>
                <Text style={[styles.successBody, { color: auth.muted, fontFamily: "Inter_400Regular" }]}>
                  {emailVerify
                    ? t("auth.signup.verificationSent", { email: form.email })
                    : t("auth.signup.accountReady")}
                </Text>
                <Pressable
                  onPress={finishSignup}
                  style={[styles.primaryBtn, styles.successBtn, { backgroundColor: auth.plum }]}
                >
                  <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
                    {emailVerify ? t("auth.signup.goToLogin") : t("auth.signup.goToDashboard")}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {step < 3 ? (
            <Text style={[styles.signInLine, { color: auth.muted, fontFamily: "Inter_500Medium" }]}>
              {t("auth.signup.hasAccount")}{" "}
              <Text
                onPress={() => router.replace("/login" as never)}
                style={{ color: auth.coral, fontFamily: "Inter_700Bold" }}
              >
                {t("auth.signup.signIn")}
              </Text>
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  themeToggle: { position: "absolute", right: 16, zIndex: 20 },
  formPanel: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  dragHandleWrap: { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  dragHandle: { width: 40, height: 4, borderRadius: 2 },
  stepBar: {
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  stepItem: { flex: 1, gap: 6 },
  stepTrack: { height: 4, borderRadius: 999 },
  stepLabel: { fontSize: 9, textAlign: "center" },
  card: {
    borderWidth: 1,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  stack: { gap: 16 },
  cardTitle: { fontSize: 22 },
  cardSubtitle: { fontSize: 14, marginTop: 4 },
  field: { gap: 6 },
  label: { fontSize: 11, letterSpacing: 0.8 },
  inputRow: {
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 10 },
  eyeBtn: { padding: 4 },
  confirmHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  actions: { flexDirection: "row", gap: 12, marginTop: 8 },
  secondaryBtn: {
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontSize: 14 },
  primaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 14 },
  error: { fontSize: 12 },
  successWrap: { alignItems: "center", gap: 12, paddingVertical: 12 },
  successTitle: { fontSize: 24, textAlign: "center", marginTop: 8 },
  successBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  successBtn: { width: "100%", marginTop: 12 },
  signInLine: { textAlign: "center", fontSize: 13, marginTop: 16 },
});

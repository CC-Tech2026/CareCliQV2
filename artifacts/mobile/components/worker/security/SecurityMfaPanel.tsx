import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SecurityTotpQrModal } from "@/components/worker/security/SecurityTotpQrModal";
import {
  SettingsLoadingRow,
  SettingsPanelCard,
} from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import {
  useDisableMfa,
  useMfaStatus,
  useStartTotpEnrollment,
  useVerifyTotpEnrollment,
} from "@/hooks/worker/useWorkerSecurity";
import { useColors } from "@/hooks/useColors";
import { copyText } from "@/lib/copy-text";

export function SecurityMfaPanel() {
  const colors = useColors();
  const t = useT();
  const { showToast } = useToast();

  const { data: mfaStatus, isLoading } = useMfaStatus();
  const startEnrollment = useStartTotpEnrollment();
  const verifyEnrollment = useVerifyTotpEnrollment();
  const disableMfaMutation = useDisableMfa();

  const [enrolling, setEnrolling] = useState(false);
  const [enrollSecret, setEnrollSecret] = useState<string | null>(null);
  const [enrollOtpAuthUrl, setEnrollOtpAuthUrl] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [enrollCode, setEnrollCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const handleStartEnrollment = async () => {
    try {
      const payload = await startEnrollment.mutateAsync();
      setEnrollSecret(payload.secret);
      setEnrollOtpAuthUrl(payload.otpauth_url);
      setEnrolling(true);
      setEnrollCode("");
      setRecoveryCodes(null);
      setQrOpen(false);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("security.start2faFailed"),
        "error",
      );
    }
  };

  const handleCopySecret = async () => {
    if (!enrollSecret) return;
    try {
      await copyText(enrollSecret);
      showToast(t("security.secretCopied"), "success");
    } catch {
      showToast(t("security.copyFailed"), "error");
    }
  };

  const handleVerifyEnrollment = async () => {
    if (!enrollCode.trim()) return;
    try {
      const result = await verifyEnrollment.mutateAsync(enrollCode.trim());
      setRecoveryCodes(result.recovery_codes);
      setEnrolling(false);
      setEnrollSecret(null);
      setEnrollOtpAuthUrl(null);
      setQrOpen(false);
      setEnrollCode("");
      showToast(t("security.twoFactorEnabled"), "success");
    } catch {
      showToast(t("security.verifyFailed"), "error");
    }
  };

  const handleDisableMfa = async () => {
    if (!disablePassword) return;
    try {
      await disableMfaMutation.mutateAsync(disablePassword);
      setDisablePassword("");
      setRecoveryCodes(null);
      showToast(t("security.twoFactorDisabled"), "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("security.disable2faFailed"),
        "error",
      );
    }
  };

  const cancelEnrollment = () => {
    setEnrolling(false);
    setEnrollSecret(null);
    setEnrollOtpAuthUrl(null);
    setQrOpen(false);
    setEnrollCode("");
  };

  return (
    <>
      <Text style={[styles.statusText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
        {mfaStatus?.enabled ? t("security.twoFactorActive") : t("security.twoFactorInactive")}
      </Text>
      <View>
        <SettingsPanelCard>
          {isLoading ? (
            <SettingsLoadingRow label={t("common.loading")} />
          ) : (
            <View style={styles.body}>
              {recoveryCodes ? (
                <View style={[styles.recoveryBox, { borderColor: "rgba(245, 158, 11, 0.45)", backgroundColor: "rgba(254, 243, 199, 0.35)" }]}>
                  <Text style={[styles.recoveryTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                    {t("security.recoveryCodes")}
                  </Text>
                  <Text style={[styles.recoveryHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {t("security.recoveryCodesHint")}
                  </Text>
                  <View style={styles.recoveryGrid}>
                    {recoveryCodes.map((code) => (
                      <View
                        key={code}
                        style={[styles.recoveryCode, { backgroundColor: colors.background, borderColor: colors.border }]}
                      >
                        <Text style={[styles.recoveryCodeText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                          {code}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {!mfaStatus?.enabled ? (
                enrolling && enrollSecret ? (
                  <View style={styles.form}>
                    <View style={[styles.secretBox, { backgroundColor: colors.activeBg }]}>
                      <Text style={[styles.secretTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                        {t("security.setupAuthenticator")}
                      </Text>
                      <Text style={[styles.secretHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                        {t("security.setupAuthenticatorHint")}
                      </Text>
                      <View style={styles.secretRow}>
                        <View
                          style={[
                            styles.secretCodeBox,
                            { backgroundColor: colors.background, borderColor: colors.border },
                          ]}
                        >
                          <Text
                            selectable
                            style={[styles.secretValue, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}
                          >
                            {enrollSecret}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => void handleCopySecret()}
                          accessibilityLabel={t("security.copySecret")}
                          style={[styles.secretActionBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                        >
                          <Feather name="copy" size={18} color={colors.primary} />
                        </Pressable>
                        <Pressable
                          onPress={() => setQrOpen(true)}
                          accessibilityLabel={t("security.showQrAria")}
                          style={[styles.secretActionBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
                        >
                          <MaterialCommunityIcons name="qrcode" size={20} color={colors.primary} />
                        </Pressable>
                      </View>
                    </View>
                    <View style={styles.field}>
                      <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                        {t("security.totpCode")}
                      </Text>
                      <TextInput
                        value={enrollCode}
                        onChangeText={setEnrollCode}
                        keyboardType="number-pad"
                        autoComplete="one-time-code"
                        placeholder={t("security.totpPlaceholder")}
                        placeholderTextColor={colors.mutedForeground}
                        style={[
                          styles.input,
                          {
                            color: colors.foreground,
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                            letterSpacing: 4,
                          },
                        ]}
                      />
                    </View>
                    <View style={styles.actions}>
                      <Pressable onPress={cancelEnrollment} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                        <Text style={[styles.secondaryBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                          {t("common.cancel")}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void handleVerifyEnrollment()}
                        disabled={verifyEnrollment.isPending || !enrollCode.trim()}
                        style={[
                          styles.primaryBtn,
                          {
                            backgroundColor: colors.primary,
                            opacity: verifyEnrollment.isPending || !enrollCode.trim() ? 0.55 : 1,
                          },
                        ]}
                      >
                        {verifyEnrollment.isPending ? (
                          <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                          <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
                            {t("security.verifyEnable")}
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => void handleStartEnrollment()}
                    disabled={startEnrollment.isPending}
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor: colors.primary,
                        opacity: startEnrollment.isPending ? 0.55 : 1,
                        alignSelf: "flex-start",
                      },
                    ]}
                  >
                    {startEnrollment.isPending ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <>
                        <Feather name="lock" size={14} color="#FFFFFF" />
                        <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
                          {t("security.enableAuthenticator")}
                        </Text>
                      </>
                    )}
                  </Pressable>
                )
              ) : (
                <View style={styles.form}>
                  <Text style={[styles.secretHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {t("security.disableTwoFactorHint")}
                  </Text>
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                      {t("security.currentPassword")}
                    </Text>
                    <TextInput
                      value={disablePassword}
                      onChangeText={setDisablePassword}
                      secureTextEntry
                      autoCapitalize="none"
                      style={[
                        styles.input,
                        {
                          color: colors.foreground,
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                        },
                      ]}
                    />
                  </View>
                  <Pressable
                    onPress={() => void handleDisableMfa()}
                    disabled={disableMfaMutation.isPending || !disablePassword}
                    style={[
                      styles.dangerBtn,
                      {
                        borderColor: "rgba(239, 68, 68, 0.35)",
                        opacity: disableMfaMutation.isPending || !disablePassword ? 0.55 : 1,
                      },
                    ]}
                  >
                    {disableMfaMutation.isPending ? (
                      <ActivityIndicator color="#B91C1C" size="small" />
                    ) : (
                      <Text style={[styles.dangerBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                        {t("security.disableTwoFactor")}
                      </Text>
                    )}
                  </Pressable>
                </View>
              )}
            </View>
          )}
        </SettingsPanelCard>
      </View>

      <SecurityTotpQrModal
        visible={qrOpen}
        otpAuthUrl={enrollOtpAuthUrl}
        onClose={() => setQrOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  statusText: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  body: { gap: 14 },
  form: { gap: 12 },
  field: { gap: 6 },
  label: { fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  secretBox: { borderRadius: 16, padding: 14, gap: 8 },
  secretTitle: { fontSize: 14 },
  secretHint: { fontSize: 12, lineHeight: 17 },
  secretRow: { flexDirection: "row", alignItems: "stretch", gap: 8, marginTop: 4 },
  secretCodeBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: "center",
  },
  secretValue: { fontSize: 13, lineHeight: 20 },
  secretActionBtn: {
    minWidth: 48,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minWidth: 140,
  },
  primaryBtnText: { fontSize: 13, color: "#FFFFFF" },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  secondaryBtnText: { fontSize: 13 },
  dangerBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minWidth: 180,
    alignItems: "center",
  },
  dangerBtnText: { fontSize: 13, color: "#B91C1C" },
  recoveryBox: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  recoveryTitle: { fontSize: 14 },
  recoveryHint: { fontSize: 12, lineHeight: 17 },
  recoveryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  recoveryCode: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: "46%",
    alignItems: "center",
  },
  recoveryCodeText: { fontSize: 12, letterSpacing: 0.5 },
});

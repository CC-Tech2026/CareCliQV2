import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { SecurityMfaPanel } from "@/components/worker/security/SecurityMfaPanel";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { TabScrollFade } from "@/components/worker/settings/TabScrollFade";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { useTabScrollFade } from "@/hooks/worker/useTabScrollFade";
import {
  disableBiometricUnlock,
  enableBiometricUnlock,
  getAvailableBiometricKinds,
  isBiometricUnlockEnabled,
  labelForBiometricKind,
  type BiometricKind,
} from "@/lib/biometric-auth";
import { changePassword } from "@/lib/auth-api";
import { showAlert } from "@/lib/alert";
import * as Haptics from "@/lib/haptics";

type SecurityTab = "password" | "biometric" | "twoFactor";

function SettingsToggle({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const colors = useColors();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      trackColor={{ false: "#D6D4E2", true: colors.primary }}
      thumbColor="#FFFFFF"
    />
  );
}

function PasswordTab() {
  const colors = useColors();
  const t = useT();
  const { showToast } = useToast();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t("settings.changePassword.errorRequired"));
      return;
    }
    if (newPassword.length < 10) {
      setError(t("settings.changePassword.errorTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("settings.changePassword.errorMismatch"));
      return;
    }

    setBusy(true);
    try {
      const result = await changePassword({
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(result.message || t("settings.changePassword.success"), "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof Error ? err.message : t("settings.changePassword.failed"));
    } finally {
      setBusy(false);
    }
  };

  const renderField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    visible: boolean,
    setVisible: (v: boolean) => void,
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        {label}
      </Text>
      <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoComplete="password"
          style={[styles.input, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
          placeholderTextColor={colors.mutedForeground}
        />
        <Pressable onPress={() => setVisible(!visible)} hitSlop={8} style={styles.eye}>
          <Feather name={visible ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );

  return (
    <KeyboardAwareScrollViewCompat contentContainerStyle={styles.tabScroll} keyboardShouldPersistTaps="handled">
      <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {t("settings.changePassword.subtitle")}
      </Text>

      {renderField(
        t("settings.changePassword.current"),
        currentPassword,
        setCurrentPassword,
        showCurrent,
        setShowCurrent,
      )}
      {renderField(
        t("settings.changePassword.new"),
        newPassword,
        setNewPassword,
        showNew,
        setShowNew,
      )}
      {renderField(
        t("settings.changePassword.confirm"),
        confirmPassword,
        setConfirmPassword,
        showNew,
        setShowNew,
      )}

      {error ? (
        <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_500Medium" }]}>
          {error}
        </Text>
      ) : null}

      <Pressable
        onPress={() => void handleSubmit()}
        disabled={busy}
        style={[styles.submit, { backgroundColor: colors.primary, opacity: busy ? 0.55 : 1 }]}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>
            {t("settings.changePassword.submit")}
          </Text>
        )}
      </Pressable>
    </KeyboardAwareScrollViewCompat>
  );
}

function BiometricTab() {
  const colors = useColors();
  const t = useT();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [biometric, setBiometric] = useState(false);
  const [availableKinds, setAvailableKinds] = useState<BiometricKind[]>([]);
  const [confirmKind, setConfirmKind] = useState<BiometricKind | null>(null);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const loginIdentifier = user?.email?.trim() || "";

  const refreshBiometric = useCallback(async () => {
    const [enabled, kinds] = await Promise.all([
      isBiometricUnlockEnabled(),
      getAvailableBiometricKinds(),
    ]);
    setBiometric(enabled);
    setAvailableKinds(kinds);
  }, []);

  useEffect(() => {
    void refreshBiometric();
  }, [refreshBiometric]);

  const openEnableConfirm = (kind: BiometricKind) => {
    if (!availableKinds.includes(kind)) {
      showAlert(labelForBiometricKind(kind), t("settings.biometric.unavailable"));
      return;
    }
    setConfirmKind(kind);
    setConfirmPassword("");
    setConfirmError(null);
  };

  const handleConfirmEnable = async () => {
    if (!confirmKind) return;
    if (!confirmPassword.trim()) {
      setConfirmError(t("settings.biometric.passwordRequired"));
      return;
    }
    if (!loginIdentifier) {
      setConfirmError(t("settings.biometric.passwordRequired"));
      return;
    }
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const method = labelForBiometricKind(confirmKind);
      const result = await enableBiometricUnlock({
        identifier: loginIdentifier,
        password: confirmPassword,
        promptMessage: t("settings.biometric.confirmCta", { method }),
      });
      if (!result.ok) {
        if (result.reason === "unavailable") {
          showAlert(method, t("settings.biometric.unavailable"));
        }
        setConfirmBusy(false);
        return;
      }
      setBiometric(true);
      setConfirmKind(null);
      setConfirmPassword("");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(t("settings.biometric.enabledHint", { method }), "success");
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleBiometricToggle = async (kind: BiometricKind, next: boolean) => {
    if (next) {
      openEnableConfirm(kind);
      return;
    }
    try {
      await disableBiometricUnlock();
      setBiometric(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("settings.toast.saveFailed"), "error");
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.tabScroll}>
        <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("settings.biometric.confirmHint", { method: t("settings.row.biometric") })}
        </Text>

        <View style={[styles.groupCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
          {(availableKinds.includes("face") || availableKinds.length === 0) && (
            <View
              style={[
                styles.row,
                (availableKinds.includes("fingerprint") || availableKinds.length === 0) && {
                  borderBottomColor: colors.soft,
                  borderBottomWidth: 1,
                },
              ]}
            >
              <View style={[styles.rowIcon, { backgroundColor: colors.soft }]}>
                <Feather name="user" size={15} color={colors.primary} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {availableKinds.includes("face") ? labelForBiometricKind("face") : t("settings.biometric.face")}
              </Text>
              <SettingsToggle
                value={biometric && availableKinds.includes("face")}
                onValueChange={(v) => void handleBiometricToggle("face", v)}
              />
            </View>
          )}
          {(availableKinds.includes("fingerprint") || availableKinds.length === 0) && (
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: colors.soft }]}>
                <Feather name="smartphone" size={15} color={colors.primary} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {availableKinds.includes("fingerprint")
                  ? labelForBiometricKind("fingerprint")
                  : t("settings.biometric.fingerprint")}
              </Text>
              <SettingsToggle
                value={biometric && availableKinds.includes("fingerprint")}
                onValueChange={(v) => void handleBiometricToggle("fingerprint", v)}
              />
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={confirmKind !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirmKind(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setConfirmKind(null)}>
          <Pressable
            style={[styles.sheetCard, { backgroundColor: colors.card }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                {t("settings.biometric.confirmTitle")}
              </Text>
              <Pressable onPress={() => setConfirmKind(null)} hitSlop={8}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <View style={styles.sheetBody}>
              <Text style={[styles.modalHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {t("settings.biometric.confirmHint", {
                  method: confirmKind ? labelForBiometricKind(confirmKind) : t("settings.row.biometric"),
                })}
              </Text>
              <TextInput
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!confirmBusy}
                placeholder="Password"
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.modalInput,
                  {
                    color: colors.foreground,
                    borderColor: confirmError ? colors.destructive : colors.border,
                    backgroundColor: colors.background,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
              />
              {confirmError ? (
                <Text style={[styles.modalError, { color: colors.destructive, fontFamily: "Inter_500Medium" }]}>
                  {confirmError}
                </Text>
              ) : null}
              <Pressable
                onPress={() => void handleConfirmEnable()}
                disabled={confirmBusy}
                style={[
                  styles.modalCta,
                  { backgroundColor: colors.primary, opacity: confirmBusy ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.modalCtaText, { fontFamily: "Inter_600SemiBold" }]}>
                  {t("settings.biometric.confirmCta", {
                    method: confirmKind ? labelForBiometricKind(confirmKind) : t("settings.row.biometric"),
                  })}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export default function WorkerSecurityScreen() {
  const t = useT();
  const colors = useColors();
  const [tab, setTab] = useState<SecurityTab>("password");
  const fade = useTabScrollFade();

  const tabs = useMemo(
    () =>
      [
        { id: "password" as const, label: t("settings.row.changePassword") },
        { id: "biometric" as const, label: t("settings.row.biometric") },
        { id: "twoFactor" as const, label: t("security.twoFactor") },
      ],
    [t],
  );

  return (
    <SettingsSubScreen title={t("nav.security")} showBack>
      <View style={styles.tabBarWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
          onLayout={fade.onLayout}
          onContentSizeChange={fade.onContentSizeChange}
          onScroll={fade.onScroll}
          scrollEventThrottle={fade.scrollEventThrottle}
        >
          {tabs.map((item) => {
            const active = tab === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setTab(item.id)}
                style={[styles.folderTab, { backgroundColor: active ? colors.card : colors.soft }]}
              >
                <Text
                  style={[
                    styles.folderTabText,
                    {
                      color: active ? colors.primary : colors.mutedForeground,
                      fontFamily: active ? "Inter_700Bold" : "Inter_600SemiBold",
                    },
                  ]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <TabScrollFade visible={fade.showFade} background={colors.background} />
      </View>

      <View style={[styles.panel, { backgroundColor: colors.card }]}>
        {tab === "password" && <PasswordTab />}
        {tab === "biometric" && <BiometricTab />}
        {tab === "twoFactor" && (
          <ScrollView contentContainerStyle={styles.tabScroll}>
            <SecurityMfaPanel />
          </ScrollView>
        )}
      </View>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  tabBarWrap: { paddingHorizontal: 16, position: "relative" },
  tabBar: { flexDirection: "row", gap: 3 },
  folderTab: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  folderTabText: { fontSize: 13 },
  panel: { flex: 1, paddingTop: 14, borderTopRightRadius: 14 },
  tabScroll: { paddingHorizontal: 16, paddingBottom: 24, gap: 14 },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  field: { gap: 6 },
  label: { fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase" },
  inputRow: {
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    minHeight: 48,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 12 },
  eye: { padding: 4 },
  error: { fontSize: 13 },
  submit: {
    marginTop: 8,
    borderRadius: 999,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#FFFFFF", fontSize: 15 },
  groupCard: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { flex: 1, fontSize: 13 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheetCard: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingBottom: 24,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    marginBottom: 6,
  },
  sheetTitle: { fontSize: 17 },
  sheetBody: { paddingHorizontal: 18, gap: 10 },
  modalHint: { fontSize: 13, lineHeight: 18 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: 4,
  },
  modalError: { fontSize: 12 },
  modalCta: {
    marginTop: 6,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  modalCtaText: { color: "#FFFFFF", fontSize: 14 },
});

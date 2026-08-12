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

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { changePassword } from "@/lib/auth-api";
import * as Haptics from "@/lib/haptics";

export default function ChangePasswordScreen() {
  const colors = useColors();
  const router = useRouter();
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
      router.back();
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
      <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
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
    <SettingsSubScreen showBottomNav={false} title={t("settings.row.changePassword")}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
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
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8, gap: 14, paddingBottom: 40 },
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
});

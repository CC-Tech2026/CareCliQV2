import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

type Props = {
  visible: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
};

export function SecurityReAuthModal({ visible, busy, error, onCancel, onSubmit }: Props) {
  const colors = useColors();
  const t = useT();
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!visible) setPassword("");
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={[styles.iconWrap, { backgroundColor: colors.activeBg }]}>
              <Feather name="shield" size={18} color={colors.primary} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                {t("auth.reauth.title")}
              </Text>
              <Text style={[styles.description, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {t("auth.reauth.description")}
              </Text>
            </View>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
              {t("security.currentPassword")}
            </Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoFocus
              editable={!busy}
              placeholder={t("security.currentPassword")}
              placeholderTextColor={colors.mutedForeground}
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

          {error ? (
            <Text style={[styles.error, { fontFamily: "Inter_500Medium" }]}>{error}</Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              disabled={busy}
              style={[styles.secondaryBtn, { borderColor: colors.border, opacity: busy ? 0.55 : 1 }]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("common.cancel")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (password.trim()) onSubmit(password);
              }}
              disabled={busy || !password.trim()}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: busy || !password.trim() ? 0.55 : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
                  {t("auth.reauth.continue")}
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
    gap: 14,
  },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1, gap: 4 },
  title: { fontSize: 17, letterSpacing: -0.2 },
  description: { fontSize: 13, lineHeight: 18 },
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
  error: { fontSize: 13, color: "#B91C1C" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryBtnText: { fontSize: 13 },
  primaryBtn: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: "center",
  },
  primaryBtnText: { fontSize: 13, color: "#FFFFFF" },
});

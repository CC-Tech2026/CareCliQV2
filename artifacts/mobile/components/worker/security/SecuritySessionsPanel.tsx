import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { SecurityCardScrollList } from "@/components/worker/security/SecurityCardScrollList";
import {
  SettingsLoadingRow,
  SettingsPanelCard,
} from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import {
  useActiveSessions,
  useLogoutOtherSessions,
  useRenameSession,
} from "@/hooks/worker/useWorkerSecurity";
import { useColors } from "@/hooks/useColors";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { UserSession } from "@/lib/security-api";

export function SecuritySessionsPanel() {
  const colors = useColors();
  const t = useT();
  const { showToast } = useToast();

  const { data: sessions = [], isLoading } = useActiveSessions();
  const renameSessionMutation = useRenameSession();
  const logoutOthers = useLogoutOtherSessions();

  const [renameTarget, setRenameTarget] = useState<UserSession | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [logoutPassword, setLogoutPassword] = useState("");

  const openRename = (session: UserSession) => {
    setRenameTarget(session);
    setRenameValue(session.device_name);
  };

  const closeRename = () => {
    setRenameTarget(null);
    setRenameValue("");
  };

  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await renameSessionMutation.mutateAsync({ id: renameTarget.id, name: renameValue.trim() });
      closeRename();
      showToast(t("security.nameUpdated"), "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("security.renameFailed"),
        "error",
      );
    }
  };

  const handleLogoutOthers = async () => {
    if (!logoutPassword) return;
    try {
      const result = await logoutOthers.mutateAsync(logoutPassword);
      setLogoutPassword("");
      showToast(
        t("security.signOutOthersSuccessDesc", { count: String(result.revoked_sessions) }),
        "success",
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("security.signOutOthersFailed"),
        "error",
      );
    }
  };

  const renderSession = ({ item }: { item: UserSession }) => (
    <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={styles.rowCopy}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {item.device_name}
          </Text>
          {item.is_current ? (
            <View style={[styles.badge, { backgroundColor: colors.activeBg }]}>
              <Text style={[styles.badgeText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                {t("security.currentSession")}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("security.sessionLocation", {
            city: item.city || t("security.unknownCity"),
            country: item.country || t("security.unknownCountry"),
            when: formatRelativeTime(item.last_active_at),
          })}
        </Text>
      </View>
      <Pressable
        onPress={() => openRename(item)}
        style={[styles.iconBtn, { borderColor: colors.border }]}
        accessibilityLabel={t("security.renameDevice")}
      >
        <Feather name="edit-2" size={14} color={colors.foreground} />
      </Pressable>
    </View>
  );

  return (
    <>
      <SettingsPanelCard>
        {isLoading ? (
            <SettingsLoadingRow label={t("common.loading")} />
          ) : (
            <>
              <SecurityCardScrollList
                items={sessions}
                keyExtractor={(item) => item.id}
                renderItem={renderSession}
                emptyLabel={t("security.noActiveSessions")}
              />
              <View style={[styles.logoutSection, { borderTopColor: colors.border }]}>
                <Text style={[styles.logoutTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  {t("security.signOutAllOthers")}
                </Text>
                <View style={styles.field}>
                  <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                    {t("security.confirmPassword")}
                  </Text>
                  <TextInput
                    value={logoutPassword}
                    onChangeText={setLogoutPassword}
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
                  onPress={() => void handleLogoutOthers()}
                  disabled={logoutOthers.isPending || !logoutPassword}
                  style={[
                    styles.logoutBtn,
                    {
                      borderColor: colors.border,
                      opacity: logoutOthers.isPending || !logoutPassword ? 0.55 : 1,
                    },
                  ]}
                >
                  {logoutOthers.isPending ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <Text style={[styles.logoutBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                      {t("security.signOutOthers")}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </SettingsPanelCard>

      <Modal visible={renameTarget !== null} transparent animationType="fade" onRequestClose={closeRename}>
        <Pressable style={styles.modalBackdrop} onPress={closeRename}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                {t("security.renameDevice")}
              </Text>
              <Pressable onPress={closeRename} hitSlop={8}>
                <Feather name="x" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              style={[
                styles.modalInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={closeRename} style={[styles.modalSecondary, { borderColor: colors.border }]}>
                <Text style={[styles.modalSecondaryText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {t("common.cancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void submitRename()}
                disabled={renameSessionMutation.isPending || !renameValue.trim()}
                style={[
                  styles.modalPrimary,
                  {
                    backgroundColor: colors.primary,
                    opacity: renameSessionMutation.isPending || !renameValue.trim() ? 0.55 : 1,
                  },
                ]}
              >
                <Text style={[styles.modalPrimaryText, { fontFamily: "Inter_700Bold" }]}>
                  {t("common.save")}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  rowCopy: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  title: { fontSize: 14, lineHeight: 18 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10, letterSpacing: 0.2 },
  meta: { fontSize: 12, lineHeight: 17 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  logoutTitle: { fontSize: 14 },
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
  logoutBtn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minWidth: 180,
    alignItems: "center",
  },
  logoutBtnText: { fontSize: 13 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 17 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  modalSecondary: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalSecondaryText: { fontSize: 13 },
  modalPrimary: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalPrimaryText: { fontSize: 13, color: "#FFFFFF" },
});

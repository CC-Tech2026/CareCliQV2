import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { SecurityCardScrollList } from "@/components/worker/security/SecurityCardScrollList";
import { SecurityReAuthModal } from "@/components/worker/security/SecurityReAuthModal";
import {
  SettingsLoadingRow,
  SettingsPanelCard,
  SettingsSection,
} from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useReAuth } from "@/hooks/useReAuth";
import {
  useRenameTrustedDevice,
  useRevokeTrustedDevice,
  useTrustedDevices,
} from "@/hooks/worker/useWorkerSecurity";
import { useColors } from "@/hooks/useColors";
import { formatRelativeTime } from "@/lib/format-relative-time";
import type { TrustedDevice } from "@/lib/security-api";

export function SecurityTrustedDevicesPanel() {
  const colors = useColors();
  const t = useT();
  const { showToast } = useToast();

  const { data: devices = [], isLoading } = useTrustedDevices();
  const renameDevice = useRenameTrustedDevice();
  const revokeDevice = useRevokeTrustedDevice();
  const { open: reauthOpen, busy: reauthBusy, error: reauthError, requireReAuth, cancel: cancelReauth, submit: submitReauth } = useReAuth();

  const [renameTarget, setRenameTarget] = useState<TrustedDevice | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const openRename = (device: TrustedDevice) => {
    setRenameTarget(device);
    setRenameValue(device.device_name);
  };

  const closeRename = () => {
    setRenameTarget(null);
    setRenameValue("");
  };

  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await renameDevice.mutateAsync({ id: renameTarget.id, name: renameValue.trim() });
      closeRename();
      showToast(t("security.nameUpdated"), "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("security.renameFailed"),
        "error",
      );
    }
  };

  const handleRevokeDevice = async (device: TrustedDevice) => {
    try {
      const result = await requireReAuth(async () => {
        await revokeDevice.mutateAsync(device.id);
        return true;
      });
      if (result) {
        showToast(t("security.deviceRemoved"), "success");
      }
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : t("security.renameFailed"),
        "error",
      );
    }
  };

  const renderDevice = ({ item }: { item: TrustedDevice }) => (
    <View style={[styles.row, { borderColor: colors.border, backgroundColor: colors.background }]}>
      <View style={styles.rowCopy}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {item.device_name}
          </Text>
          {item.is_current ? (
            <View style={[styles.badge, { backgroundColor: colors.activeBg }]}>
              <Text style={[styles.badgeText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                {t("security.thisDevice")}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("security.trustedUntil", {
            os: item.os_name,
            when: formatRelativeTime(item.trusted_until),
          })}
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => openRename(item)}
          style={[styles.iconBtn, { borderColor: colors.border }]}
          accessibilityLabel={t("security.renameDevice")}
        >
          <Feather name="edit-2" size={14} color={colors.foreground} />
        </Pressable>
        <Pressable
          onPress={() => void handleRevokeDevice(item)}
          style={[styles.iconBtn, { borderColor: "rgba(239, 68, 68, 0.35)" }]}
          accessibilityLabel={t("common.remove")}
        >
          <Feather name="trash-2" size={14} color="#B91C1C" />
        </Pressable>
      </View>
    </View>
  );

  return (
    <>
      <SettingsSection
        title={t("security.trustedDevices")}
        description={t("security.trustedDevicesHint")}
        icon="smartphone"
      >
        <SettingsPanelCard>
          {isLoading ? (
            <SettingsLoadingRow label={t("common.loading")} />
          ) : (
            <SecurityCardScrollList
              items={devices}
              keyExtractor={(item) => item.id}
              renderItem={renderDevice}
              emptyLabel={t("security.noTrustedDevices")}
            />
          )}
        </SettingsPanelCard>
      </SettingsSection>

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
                disabled={renameDevice.isPending || !renameValue.trim()}
                style={[
                  styles.modalPrimary,
                  {
                    backgroundColor: colors.primary,
                    opacity: renameDevice.isPending || !renameValue.trim() ? 0.55 : 1,
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

      <SecurityReAuthModal
        visible={reauthOpen}
        busy={reauthBusy}
        error={reauthError}
        onCancel={cancelReauth}
        onSubmit={(password) => void submitReauth(password)}
      />
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
  actions: { flexDirection: "row", gap: 8 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
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

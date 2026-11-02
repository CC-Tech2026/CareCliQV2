import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsPanelCard } from "@/components/worker/settings/settings-ui";
import { SettingsSettingRow } from "@/components/worker/settings/SettingsSettingRow";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { enablePushOnThisDevice, getPushPermission, type PushPermission } from "@/hooks/useExpoPush";
import {
  getNotificationPreferences,
  saveNotificationPreferences,
  sendTestNotification,
  WORKER_NOTIFICATION_GROUPS,
  type NotificationPrefs,
  type QuietHours,
} from "@/lib/notification-preferences";
import { getMobileDeviceId } from "@/lib/session";

type Channel = "push" | "email";

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

/** "22:00" -> "10:00 pm", how the rest of the app shows times. */
function formatTime(value: string): string {
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h)) return value;
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * Worker notification settings, the mobile twin of the web profile's
 * Notifications section: this phone's permission and a test, what pops up or
 * is emailed per group of events, and quiet hours. Each change saves on its own.
 */
export default function WorkerNotificationSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();

  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [testing, setTesting] = useState(false);

  const deviceIdRef = useRef<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [quiet, setQuiet] = useState<QuietHours | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerScrollRef = useRef<ScrollView>(null);

  const refreshPermission = useCallback(() => {
    void getPushPermission().then(setPermission);
  }, []);

  // Coming back from the phone's settings may have changed the permission.
  useEffect(() => {
    refreshPermission();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const deviceId = await getMobileDeviceId();
      deviceIdRef.current = deviceId;
      const data = await getNotificationPreferences(deviceId);
      setPrefs(data.preferences);
      setQuiet(data.quietHours);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [load]);

  // Debounced, so flicking several switches in a row is one save.
  function persist(nextPrefs: NotificationPrefs, nextQuiet: QuietHours) {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveNotificationPreferences(deviceId, nextPrefs, nextQuiet);
        setStatus("saved");
      } catch {
        setStatus("idle");
        showToast(t("notifPrefs.saveFailed"), "error");
      }
    }, 500);
  }

  function groupChecked(keys: readonly string[], channel: Channel): boolean {
    return keys.some((key) => prefs?.[key]?.[channel] ?? true);
  }

  function toggleGroup(keys: readonly string[], channel: Channel) {
    if (!prefs || !quiet) return;
    const value = !groupChecked(keys, channel);
    const next = { ...prefs };
    for (const key of keys) next[key] = { ...(next[key] ?? { push: true, email: true, sms: false }), [channel]: value };
    setPrefs(next);
    persist(next, quiet);
  }

  function updateQuiet(patch: Partial<QuietHours>) {
    if (!prefs || !quiet) return;
    const next = { ...quiet, ...patch };
    setQuiet(next);
    persist(prefs, next);
  }

  async function handleEnable() {
    if (permission === "denied") {
      void Linking.openSettings();
      return;
    }
    setEnabling(true);
    try {
      setPermission(await enablePushOnThisDevice());
    } finally {
      setEnabling(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const result = await sendTestNotification();
      showToast(
        result.app.devices > 0 ? t("notifPrefs.device.testSent") : t("notifPrefs.device.testNoPhone"),
        result.app.devices > 0 ? "success" : "error",
      );
    } catch {
      showToast(t("notifPrefs.device.testFailed"), "error");
    } finally {
      setTesting(false);
    }
  }

  const permissionCopy: Record<PushPermission, { icon: keyof typeof Feather.glyphMap; tone: string; text: string }> = {
    granted: { icon: "bell", tone: colors.success, text: t("notifPrefs.device.granted") },
    undetermined: { icon: "bell-off", tone: colors.warning, text: t("notifPrefs.device.undetermined") },
    denied: { icon: "bell-off", tone: colors.destructive, text: t("notifPrefs.device.denied") },
    unavailable: { icon: "slash", tone: colors.mutedForeground, text: t("notifPrefs.device.unavailable") },
  };
  const device = permission ? permissionCopy[permission] : null;

  return (
    <SettingsSubScreen title={t("notifPrefs.screenTitle")} showBack>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
        <SettingsPanelCard label={t("notifPrefs.device.title")}>
          {!device ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.deviceBody}>
              <View style={styles.deviceStatus}>
                <Feather name={device.icon} size={18} color={device.tone} style={{ marginTop: 1 }} />
                <Text style={[styles.body, { color: colors.foreground, fontFamily: FontFamily.interRegular }]}>{device.text}</Text>
              </View>
              {(permission === "undetermined" || permission === "denied") && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void handleEnable()}
                  disabled={enabling}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: enabling ? 0.6 : 1 }]}
                >
                  {enabling ? (
                    <ActivityIndicator color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.primaryBtnText, { color: colors.primaryForeground, fontFamily: FontFamily.interBold }]}>
                      {permission === "denied" ? t("notifPrefs.device.openSettings") : t("notifPrefs.device.turnOn")}
                    </Text>
                  )}
                </Pressable>
              )}
              {permission === "granted" && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void handleTest()}
                  disabled={testing}
                  style={[styles.secondaryBtn, { borderColor: colors.border, opacity: testing ? 0.6 : 1 }]}
                >
                  {testing ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <>
                      <Feather name="send" size={15} color={colors.primary} />
                      <Text style={[styles.secondaryBtnText, { color: colors.primary, fontFamily: FontFamily.interSemiBold }]}>
                        {t("notifPrefs.device.sendTest")}
                      </Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
          )}
        </SettingsPanelCard>

        <SettingsPanelCard label={t("notifPrefs.title")}>
          <View style={styles.prefsHeader}>
            <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: FontFamily.interRegular }]}>{t("notifPrefs.hint")}</Text>
            <Text accessibilityLiveRegion="polite" style={[styles.status, { color: colors.mutedForeground, fontFamily: FontFamily.interSemiBold }]}>
              {status === "saving" ? t("notifPrefs.saving") : status === "saved" ? t("notifPrefs.saved") : " "}
            </Text>
          </View>
          {loadFailed ? (
            <View style={styles.failed}>
              <Text style={[styles.body, { color: colors.destructive, fontFamily: FontFamily.interRegular }]}>{t("notifPrefs.loadFailed")}</Text>
              <Pressable accessibilityRole="button" onPress={() => void load()} style={[styles.secondaryBtn, { borderColor: colors.border }]}>
                <Text style={[styles.secondaryBtnText, { color: colors.primary, fontFamily: FontFamily.interSemiBold }]}>{t("notifPrefs.retry")}</Text>
              </Pressable>
            </View>
          ) : !prefs ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            WORKER_NOTIFICATION_GROUPS.map((group, index) => {
              const label = t(`notifPrefs.worker.${group.id}` as never);
              return (
                <View
                  key={group.id}
                  style={[
                    styles.groupRow,
                    index < WORKER_NOTIFICATION_GROUPS.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  <Text style={[styles.groupTitle, { color: colors.foreground, fontFamily: FontFamily.interSemiBold }]}>{label}</Text>
                  <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: FontFamily.interRegular }]}>
                    {t(`notifPrefs.worker.${group.id}.hint` as never)}
                  </Text>
                  <View style={styles.channels}>
                    {(["push", "email"] as const).map((channel) => {
                      const channelLabel = channel === "push" ? t("notifPrefs.popup") : t("notifPrefs.email");
                      return (
                        <View key={channel} style={styles.channel}>
                          <Text style={[styles.channelLabel, { color: colors.foreground, fontFamily: FontFamily.interMedium }]}>{channelLabel}</Text>
                          <Switch
                            accessibilityLabel={`${channelLabel}: ${label}`}
                            value={groupChecked(group.keys, channel)}
                            onValueChange={() => toggleGroup(group.keys, channel)}
                            trackColor={{ false: colors.border, true: colors.primary }}
                            thumbColor="#FFFFFF"
                          />
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })
          )}
        </SettingsPanelCard>

        {prefs && quiet && (
          <SettingsPanelCard label={t("notifPrefs.quiet.title")}>
            <SettingsSettingRow
              title={t("notifPrefs.quiet.title")}
              description={t("notifPrefs.quiet.hint")}
              checked={quiet.enabled}
              onCheckedChange={(enabled) => updateQuiet({ enabled })}
            />
            {quiet.enabled && (
              <View style={styles.timeRow}>
                {(["from", "to"] as const).map((which) => (
                  <Pressable
                    key={which}
                    accessibilityRole="button"
                    accessibilityLabel={`${t(which === "from" ? "notifPrefs.quiet.from" : "notifPrefs.quiet.to")} ${formatTime(quiet[which])}`}
                    onPress={() => setPicking(which)}
                    style={[styles.timeChip, { borderColor: colors.border, backgroundColor: colors.background }]}
                  >
                    <Text style={[styles.timeLabel, { color: colors.mutedForeground, fontFamily: FontFamily.interSemiBold }]}>
                      {t(which === "from" ? "notifPrefs.quiet.from" : "notifPrefs.quiet.to")}
                    </Text>
                    <Text style={[styles.timeValue, { color: colors.foreground, fontFamily: FontFamily.interBold }]}>{formatTime(quiet[which])}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </SettingsPanelCard>
        )}
      </ScrollView>

      <Modal visible={picking !== null} transparent animationType="slide" onRequestClose={() => setPicking(null)}>
        <Pressable style={styles.backdrop} onPress={() => setPicking(null)} accessibilityLabel={t("notifPrefs.quiet.pick")} />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 12 }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground, fontFamily: FontFamily.interBold }]}>{t("notifPrefs.quiet.pick")}</Text>
          <ScrollView
            ref={pickerScrollRef}
            style={styles.sheetList}
            // Open at the current choice rather than midnight (rows are 48 high).
            onLayout={() => {
              const index = picking && quiet ? TIMES.indexOf(quiet[picking]) : -1;
              if (index > 2) pickerScrollRef.current?.scrollTo({ y: (index - 2) * 48, animated: false });
            }}
          >
            {TIMES.map((time) => {
              const selected = picking !== null && quiet?.[picking] === time;
              return (
                <Pressable
                  key={time}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    if (picking) updateQuiet({ [picking]: time });
                    setPicking(null);
                  }}
                  style={[styles.sheetItem, selected && { backgroundColor: colors.activeBg }]}
                >
                  <Text style={[styles.sheetItemText, { color: selected ? colors.primary : colors.foreground, fontFamily: selected ? FontFamily.interBold : FontFamily.interRegular }]}>
                    {formatTime(time)}
                  </Text>
                  {selected && <Feather name="check" size={16} color={colors.primary} />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, gap: 16 },
  deviceBody: { gap: 14 },
  deviceStatus: { flexDirection: "row", gap: 10 },
  body: { flex: 1, fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 12, lineHeight: 18 },
  primaryBtn: { minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primaryBtnText: { fontSize: 15 },
  secondaryBtn: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  secondaryBtnText: { fontSize: 14 },
  prefsHeader: { gap: 6, marginBottom: 4 },
  status: { fontSize: 12, alignSelf: "flex-end" },
  failed: { gap: 12 },
  groupRow: { paddingVertical: 14, gap: 4 },
  groupTitle: { fontSize: 14, lineHeight: 20 },
  channels: { flexDirection: "row", gap: 20, marginTop: 6 },
  channel: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  channelLabel: { fontSize: 13 },
  timeRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  timeChip: { flex: 1, minHeight: 56, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, justifyContent: "center" },
  timeLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8 },
  timeValue: { fontSize: 16, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, maxHeight: "60%" },
  sheetTitle: { fontSize: 16, paddingHorizontal: 20, paddingBottom: 8 },
  sheetList: { paddingHorizontal: 8 },
  sheetItem: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, borderRadius: 12 },
  sheetItemText: { fontSize: 15 },
});

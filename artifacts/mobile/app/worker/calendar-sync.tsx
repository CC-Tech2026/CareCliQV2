import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsPanelCard } from "@/components/worker/settings/settings-ui";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import {
  calendarFeedUrl,
  calendarSubscribeLinks,
  createCalendarFeed,
  getCalendarFeedStatus,
  stopCalendarFeed,
} from "@/lib/calendar-feed-api";
import { copyText } from "@/lib/copy-text";
import { formatRelativeTime } from "@/lib/format-relative-time";

const STATUS_KEY = ["worker", "calendar-feed"];

type FeatherIconName = keyof typeof Feather.glyphMap;

/**
 * Shifts into the worker's own calendar: a private link that Google
 * Calendar, Outlook or the phone's calendar subscribes to and keeps
 * checking. The link is shown once (only its hash is stored), so making a
 * new one replaces the old.
 */
export default function CalendarSyncScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const qc = useQueryClient();
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const status = useQuery({ queryKey: STATUS_KEY, queryFn: getCalendarFeedStatus, staleTime: 30_000 });

  const make = useMutation({
    mutationFn: createCalendarFeed,
    onSuccess: (res) => {
      setFeedUrl(calendarFeedUrl(res.feed_path));
      setConfirmStop(false);
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (e: Error) => showToast(e.message || t("calendarSync.failed"), "error"),
  });

  const stop = useMutation({
    mutationFn: stopCalendarFeed,
    onSuccess: () => {
      setFeedUrl(null);
      setConfirmStop(false);
      showToast(t("calendarSync.stopped"));
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (e: Error) => showToast(e.message || t("calendarSync.failed"), "error"),
  });

  const open = (url: string) => {
    void Linking.openURL(url).catch(() => showToast(t("calendarSync.openFailed"), "error"));
  };

  const shareLink = async () => {
    if (!feedUrl) return;
    if (Platform.OS === "web") {
      try {
        await copyText(feedUrl);
        showToast(t("calendarSync.copied"));
      } catch {
        showToast(t("calendarSync.failed"), "error");
      }
      return;
    }
    await Share.share({ message: feedUrl });
  };

  const links = feedUrl ? calendarSubscribeLinks(feedUrl) : null;
  const active = status.data?.active ?? false;
  const textStyle = { color: colors.foreground, fontFamily: FontFamily.body };
  const mutedStyle = { color: colors.mutedForeground, fontFamily: FontFamily.body };

  const optionRow = (icon: FeatherIconName, label: string, onPress: () => void, last = false) => (
    <Pressable
      key={label}
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        !last && { borderBottomWidth: 1, borderBottomColor: colors.soft },
        pressed && { backgroundColor: colors.soft },
      ]}
    >
      <View style={[styles.optionIcon, { backgroundColor: colors.soft }]}>
        <Feather name={icon} size={15} color={colors.primary} />
      </View>
      <Text style={[styles.optionLabel, { color: colors.foreground, fontFamily: FontFamily.interMedium }]}>{label}</Text>
      <Feather name="external-link" size={15} color={colors.mutedForeground} />
    </Pressable>
  );

  const primaryButton = (label: string, onPress: () => void, busy: boolean, tone: "brand" | "danger" = "brand") => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy}
      style={[
        styles.button,
        { backgroundColor: tone === "danger" ? colors.destructive : colors.primary, opacity: busy ? 0.6 : 1 },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
      <Text style={[styles.buttonText, { fontFamily: FontFamily.interSemiBold }]}>{label}</Text>
    </Pressable>
  );

  const secondaryButton = (label: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.soft : "transparent" },
      ]}
    >
      <Text style={[styles.buttonText, { color: colors.foreground, fontFamily: FontFamily.interMedium }]}>{label}</Text>
    </Pressable>
  );

  return (
    <SettingsSubScreen title={t("calendarSync.title")} showBack>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, mutedStyle]}>{t("calendarSync.intro")}</Text>

        {status.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : links && feedUrl ? (
          <>
            <SettingsPanelCard label={t("calendarSync.pick")}>
              {optionRow("calendar", t("calendarSync.apple"), () => open(links.webcal))}
              {optionRow("globe", t("calendarSync.google"), () => open(links.google))}
              {optionRow("mail", t("calendarSync.outlook"), () => open(links.outlook), true)}
            </SettingsPanelCard>
            <View style={[styles.linkBox, { backgroundColor: colors.soft }]}>
              <Text style={[styles.small, mutedStyle]}>{t("calendarSync.linkLabel")}</Text>
              <Text selectable style={[styles.link, textStyle]}>{feedUrl}</Text>
              {secondaryButton(t(Platform.OS === "web" ? "calendarSync.copy" : "calendarSync.share"), () => void shareLink())}
            </View>
            <Text style={[styles.small, mutedStyle]}>{t("calendarSync.linkHint")}</Text>
          </>
        ) : active ? (
          <SettingsPanelCard>
            <View style={styles.statusBody}>
              <Text style={[styles.statusTitle, { color: colors.foreground, fontFamily: FontFamily.interSemiBold }]}>
                {t("calendarSync.active")}
              </Text>
              <Text style={[styles.small, mutedStyle]}>
                {status.data?.last_accessed_at
                  ? t("calendarSync.lastChecked", { time: formatRelativeTime(status.data.last_accessed_at) })
                  : t("calendarSync.notChecked")}
              </Text>
              <Text style={[styles.small, mutedStyle]}>
                {t(confirmStop ? "calendarSync.stopHint" : "calendarSync.newLinkHint")}
              </Text>
            </View>
          </SettingsPanelCard>
        ) : null}

        <View style={styles.actions}>
          {!status.isLoading && !feedUrl && !active
            ? primaryButton(t("calendarSync.connect"), () => make.mutate(), make.isPending)
            : null}
          {!status.isLoading && !feedUrl && active ? (
            confirmStop ? (
              <>
                {primaryButton(t("calendarSync.stop"), () => stop.mutate(), stop.isPending, "danger")}
                {secondaryButton(t("common.cancel"), () => setConfirmStop(false))}
              </>
            ) : (
              <>
                {primaryButton(t("calendarSync.newLink"), () => make.mutate(), make.isPending)}
                {secondaryButton(t("calendarSync.stop"), () => setConfirmStop(true))}
              </>
            )
          ) : null}
        </View>

        <View style={styles.notes}>
          <Text style={[styles.small, mutedStyle]}>{t("calendarSync.privacy")}</Text>
          <Text style={[styles.small, mutedStyle]}>{t("calendarSync.delay")}</Text>
        </View>
      </ScrollView>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  intro: { fontSize: 14, lineHeight: 20 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingVertical: 10 },
  optionIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  optionLabel: { flex: 1, fontSize: 15 },
  linkBox: { borderRadius: 12, padding: 12, gap: 8 },
  link: { fontSize: 12, lineHeight: 17 },
  small: { fontSize: 13, lineHeight: 19 },
  statusBody: { gap: 6 },
  statusTitle: { fontSize: 15 },
  actions: { gap: 10 },
  button: {
    minHeight: 48,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  buttonText: { color: "#FFFFFF", fontSize: 15 },
  notes: { gap: 8 },
});

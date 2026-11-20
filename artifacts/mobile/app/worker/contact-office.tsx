import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CopyButton } from "@/components/worker/CopyButton";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { FontFamily } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useWorkerLandingDashboard } from "@/hooks/worker/useWorkerLandingDashboard";
import type { TranslationKey } from "@/lib/i18n/translations";
import { copyText } from "@/lib/copy-text";
import { localDayKey } from "@/components/worker/WeekCalendar";
import { formatDayKey } from "@/hooks/worker/useWorkerCalendar";
import { formatTime } from "@/lib/shift-utils";
import { getOfficeContacts, type OfficeContact } from "@/lib/user-api";

type Reason = "sick" | "cantMake" | "late" | "other";

const REASONS: {
  key: Reason;
  icon: keyof typeof Feather.glyphMap;
  title: TranslationKey;
  hint: TranslationKey;
}[] = [
  {
    key: "sick",
    icon: "thermometer",
    title: "office.reason.sick",
    hint: "office.reason.sickHint",
  },
  {
    key: "cantMake",
    icon: "calendar",
    title: "office.reason.cantMake",
    hint: "office.reason.cantMakeHint",
  },
  {
    key: "late",
    icon: "clock",
    title: "office.reason.late",
    hint: "office.reason.lateHint",
  },
  {
    key: "other",
    icon: "message-circle",
    title: "office.reason.other",
    hint: "office.reason.otherHint",
  },
];

const TEMPLATE: Record<Reason, TranslationKey> = {
  sick: "office.template.sick",
  cantMake: "office.template.cantMake",
  late: "office.template.late",
  other: "office.template.other",
};

/** "today, 2:00 pm" or "Mon 23 Nov, 9:00 am" for a message to the office. */
function shiftWhen(
  start: string | undefined,
  tz: string | null | undefined,
  todayWord: string,
): string {
  if (!start) return "";
  const day = localDayKey(new Date(start));
  const dayText =
    day === localDayKey(new Date())
      ? todayWord.toLowerCase()
      : formatDayKey(day, { weekday: "short", day: "numeric", month: "short" });
  return `${dayText}, ${formatTime(start, tz)}`;
}

/** sms: links put the body after "&" on iPhone and "?" on Android. */
function smsUrl(phone: string, body: string) {
  const number = phone.replace(/[^\d+]/g, "");
  return `sms:${number}${Platform.OS === "ios" ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

/**
 * Reach the office fast: ready-made messages for being sick, not making a
 * shift or running late, and the coordinator and office numbers to call,
 * text, email or copy.
 */
export default function ContactOfficeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const { isAuthenticated, user } = useAuth();
  const landing = useWorkerLandingDashboard();
  const contacts = useQuery({
    queryKey: ["worker", "office-contacts"],
    queryFn: getOfficeContacts,
    enabled: isAuthenticated,
  });

  const [reason, setReason] = useState<Reason | null>(null);
  const [message, setMessage] = useState("");

  const coordinator = contacts.data?.coordinator ?? null;
  const office = contacts.data?.office ?? null;
  // Text the coordinator when we have them, otherwise the office line.
  const textTo = coordinator?.phone
    ? coordinator
    : office?.phone
      ? office
      : null;
  const emailTo = coordinator?.email
    ? coordinator
    : office?.email
      ? office
      : null;

  const next = landing.data?.next_shift;
  const shiftLine = useMemo(
    () =>
      next
        ? t("office.template.shift", {
            name: next.participant_name,
            when: shiftWhen(
              next.scheduled_start,
              next.timezone,
              t("calendar.today"),
            ),
          })
        : t("office.template.noShift"),
    [next, t],
  );

  const openReason = (key: Reason) => {
    const myName = landing.data?.worker.full_name || user?.full_name || "";
    const hello = coordinator?.name
      ? t("office.template.helloName", { name: coordinator.name.split(" ")[0] })
      : t("office.template.hello");
    setMessage(
      [
        hello,
        // "Something else" starts with just the greeting and sign-off.
        key === "other" ? "" : t(TEMPLATE[key], { shift: shiftLine }),
        t("office.template.thanks", { name: myName }),
      ]
        .filter((part) => part.trim())
        .join("\n\n"),
    );
    setReason(key);
  };

  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      showToast(t("office.openFailed"), "error");
    }
  };

  const contactCard = (person: OfficeContact, role: string) => (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.personHead}>
        <View style={[styles.avatar, { backgroundColor: colors.soft }]}>
          <Feather
            name={role === "office" ? "home" : "user"}
            size={18}
            color={colors.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.personName,
              {
                color: colors.foreground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {person.name || t("office.office")}
          </Text>
          <Text
            style={[
              styles.personRole,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {role === "office"
              ? t("office.office")
              : t("office.yourCoordinator")}
          </Text>
        </View>
      </View>
      {person.phone ? (
        <View style={styles.contactRow}>
          <Text
            selectable
            style={[
              styles.contactValue,
              { color: colors.foreground, fontFamily: FontFamily.interMedium },
            ]}
          >
            {person.phone}
          </Text>
          <CopyButton value={person.phone} label={person.phone} />
        </View>
      ) : null}
      {person.phone ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void open(`tel:${person.phone!.replace(/[^\d+]/g, "")}`)
            }
            style={[styles.action, { backgroundColor: colors.primary }]}
          >
            <Feather name="phone" size={16} color={colors.primaryForeground} />
            <Text
              style={[
                styles.actionText,
                {
                  color: colors.primaryForeground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("office.call")}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void open(smsUrl(person.phone!, ""))}
            style={[
              styles.action,
              { borderColor: colors.primary, borderWidth: 1.5 },
            ]}
          >
            <Feather name="message-square" size={16} color={colors.primary} />
            <Text
              style={[
                styles.actionText,
                { color: colors.primary, fontFamily: FontFamily.interSemiBold },
              ]}
            >
              {t("office.text")}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {person.email ? (
        <View style={styles.contactRow}>
          <Pressable
            accessibilityRole="link"
            style={{ flex: 1 }}
            onPress={() => void open(`mailto:${person.email}`)}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.contactValue,
                { color: colors.primary, fontFamily: FontFamily.interMedium },
              ]}
            >
              {person.email}
            </Text>
          </Pressable>
          <CopyButton value={person.email} label={person.email} />
        </View>
      ) : null}
    </View>
  );

  return (
    <WorkerStackScreen
      headerTitle={t("office.title")}
      cardsOnBackground
      showBack
      guide="contactOffice"
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <View style={[styles.emergency, { backgroundColor: colors.dangerBg }]}>
          <Feather name="alert-triangle" size={16} color={colors.dangerIcon} />
          <Text
            style={[
              styles.emergencyText,
              { color: colors.dangerText, fontFamily: FontFamily.interMedium },
            ]}
          >
            {t("office.emergency")}
          </Text>
        </View>

        <Text
          style={[
            styles.section,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {t("office.whatNeed")}
        </Text>
        <View style={styles.reasons}>
          {REASONS.map((item) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              onPress={() => openReason(item.key)}
              style={({ pressed }) => [
                styles.reason,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View
                style={[styles.reasonIcon, { backgroundColor: colors.soft }]}
              >
                <Feather name={item.icon} size={18} color={colors.primary} />
              </View>
              <Text
                style={[
                  styles.reasonTitle,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t(item.title)}
              </Text>
              <Text
                style={[
                  styles.reasonHint,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interRegular,
                  },
                ]}
              >
                {t(item.hint)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text
          style={[
            styles.section,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {t("office.who")}
        </Text>
        {contacts.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : !coordinator && !office?.phone && !office?.email ? (
          <Text
            style={[
              styles.empty,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {t("office.none")}
          </Text>
        ) : (
          <>
            {coordinator ? contactCard(coordinator, "coordinator") : null}
            {office && (office.phone || office.email)
              ? contactCard(office, "office")
              : null}
          </>
        )}
      </ScrollView>

      <Modal
        visible={reason !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setReason(null)}
      >
        <KeyboardAvoidingView
          style={styles.sheetRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={styles.backdrop}
            onPress={() => setReason(null)}
            accessible={false}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 18,
              },
            ]}
          >
            <View
              style={[styles.grabber, { backgroundColor: colors.border }]}
            />
            <Text
              style={[
                styles.sheetTitle,
                { color: colors.foreground, fontFamily: FontFamily.display },
              ]}
            >
              {reason ? t(REASONS.find((r) => r.key === reason)!.title) : ""}
            </Text>
            {reason === "cantMake" || reason === "sick" ? (
              <Text
                style={[
                  styles.reasonHint,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interRegular,
                  },
                ]}
              >
                {t("office.callForToday")}
              </Text>
            ) : null}
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              accessibilityLabel={t("office.message")}
              style={[
                styles.messageInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            />
            <View style={styles.sheetActions}>
              {textTo?.phone ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void open(smsUrl(textTo.phone!, message))}
                  style={[styles.sheetBtn, { backgroundColor: colors.primary }]}
                >
                  <Feather
                    name="message-square"
                    size={17}
                    color={colors.primaryForeground}
                  />
                  <Text
                    style={[
                      styles.sheetBtnText,
                      {
                        color: colors.primaryForeground,
                        fontFamily: FontFamily.interSemiBold,
                      },
                    ]}
                  >
                    {t("office.sendText", {
                      name: textTo.name?.split(" ")[0] || t("office.office"),
                    })}
                  </Text>
                </Pressable>
              ) : null}
              <View style={styles.sheetRow}>
                {emailTo?.email ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      void open(
                        `mailto:${emailTo.email}?subject=${encodeURIComponent(t(REASONS.find((r) => r.key === reason)!.title))}&body=${encodeURIComponent(message)}`,
                      )
                    }
                    style={[
                      styles.sheetBtn,
                      styles.half,
                      { borderColor: colors.primary, borderWidth: 1.5 },
                    ]}
                  >
                    <Feather name="mail" size={17} color={colors.primary} />
                    <Text
                      style={[
                        styles.sheetBtnText,
                        {
                          color: colors.primary,
                          fontFamily: FontFamily.interSemiBold,
                        },
                      ]}
                    >
                      {t("office.email")}
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    void copyText(message)
                      .then(() => showToast(t("copy.copied"), "success"))
                      .catch(() => showToast(t("copy.failed"), "error"))
                  }
                  style={[
                    styles.sheetBtn,
                    styles.half,
                    { borderColor: colors.border, borderWidth: 1 },
                  ]}
                >
                  <Feather name="copy" size={17} color={colors.foreground} />
                  <Text
                    style={[
                      styles.sheetBtnText,
                      {
                        color: colors.foreground,
                        fontFamily: FontFamily.interSemiBold,
                      },
                    ]}
                  >
                    {t("office.copyMessage")}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  emergency: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
  },
  emergencyText: { flex: 1, fontSize: 14, lineHeight: 19 },
  section: { fontSize: 17, marginTop: 8 },
  reasons: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  reason: {
    width: "48%",
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    gap: 6,
  },
  reasonIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  reasonTitle: { fontSize: 15, lineHeight: 20 },
  reasonHint: { fontSize: 13, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 12 },
  personHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  personName: { fontSize: 16 },
  personRole: { fontSize: 13 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  contactValue: { flex: 1, fontSize: 16 },
  actions: { flexDirection: "row", gap: 10 },
  action: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontSize: 15 },
  empty: { fontSize: 15, lineHeight: 21 },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26,26,46,0.45)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 10,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  sheetTitle: { fontSize: 21, lineHeight: 27 },
  messageInput: {
    minHeight: 150,
    maxHeight: 260,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  sheetActions: { gap: 10, marginTop: 4 },
  sheetRow: { flexDirection: "row", gap: 10 },
  sheetBtn: {
    flexDirection: "row",
    gap: 8,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  half: { flex: 1 },
  sheetBtnText: { fontSize: 16 },
});

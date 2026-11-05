import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { ShiftDateBlock } from "@/components/worker/ShiftDateBlock";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { ShiftOfferSummary } from "@/lib/worker-api";
import {
  formatDateInZone,
  formatDurationLabel,
  formatTime,
  shiftDurationMinutes,
  zoneAbbreviation,
} from "@/lib/shift-utils";

type Props = {
  offer: ShiftOfferSummary;
  onAccept: () => Promise<void>;
  onDecline: (reason?: string) => Promise<void>;
  /** In a list (Shifts tab) the card sits in the page gutter, not inset. */
  inList?: boolean;
};

const DECLINE_REASONS = ["clash", "distance", "skills", "availability", "unwell", "other"] as const;
type DeclineReason = (typeof DECLINE_REASONS)[number];

/** Decision-only card for a pending shift offer: deliberately shows just
 * enough to decide (participant first name, suburb, timing, shift type),
 * never the full participant profile. That stays locked server-side until
 * the worker accepts (getWorkerShift 403s a pending offer by design).
 * Declining asks why, so the coordinator knows whether to re-offer it. */
export function ShiftOfferCard({ offer, onAccept, onDecline, inList = false }: Props) {
  const colors = useColors();
  const t = useT();
  const isDark = colors.scheme === "dark";
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason | null>(null);
  const [otherText, setOtherText] = useState("");

  const tz = offer.timezone;
  const start = offer.scheduled_start;
  const end = offer.scheduled_end;
  const duration = formatDurationLabel(shiftDurationMinutes(start ?? undefined, end ?? undefined, offer.duration_minutes ?? undefined));
  const timeLine = start
    ? [
        `${formatDateInZone(start, tz, { weekday: "long" })}, ${formatTime(start, tz)}${end ? ` – ${formatTime(end, tz)}` : ""} ${zoneAbbreviation(start, tz)}`,
        duration,
      ]
        .filter(Boolean)
        .join(" · ")
    : t("shifts.listCard.timeTbc");
  const answerBy = offer.responds_by
    ? t("offers.answerBy", {
        time: `${formatDateInZone(offer.responds_by, tz, { weekday: "short" })} ${formatTime(offer.responds_by, tz)}`,
      })
    : null;
  const shiftType = offer.shift_type ? offer.shift_type.replace(/_/g, " ") : null;

  const handleAccept = async () => {
    if (busy) return;
    setBusy("accept");
    try {
      await onAccept();
    } finally {
      setBusy(null);
    }
  };

  const declineReasonText = () => {
    if (reason === "other") return otherText.trim() || t("offers.reason.other");
    return reason ? t(`offers.reason.${reason}` as TranslationKey) : undefined;
  };

  const handleDecline = async () => {
    if (busy || !reason) return;
    setBusy("decline");
    try {
      await onDecline(declineReasonText());
    } finally {
      setBusy(null);
    }
  };

  const text = (weight: string, size: number, color: string) => ({ fontFamily: weight, fontSize: size, color });

  return (
    <View
      style={[
        styles.card,
        !inList && styles.inset,
        elevatedCardShadow(isDark),
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.topRow}>
        <Text style={[styles.eyebrow, text(FontFamily.interBold, 11, colors.primary)]}>{t("offers.eyebrow")}</Text>
        {answerBy && (
          <Text style={text(FontFamily.interMedium, 11, colors.mutedForeground)} numberOfLines={1}>
            {answerBy}
          </Text>
        )}
      </View>

      <View style={styles.body}>
        <ShiftDateBlock iso={start} timezone={tz} />
        <View style={styles.details}>
          <Text style={text(FontFamily.interBold, 16, colors.foreground)} numberOfLines={1}>
            {t("offers.with", { name: offer.participant_first_name ?? t("offers.someone") })}
          </Text>
          <View style={styles.metaRow}>
            <Feather name="clock" size={12} color={colors.mutedForeground} />
            <Text style={[styles.meta, text(FontFamily.interMedium, 12, colors.mutedForeground)]}>{timeLine}</Text>
          </View>
          {offer.suburb && (
            <View style={styles.metaRow}>
              <Feather name="map-pin" size={12} color={colors.mutedForeground} />
              <Text style={[styles.meta, text(FontFamily.interMedium, 12, colors.mutedForeground)]} numberOfLines={1}>
                {offer.suburb}
              </Text>
            </View>
          )}
          {shiftType && (
            <View style={styles.metaRow}>
              <Feather name="heart" size={12} color={colors.primary} />
              <Text style={[styles.meta, styles.capitalise, text(FontFamily.interMedium, 12, colors.primary)]} numberOfLines={1}>
                {shiftType}
              </Text>
            </View>
          )}
        </View>
      </View>

      {declining ? (
        <View style={styles.declineForm}>
          <Text style={text(FontFamily.interBold, 14, colors.foreground)}>{t("offers.declineTitle")}</Text>
          <View accessibilityRole="radiogroup" style={styles.reasons}>
            {DECLINE_REASONS.map((key) => {
              const on = reason === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setReason(key)}
                  style={[
                    styles.reasonRow,
                    { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.soft : "transparent" },
                  ]}
                >
                  <View style={[styles.radio, { borderColor: on ? colors.primary : colors.border }]}>
                    {on && <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />}
                  </View>
                  <Text style={[styles.reasonText, text(FontFamily.interMedium, 13, colors.foreground)]}>
                    {t(`offers.reason.${key}` as TranslationKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {reason === "other" && (
            <TextInput
              value={otherText}
              onChangeText={setOtherText}
              placeholder={t("offers.otherPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={300}
              style={[styles.input, { borderColor: colors.border, color: colors.foreground, fontFamily: FontFamily.interRegular }]}
            />
          )}
          <Text style={text(FontFamily.interRegular, 12, colors.mutedForeground)}>{t("offers.declineNote")}</Text>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setDeclining(false);
                setReason(null);
              }}
              disabled={!!busy}
              style={[styles.button, styles.outlineButton, { borderColor: colors.border }]}
            >
              <Text style={text(FontFamily.interSemiBold, 14, colors.foreground)}>{t("offers.back")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleDecline()}
              disabled={!!busy || !reason}
              style={[styles.button, { backgroundColor: colors.destructive, opacity: reason ? 1 : 0.45 }]}
            >
              {busy === "decline" ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={text(FontFamily.interSemiBold, 14, "#fff")}>{t("offers.confirmDecline")}</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text style={text(FontFamily.interRegular, 12, colors.mutedForeground)}>{t("offers.hint")}</Text>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDeclining(true)}
              disabled={!!busy}
              style={[styles.button, styles.outlineButton, { borderColor: colors.border }]}
            >
              <Text style={text(FontFamily.interSemiBold, 14, colors.foreground)}>{t("offers.decline")}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleAccept()}
              disabled={!!busy}
              style={[styles.button, { backgroundColor: colors.primary }]}
            >
              {busy === "accept" ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Text style={text(FontFamily.interSemiBold, 14, colors.primaryForeground)}>{t("offers.accept")}</Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 15,
    gap: 12,
  },
  inset: { marginHorizontal: 16 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  eyebrow: { letterSpacing: 0.6, textTransform: "uppercase" },
  body: { flexDirection: "row", gap: 12, alignItems: "stretch" },
  details: { flex: 1, minWidth: 0, gap: 4, justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  meta: { flex: 1, lineHeight: 16 },
  capitalise: { textTransform: "capitalize" },
  row: { flexDirection: "row", gap: 10 },
  declineForm: { gap: 10 },
  reasons: { gap: 8 },
  reasonRow: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  reasonText: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: "top",
  },
  button: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButton: { borderWidth: 1, backgroundColor: "transparent" },
});

import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { SafetyFlag, SafetyFlagKind } from "@/lib/safety-flags";

const TITLE: Record<SafetyFlagKind, TranslationKey> = {
  allergen: "safety.allergen.title",
  reaction: "safety.reaction.title",
  choking: "safety.choking.title",
  mealtime: "safety.mealtime.title",
  seizure: "safety.seizure.title",
  fall: "safety.fall.title",
  hypo: "safety.hypo.title",
  medication: "safety.medication.title",
};

const BODY: Record<SafetyFlagKind, TranslationKey> = {
  allergen: "safety.allergen.body",
  reaction: "safety.reaction.body",
  choking: "safety.choking.body",
  mealtime: "safety.mealtime.body",
  seizure: "safety.seizure.body",
  fall: "safety.fall.body",
  hypo: "safety.hypo.body",
  medication: "safety.medication.body",
};

/** The participant's allergies, always in view while writing notes. */
export function AllergyStrip({ allergies }: { allergies: string[] }) {
  const colors = useColors();
  const t = useT();
  if (!allergies.length) return null;
  return (
    <View
      accessibilityRole="text"
      style={[
        styles.strip,
        { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
      ]}
    >
      <Feather name="alert-octagon" size={14} color={colors.dangerIcon} />
      <Text
        numberOfLines={2}
        style={[
          styles.stripText,
          { color: colors.dangerText, fontFamily: FontFamily.interSemiBold },
        ]}
      >
        {t("safety.allergiesLine", { list: allergies.join(", ") })}
      </Text>
    </View>
  );
}

/** Cautions raised by what the worker wrote, with the participant's own plan. */
export function SafetyFlagCards({
  flags,
  name,
  onReportIncident,
  onDismiss,
}: {
  flags: SafetyFlag[];
  name: string;
  onReportIncident?: () => void;
  onDismiss: (flag: SafetyFlag) => void;
}) {
  const colors = useColors();
  const t = useT();
  if (!flags.length) return null;
  return (
    <View style={styles.list} accessibilityLiveRegion="polite">
      {flags.map((flag) => {
        const danger = flag.level === "danger";
        const tone = danger
          ? {
              bg: colors.dangerBg,
              border: colors.dangerBorder,
              text: colors.dangerText,
              icon: colors.dangerIcon,
            }
          : {
              bg: colors.statusProgressBg,
              border: colors.warning,
              text: colors.foreground,
              icon: colors.warning,
            };
        const params = {
          name,
          matched: flag.matched,
          allergen: flag.allergen ?? "",
        };
        return (
          <View
            key={`${flag.kind}:${flag.allergen ?? ""}`}
            accessibilityRole="alert"
            style={[
              styles.card,
              { backgroundColor: tone.bg, borderColor: tone.border },
            ]}
          >
            <View style={styles.head}>
              <Feather
                name={danger ? "alert-triangle" : "info"}
                size={16}
                color={tone.icon}
              />
              <Text
                style={[
                  styles.title,
                  { color: tone.text, fontFamily: FontFamily.interSemiBold },
                ]}
              >
                {t(TITLE[flag.kind], params)}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("safety.dismiss")}
                hitSlop={10}
                onPress={() => onDismiss(flag)}
              >
                <Feather name="x" size={16} color={tone.text} />
              </Pressable>
            </View>
            <Text
              style={[
                styles.body,
                { color: tone.text, fontFamily: FontFamily.interRegular },
              ]}
            >
              {t(BODY[flag.kind], params)}
            </Text>
            {flag.instructions ? (
              <Text
                style={[
                  styles.plan,
                  { color: tone.text, fontFamily: FontFamily.interMedium },
                ]}
              >
                {t("safety.theirPlan", { plan: flag.instructions })}
              </Text>
            ) : null}
            {flag.reportIncident && onReportIncident ? (
              <Pressable
                accessibilityRole="button"
                onPress={onReportIncident}
                style={({ pressed }) => [
                  styles.action,
                  { borderColor: tone.text, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Feather name="alert-circle" size={14} color={tone.text} />
                <Text
                  style={[
                    styles.actionText,
                    { color: tone.text, fontFamily: FontFamily.interSemiBold },
                  ]}
                >
                  {t("safety.reportIncident")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  stripText: { flex: 1, fontSize: 13, lineHeight: 18 },
  list: { gap: 8, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, lineHeight: 20 },
  body: { fontSize: 14, lineHeight: 20 },
  plan: { fontSize: 14, lineHeight: 20 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 36,
    marginTop: 2,
  },
  actionText: { fontSize: 14 },
});

import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

/**
 * Small, real previews of CareCliQ for onboarding, built from the app's own
 * pieces rather than stock artwork: what a worker actually sees.
 */

/** A note in the worker's own words, and the English note saved beside it. */
export function LanguageNotePreview() {
  const colors = useColors();
  const t = useT();
  return (
    <View style={[styles.stage, { backgroundColor: colors.soft }]} accessible={false}>
      <View style={styles.column}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            {t("onboarding.demo.yourWords")}
          </Text>
          <Text style={[styles.note, { color: colors.foreground }]}>{t("onboarding.demo.sample")}</Text>
        </View>
        <View style={[styles.connector, { backgroundColor: colors.primary }]}>
          <Feather name="arrow-down" size={16} color={colors.primaryForeground} />
        </View>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.labelRow}>
            <Feather name="check-circle" size={14} color={colors.success} />
            <Text style={[styles.label, { color: colors.mutedForeground }]}>
              {t("onboarding.demo.savedEnglish")}
            </Text>
          </View>
          <Text style={[styles.note, { color: colors.foreground }]}>{t("onboarding.demo.sampleEnglish")}</Text>
        </View>
      </View>
    </View>
  );
}

/** The note guide asking its next question, with the note rules ticking off. */
export function NoteGuidePreview() {
  const colors = useColors();
  const t = useT();
  const rules = ["onboarding.demo.ruleResponse", "onboarding.demo.ruleGoal", "onboarding.demo.ruleDetail"] as const;
  return (
    <View style={[styles.stage, { backgroundColor: colors.soft }]} accessible={false}>
      <View style={styles.column}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.labelRow}>
            <View style={[styles.guideDot, { backgroundColor: colors.primary }]}>
              <Feather name="message-circle" size={13} color={colors.primaryForeground} />
            </View>
            <Text style={[styles.question, { color: colors.foreground }]}>
              {t("onboarding.demo.question", { name: "Liam" })}
            </Text>
          </View>
          <View style={[styles.answer, { borderColor: colors.border }]}>
            <Text style={[styles.note, { color: colors.foreground }]}>
              {t("onboarding.demo.answer")}
            </Text>
          </View>
        </View>
        <View style={[styles.card, styles.rules, { backgroundColor: colors.card }]}>
          {rules.map((key) => (
            <View key={key} style={styles.ruleRow}>
              <Feather name="check-circle" size={16} color={colors.success} />
              <Text style={[styles.rule, { color: colors.foreground }]}>{t(key)}</Text>
            </View>
          ))}
          <View style={[styles.ready, { backgroundColor: colors.success }]}>
            <Text style={styles.readyText}>{t("onboarding.demo.ready")}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  column: { width: "100%", maxWidth: 340, alignItems: "center", gap: 10 },
  card: {
    width: "100%",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  label: { fontFamily: FontFamily.interMedium, fontSize: 12, letterSpacing: 0.2 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  note: { fontFamily: FontFamily.interRegular, fontSize: 15, lineHeight: 22 },
  connector: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  guideDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  question: { fontFamily: FontFamily.interSemiBold, fontSize: 15, flexShrink: 1 },
  answer: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginTop: 4 },
  rules: { gap: 10 },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  rule: { fontFamily: FontFamily.interMedium, fontSize: 14 },
  ready: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 2,
  },
  readyText: { fontFamily: FontFamily.interSemiBold, fontSize: 12, color: "#FFFFFF" },
});

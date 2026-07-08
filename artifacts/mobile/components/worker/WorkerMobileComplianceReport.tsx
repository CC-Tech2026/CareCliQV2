import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ComplianceScoreBar } from "@/components/worker/ComplianceScoreBar";
import { useColors } from "@/hooks/useColors";
import type { ComplianceEvaluation, ComplianceRuleResult } from "@workspace/worker-compliance";

type Props = {
  compliance: ComplianceEvaluation;
  onClose: () => void;
  onContinue?: () => void;
  onReviseNotes?: () => void;
  onOpenIncidentReport?: () => void;
};

const RULE_SECTIONS: Array<{ title: string; ids: number[] }> = [
  { title: "Session documentation", ids: [1, 2, 3, 4, 5, 7, 11, 13] },
  { title: "Participant safeguards", ids: [9, 10, 8] },
  { title: "Worker compliance", ids: [6] },
  { title: "Service agreement", ids: [12] },
];

function sectionedRules(rules: ComplianceRuleResult[]) {
  const used = new Set<number>();
  const sections = RULE_SECTIONS.map((section) => {
    const items = section.ids
      .map((id) => rules.find((rule) => rule.id === id))
      .filter((rule): rule is ComplianceRuleResult => Boolean(rule));
    items.forEach((rule) => used.add(rule.id));
    return { title: section.title, items };
  }).filter((section) => section.items.length > 0);

  const remaining = rules.filter((rule) => !used.has(rule.id));
  if (remaining.length > 0) sections.push({ title: "Additional checks", items: remaining });
  return sections;
}

function rulePoints(rule: ComplianceRuleResult) {
  return `+${rule.weight}pts`;
}

function RuleStatusIcon({
  status,
  colors,
}: {
  status: ComplianceRuleResult["status"];
  colors: ReturnType<typeof useColors>;
}) {
  const pass = status === "pass";
  const warn = status === "warn" || status === "info";
  return (
    <View
      style={[
        styles.ruleIconWrap,
        {
          backgroundColor: pass ? colors.clockInBg : warn ? `${colors.warning}18` : `${colors.destructive}18`,
        },
      ]}
    >
      <Feather
        name={pass ? "check" : warn ? "alert-triangle" : "x"}
        size={13}
        color={pass ? colors.clockInIcon : warn ? colors.warning : colors.destructive}
      />
    </View>
  );
}

function scoreLabel(score: number) {
  if (score >= 80) return "Compliant";
  if (score >= 60) return "Needs review";
  return "Action required";
}

export function WorkerMobileComplianceReport({
  compliance,
  onClose,
  onContinue,
  onReviseNotes,
  onOpenIncidentReport,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const passedCount = compliance.rules.filter((rule) => rule.status === "pass").length;
  const sections = sectionedRules(compliance.rules);
  const attentionRules = compliance.rules.filter((rule) => rule.status !== "pass");
  const hasAttention = attentionRules.length > 0;
  const scoreClr = scoreColor(compliance.score, colors);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border, paddingTop: insets.top + 10, backgroundColor: colors.card },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          Compliance Report
        </Text>
        <Pressable onPress={onClose} style={[styles.closeBtn, { borderColor: colors.border }]}>
          <Feather name="x" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 140 }]}>
        <View style={styles.scoreHero}>
          <View style={[styles.scoreCircle, { backgroundColor: colors.clockInBg }]}>
            <Text style={[styles.scoreValue, { color: scoreClr, fontFamily: "Inter_700Bold" }]}>
              {compliance.score}
            </Text>
            <Text style={[styles.scoreOutOf, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              /100
            </Text>
          </View>
          <View style={[styles.scorePill, { backgroundColor: colors.clockInBg }]}>
            <Text style={[styles.scorePillText, { color: scoreClr, fontFamily: "Inter_600SemiBold" }]}>
              {scoreLabel(compliance.score)}
            </Text>
          </View>
          <Text style={[styles.scoreDesc, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Based on {compliance.rules.length} NDIS compliance checks for this session
          </Text>
        </View>

        <View style={[styles.summaryStrip, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={styles.summaryTop}>
            <Text style={[styles.summaryLeft, { color: scoreClr, fontFamily: "Inter_600SemiBold" }]}>
              {passedCount} of {compliance.rules.length} checks passed
            </Text>
            <Text style={[styles.summaryRight, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
              {compliance.score}/100
            </Text>
          </View>
          <ComplianceScoreBar score={compliance.score} />
          <Text style={[styles.summaryHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Here's how to strengthen your notes for next time.
          </Text>
        </View>

        <Text style={[styles.breakdownLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
          Checks breakdown
        </Text>

        {sections.map((section) => (
          <View key={section.title}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
              {section.title}
            </Text>
            <View style={[styles.sectionCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
              {section.items.map((rule, index) => (
                <View
                  key={rule.id}
                  style={[
                    styles.ruleRow,
                    { borderBottomColor: colors.border, borderBottomWidth: index === section.items.length - 1 ? 0 : StyleSheet.hairlineWidth },
                  ]}
                >
                  <RuleStatusIcon status={rule.status} colors={colors} />
                  <View style={styles.ruleText}>
                    <View style={styles.ruleTitleRow}>
                      <Text style={[styles.ruleName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                        {rule.name}
                      </Text>
                      <Text style={[styles.rulePoints, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                        {rulePoints(rule)}
                      </Text>
                    </View>
                    <Text style={[styles.ruleMessage, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                      {rule.message}
                    </Text>
                    {rule.actionLabel ? (
                      <View style={[styles.suggestionBox, { backgroundColor: colors.activeBg, borderLeftColor: colors.composerPurple }]}>
                        <Text style={[styles.suggestionTitle, { color: colors.composerPurple, fontFamily: "Inter_600SemiBold" }]}>
                          Suggested improvement
                        </Text>
                        <Text
                          style={[styles.suggestionBody, { color: colors.composerPurple, fontFamily: "Inter_400Regular" }]}
                        >
                          {rule.message}
                        </Text>
                        <Pressable
                          onPress={
                            rule.actionHref === "/incidents/new" && onOpenIncidentReport
                              ? onOpenIncidentReport
                              : onReviseNotes ?? onClose
                          }
                        >
                          <Text style={[styles.suggestionLink, { color: colors.composerPurple, fontFamily: "Inter_600SemiBold" }]}>
                            {rule.actionHref === "/incidents/new" ? rule.actionLabel : "Fix this note ->"}
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.background, paddingBottom: insets.bottom + 12 }]}>
        {hasAttention && onReviseNotes ? (
          <Pressable style={[styles.secondaryAction, { borderColor: colors.composerPurple }]} onPress={onReviseNotes}>
            <Text style={[styles.secondaryActionText, { color: colors.composerPurple, fontFamily: "Inter_600SemiBold" }]}>
              Revise notes now
            </Text>
          </Pressable>
        ) : null}
        {onContinue ? (
          <Pressable style={[styles.primaryAction, { backgroundColor: colors.primary }]} onPress={onContinue}>
            <Text style={[styles.primaryActionText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
              Continue
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function scoreColor(score: number, colors: ReturnType<typeof useColors>): string {
  if (score >= 80) return "#22C55E";
  if (score >= 60) return colors.warning;
  return colors.destructive;
}

export function WorkerMobileSubmitSuccess({
  participantName,
  duration,
  tasksCompleted,
  tasksTotal,
  score,
  submittedAt,
  onDone,
}: {
  participantName: string;
  duration: string;
  tasksCompleted: number;
  tasksTotal: number;
  score: number;
  submittedAt: string;
  onDone: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const firstName = participantName.split(" ")[0] || "Participant";
  const allDone = tasksTotal > 0 && tasksCompleted === tasksTotal;
  const scoreClr = scoreColor(score, colors);

  return (
    <View style={[styles.successWrap, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.successHeader,
          { paddingTop: insets.top + 14, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[styles.successHeaderTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          Shift complete
        </Text>
        <Text style={[styles.successHeaderSub, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          Notes submitted
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.successBody} showsVerticalScrollIndicator={false}>
        <View style={[styles.successIcon, { backgroundColor: colors.clockInBg }]}>
          <Feather name="check-circle" size={36} color="#22C55E" />
        </View>
        <Text style={[styles.successTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          Notes submitted!
        </Text>
        <Text style={[styles.successSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {firstName}&apos;s session has been recorded and sent for coordinator review.
        </Text>

        <View style={[styles.summaryCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <SummaryRow label="Participant" value={participantName} colors={colors} />
          <SummaryRow label="Duration" value={duration} colors={colors} />
          <SummaryRow
            label="Tasks completed"
            value={`${tasksCompleted} of ${tasksTotal}`}
            valueColor={allDone ? "#22C55E" : undefined}
            colors={colors}
          />
          <SummaryRow label="Note quality" value={`${score} / 100`} valueColor={scoreClr} colors={colors} />
          <SummaryRow label="Submitted" value={submittedAt} colors={colors} last />
        </View>

        <Pressable
          onPress={onDone}
          style={[styles.doneBtn, { backgroundColor: colors.primary, marginBottom: insets.bottom + 16 }]}
        >
          <Feather name="home" size={18} color={colors.primaryForeground} />
          <Text style={[styles.doneBtnText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
            Back to my shifts
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  valueColor,
  colors,
  last,
}: {
  label: string;
  value: string;
  valueColor?: string;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.summaryRow,
        { borderBottomColor: colors.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth },
      ]}
    >
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, { color: valueColor ?? colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: { padding: 16, gap: 0 },
  scoreHero: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 18,
    gap: 10,
  },
  scoreCircle: {
    width: 116,
    height: 116,
    borderRadius: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreValue: { fontSize: 42, lineHeight: 44 },
  scoreOutOf: { fontSize: 15, marginTop: 2 },
  scorePill: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  scorePillText: { fontSize: 14 },
  scoreDesc: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    maxWidth: 320,
  },
  summaryStrip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 18,
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  summaryLeft: { fontSize: 15, flex: 1 },
  summaryRight: { fontSize: 14 },
  summaryHint: { fontSize: 13, lineHeight: 18, marginTop: 10 },
  breakdownLabel: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 10,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  ruleIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  ruleText: { flex: 1, gap: 3 },
  ruleTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  ruleName: { fontSize: 14 },
  rulePoints: { fontSize: 12 },
  ruleMessage: { fontSize: 13, lineHeight: 18 },
  suggestionBox: {
    marginTop: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderLeftWidth: 3,
    gap: 6,
  },
  suggestionTitle: { fontSize: 12 },
  suggestionBody: { fontSize: 14, lineHeight: 20 },
  suggestionLink: { fontSize: 13 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 12,
  },
  secondaryAction: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  secondaryActionText: { fontSize: 16 },
  primaryAction: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryActionText: { fontSize: 16 },
  successWrap: {
    flex: 1,
  },
  successHeader: {
    paddingBottom: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  successHeaderTitle: { fontSize: 17 },
  successHeaderSub: { fontSize: 13, marginTop: 2 },
  successBody: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  successIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  successTitle: { fontSize: 20 },
  successSub: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 320,
  },
  summaryCard: {
    width: "100%",
    maxWidth: 380,
    marginTop: 24,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 11,
  },
  summaryLabel: { fontSize: 12 },
  summaryValue: { fontSize: 13, textAlign: "right", flexShrink: 1 },
  doneBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    maxWidth: 380,
    marginTop: 32,
    height: 50,
    borderRadius: 14,
  },
  doneBtnText: { fontSize: 15 },
});

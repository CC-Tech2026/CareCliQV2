import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { activeGoals } from "@/lib/client-utils";
import type { WorkerClient } from "@/lib/worker-api";
import { useColors } from "@/hooks/useColors";

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.section,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View
        style={[styles.sectionHeader, { borderBottomColor: colors.border }]}
      >
        <Feather name={icon} size={14} color={colors.mutedForeground} />
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.mutedForeground, fontFamily: FontFamily.interBold },
          ]}
        >
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function AlertCard({
  title,
  text,
  icon,
}: {
  title: string;
  text: string;
  icon: keyof typeof Feather.glyphMap;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.alertCard,
        { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
      ]}
    >
      <View style={styles.alertHeader}>
        <Feather name={icon} size={16} color={colors.dangerText} />
        <Text
          style={[
            styles.alertTitle,
            { color: colors.dangerText, fontFamily: FontFamily.interBold },
          ]}
        >
          {title}
        </Text>
      </View>
      <Text
        style={[
          styles.alertText,
          { color: colors.dangerText, fontFamily: FontFamily.interSemiBold },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

export function ClientOverviewContent({ client }: { client: WorkerClient }) {
  const colors = useColors();
  const goals = activeGoals(client.goals);
  const confidenceItems = [
    { label: "NDIS goals", ready: goals.length > 0 },
    { label: "Allergy information", ready: Boolean(client.allergies?.trim()) },
    {
      label: "Support preferences",
      ready: Boolean(client.communication_preferences?.trim()),
    },
    {
      label: "Behaviour support",
      ready: Boolean(
        client.behaviour_support_plan?.trim() ||
        client.restricted_behavioural_notes?.trim(),
      ),
    },
  ];
  const readyCount = confidenceItems.filter((item) => item.ready).length;

  return (
    <View style={styles.wrap}>
      {client.allergies?.trim() ? (
        <AlertCard
          title="Allergies"
          text={client.allergies}
          icon="alert-triangle"
        />
      ) : null}
      {client.primary_disability?.trim() ? (
        <Section title="Support needs" icon="user">
          <Text
            style={[
              styles.bodyText,
              { color: colors.foreground, fontFamily: FontFamily.interRegular },
            ]}
          >
            {client.primary_disability}
          </Text>
        </Section>
      ) : null}

      {client.communication_preferences?.trim() ? (
        <Section title="Support preferences" icon="message-circle">
          <Text
            style={[
              styles.bodyText,
              { color: colors.foreground, fontFamily: FontFamily.interRegular },
            ]}
          >
            {client.communication_preferences}
          </Text>
        </Section>
      ) : null}

      {client.behaviour_support_plan?.trim() ||
      client.restricted_behavioural_notes?.trim() ? (
        <Section title="Behaviour support" icon="shield">
          <View style={styles.stack}>
            {client.behaviour_support_plan?.trim() ? (
              <View
                style={[styles.softCard, { backgroundColor: colors.activeBg }]}
              >
                <Text
                  style={[
                    styles.softLabel,
                    {
                      color: colors.mutedForeground,
                      fontFamily: FontFamily.interBold,
                    },
                  ]}
                >
                  Behaviour support plan
                </Text>
                <Text
                  style={[
                    styles.bodyText,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interRegular,
                    },
                  ]}
                >
                  {client.behaviour_support_plan}
                </Text>
              </View>
            ) : null}
            {client.restricted_behavioural_notes?.trim() ? (
              <View
                style={[styles.softCard, { backgroundColor: colors.activeBg }]}
              >
                <Text
                  style={[
                    styles.softLabel,
                    {
                      color: colors.mutedForeground,
                      fontFamily: FontFamily.interBold,
                    },
                  ]}
                >
                  Behavioural notes
                </Text>
                <Text
                  style={[
                    styles.bodyText,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interRegular,
                    },
                  ]}
                >
                  {client.restricted_behavioural_notes}
                </Text>
              </View>
            ) : null}
          </View>
        </Section>
      ) : null}

      {goals.length > 0 ? (
        <Section title="Active goals" icon="target">
          <View style={styles.stack}>
            {goals.map((goal, index) => (
              <View
                key={goal.id || String(index)}
                style={[
                  styles.goalRow,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
              >
                <View
                  style={[styles.goalDot, { backgroundColor: "#34D399" }]}
                />
                <View style={styles.goalContent}>
                  <Text
                    style={[
                      styles.goalTitle,
                      {
                        color: colors.foreground,
                        fontFamily: FontFamily.interBold,
                      },
                    ]}
                  >
                    {goal.title || goal.description || `Goal ${index + 1}`}
                  </Text>
                  {goal.description && goal.title ? (
                    <Text
                      style={[
                        styles.goalDesc,
                        {
                          color: colors.mutedForeground,
                          fontFamily: FontFamily.interRegular,
                        },
                      ]}
                    >
                      {goal.description}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Available information" icon="check-circle">
        <Text
          style={[
            styles.confidenceSummary,
            {
              color: colors.mutedForeground,
              fontFamily: FontFamily.interMedium,
            },
          ]}
        >
          {readyCount} of {confidenceItems.length} sections recorded
        </Text>
        <View style={styles.stack}>
          {confidenceItems.map((item) => (
            <View key={item.label} style={styles.confidenceRow}>
              <Feather
                name={item.ready ? "check-circle" : "circle"}
                size={18}
                color={item.ready ? "#34D399" : colors.border}
              />
              <Text
                style={[
                  styles.confidenceLabel,
                  {
                    color: item.ready
                      ? colors.foreground
                      : colors.mutedForeground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {item.label}
                {item.ready ? " - Recorded" : " - Not recorded"}
              </Text>
            </View>
          ))}
        </View>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  section: { gap: 12, padding: 18, borderRadius: 22, borderWidth: 1 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { fontSize: 16, flex: 1 },
  bodyText: { fontSize: 14, lineHeight: 22 },
  alertCard: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    padding: 16,
    gap: 8,
  },
  alertHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  alertTitle: { fontSize: 16, color: "#B91C1C" },
  alertText: { fontSize: 14, lineHeight: 22, color: "#991B1B" },
  stack: { gap: 10 },
  softCard: { borderRadius: 10, padding: 12, gap: 6 },
  softLabel: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  goalRow: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: "flex-start",
  },
  goalDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  goalContent: { flex: 1, gap: 4 },
  goalTitle: { fontSize: 14, lineHeight: 20 },
  goalDesc: { fontSize: 13, lineHeight: 19 },
  confidenceSummary: { fontSize: 13, marginBottom: 4 },
  confidenceRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  confidenceLabel: { fontSize: 14, flex: 1 },
});

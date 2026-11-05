import { Feather } from "@expo/vector-icons";
import { FontFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { activeGoals } from "@/lib/client-utils";
import type { WorkerClient } from "@/lib/worker-api";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

function SupportCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const c = useColors();
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={s.headingRow}>
        <View style={s.flex}>
          <Text
            accessibilityRole="header"
            style={[s.heading, { color: c.foreground }]}
          >
            {title}
          </Text>
          <Text style={[s.caption, { color: c.mutedForeground }]}>
            {subtitle}
          </Text>
        </View>
      </View>
      {children}
    </View>
  );
}

/** Preserve recorded wording; split only explicit line breaks. */
function GuidanceRows({
  value,
  danger = false,
}: {
  value: string;
  danger?: boolean;
}) {
  const c = useColors();
  const items = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    <View>
      {items.map((item, index) => (
        <View
          key={index}
          style={[
            s.guidanceRow,
            { borderTopColor: danger ? c.dangerBorder : c.border },
          ]}
        >
          <Text
            style={[
              s.rowMarker,
              { color: danger ? c.dangerText : c.mutedForeground },
            ]}
          >
            {String(index + 1).padStart(2, "0")}
          </Text>
          <Text
            selectable
            style={[
              s.body,
              s.flex,
              { color: danger ? c.dangerText : c.foreground },
            ]}
          >
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function SafetyCard({
  title,
  label,
  icon,
  value,
  danger = false,
}: {
  title: string;
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  value: string;
  danger?: boolean;
}) {
  const c = useColors();
  return (
    <View
      style={[
        s.card,
        danger && s.safetyAccent,
        {
          backgroundColor: danger ? c.dangerBg : c.card,
          borderColor: danger ? c.dangerBorder : c.border,
        },
      ]}
    >
      <View style={s.headingRow}>
        <View style={[s.iconTile, { backgroundColor: c.soft }]}>
          <Feather
            name={icon}
            size={20}
            color={danger ? c.dangerText : c.primary}
          />
        </View>
        <View style={s.flex}>
          <Text
            style={[
              s.eyebrow,
              { color: danger ? c.dangerText : c.mutedForeground },
            ]}
          >
            {label}
          </Text>
          <Text
            accessibilityRole="header"
            style={[s.heading, { color: danger ? c.dangerText : c.foreground }]}
          >
            {title}
          </Text>
        </View>
      </View>
      <GuidanceRows value={value} danger={danger} />
    </View>
  );
}

function GoalItem({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description?: string | null;
}) {
  const c = useColors();
  const [expanded, setExpanded] = useState(false);
  const extra =
    description?.trim() && description.trim() !== title.trim()
      ? description.trim()
      : null;
  return (
    <View style={[s.goal, { borderColor: c.border }]}>
      <View style={s.goalTop}>
        <View style={s.goalNumber}>
          <Text style={[s.label, { color: c.mutedForeground }]}>
            {String(number).padStart(2, "0")}
          </Text>
        </View>
        <Text style={[s.goalTitle, { color: c.foreground }]}>{title}</Text>
      </View>
      {extra ? (
        <>
          {expanded ? (
            <Text selectable style={[s.body, { color: c.mutedForeground }]}>
              {extra}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={
              (expanded ? "Hide details for goal " : "Show details for goal ") +
              number
            }
            onPress={() => setExpanded((v) => !v)}
            style={({ pressed }) => [
              s.goalAction,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={[s.actionText, { color: c.primary }]}>
              {expanded ? "Hide goal details" : "See goal details"}
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

/** Parent owns scrolling; safety and behaviour guidance are always expanded. */
export function ClientOverviewContent({
  client,
  section = "all",
}: {
  client: WorkerClient;
  section?: "all" | "support" | "goals";
}) {
  const c = useColors();
  const [showAllGoals, setShowAllGoals] = useState(false);
  const allergies = client.allergies?.trim();
  const communication = client.communication_preferences?.trim();
  const disability = client.primary_disability?.trim();
  const plan = client.behaviour_support_plan?.trim();
  const notes = client.restricted_behavioural_notes?.trim();
  const goals = activeGoals(client.goals);
  return (
    <View style={s.container}>
      {section !== "goals" ? (
        <>
          <View>
            <Text
              accessibilityRole="header"
              style={[s.heading, { color: c.foreground }]}
            >
              Safety & support
            </Text>
            <Text style={[s.caption, { color: c.mutedForeground }]}>
              Check before support and refer back during your shift
            </Text>
          </View>
          <SafetyCard
            title="Allergies & sensitivities"
            label={allergies ? "Check exposure risks" : "Needs confirmation"}
            icon="alert-triangle"
            danger={!!allergies}
            value={
              allergies ||
              "Allergy information is not recorded. Confirm with your coordinator before support if you are unsure."
            }
          />
          {plan ? (
            <SafetyCard
              title="Behaviour support plan"
              label="Follow during support"
              icon="shield"
              value={plan}
            />
          ) : null}
          {notes ? (
            <SafetyCard
              title="Behaviour support notes"
              label="Know before you act"
              icon="alert-circle"
              value={notes}
            />
          ) : null}
          {communication ? (
            <SafetyCard
              title="Communication"
              label="How to communicate"
              icon="message-circle"
              value={communication}
            />
          ) : null}
          {disability ? (
            <SafetyCard
              title="Primary disability"
              label="Participant context"
              icon="user"
              value={disability}
            />
          ) : null}
        </>
      ) : null}

      {section !== "support" && goals.length > 0 ? (
        <SupportCard
          title="Active goals"
          subtitle={
            goals.length +
            (goals.length === 1 ? " active goal" : " active goals") +
            ""
          }
        >
          {(showAllGoals ? goals : goals.slice(0, 2)).map((goal, index) => (
            <GoalItem
              key={client.id + ":" + (goal.id || index)}
              number={index + 1}
              title={goal.title || goal.description || "Goal " + (index + 1)}
              description={goal.title ? goal.description : null}
            />
          ))}
          {goals.length > 2 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showAllGoals }}
              onPress={() => setShowAllGoals((v) => !v)}
              style={({ pressed }) => [
                s.allGoals,
                { backgroundColor: c.secondary, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[s.actionText, { color: c.secondaryForeground }]}>
                {showAllGoals
                  ? "Show fewer goals"
                  : "View all " + goals.length + " goals"}
              </Text>
            </Pressable>
          ) : null}
        </SupportCard>
      ) : null}

      {(section === "goals" && !goals.length) ||
      (section !== "goals" &&
        !communication &&
        !disability &&
        !plan &&
        !notes &&
        (section === "support" || !goals.length)) ? (
        <SupportCard
          title={
            section === "goals" ? "No active goals yet" : "More to get to know"
          }
          subtitle={
            section === "goals"
              ? "Goals will appear here when recorded"
              : "Support details haven't been added yet"
          }
        >
          <Text style={[s.body, { color: c.mutedForeground }]}>
            Your coordinator can help you understand this participant's
            preferences and support needs before your visit.
          </Text>
        </SupportCard>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 18,
  },
  headingRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heading: {
    fontFamily: FontFamily.interBold,
    fontSize: 18,
    lineHeight: 25,
    letterSpacing: -0.4,
  },
  caption: {
    fontFamily: FontFamily.interRegular,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  label: { fontFamily: FontFamily.interSemiBold, fontSize: 13, lineHeight: 20 },
  body: { fontFamily: FontFamily.interRegular, fontSize: 15, lineHeight: 24 },
  safetyAccent: { borderLeftWidth: 4 },
  eyebrow: {
    fontFamily: FontFamily.interSemiBold,
    fontSize: 11,
    lineHeight: 17,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  guidanceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowMarker: {
    minWidth: 22,
    fontFamily: FontFamily.interSemiBold,
    fontSize: 12,
    lineHeight: 24,
  },
  goal: {
    paddingTop: 16,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  goalTop: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  goalNumber: {
    minWidth: 32,
    minHeight: 32,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  goalTitle: {
    flex: 1,
    fontFamily: FontFamily.interSemiBold,
    fontSize: 15,
    lineHeight: 23,
    paddingTop: 4,
    paddingBottom: 6,
  },
  goalAction: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  actionText: {
    flexShrink: 1,
    fontFamily: FontFamily.interSemiBold,
    fontSize: 13,
    lineHeight: 20,
  },
  allGoals: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
});

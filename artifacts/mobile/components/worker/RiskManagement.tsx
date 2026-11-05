import { Feather } from "@expo/vector-icons";
import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { FontFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import type { SafetyProtocol } from "@/lib/worker-api";

export function RiskManagement({ protocol }: { protocol: SafetyProtocol }) {
  const c = useColors();
  const hasContent =
    protocol.safety_card_body?.trim() ||
    protocol.scenarios.length ||
    protocol.deescalation_techniques.length ||
    protocol.physical_safety_notes.length;
  return (
    <View style={s.container}>
      <View style={s.heading}>
        <Text
          accessibilityRole="header"
          style={[s.title, { color: c.foreground }]}
        >
          Risk management
        </Text>
      </View>
      {!hasContent ? (
        <Text style={[s.body, { color: c.mutedForeground }]}>
          No participant-specific risk guidance recorded. Check with your
          coordinator if you need guidance.
        </Text>
      ) : null}
      {protocol.safety_card_body?.trim() ? (
        <View
          style={[
            s.card,
            { backgroundColor: c.dangerBg, borderColor: c.dangerBorder },
          ]}
        >
          <Text style={[s.label, { color: c.dangerText }]}>SAFETY PLAN</Text>
          <Text selectable style={[s.body, { color: c.dangerText }]}>
            {protocol.safety_card_body}
          </Text>
        </View>
      ) : null}
      {protocol.scenarios.map((scenario, i) => (
        <View
          key={i}
          style={[
            s.card,
            { backgroundColor: c.dangerBg, borderColor: c.dangerBorder },
          ]}
        >
          <View style={s.heading}>
            <Feather name="alert-triangle" size={15} color={c.dangerText} />
            <Text style={[s.label, { color: c.dangerText }]}>
              TRIGGER / RISK
            </Text>
          </View>
          <Text selectable style={[s.body, { color: c.dangerText }]}>
            {scenario.trigger}
          </Text>
          <View style={[s.response, { borderTopColor: c.dangerBorder }]}>
            <Text style={[s.label, { color: c.dangerText }]}>WHAT TO DO</Text>
            <Text selectable style={[s.body, { color: c.dangerText }]}>
              {scenario.response ||
                "No response recorded. Contact your coordinator for guidance."}
            </Text>
          </View>
        </View>
      ))}
      {protocol.deescalation_techniques.map((technique, i) => (
        <View
          key={i}
          style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <Text style={[s.title, { color: c.foreground }]}>
            {technique.title}
          </Text>
          <Text style={[s.label, { color: c.mutedForeground }]}>
            DE-ESCALATION
          </Text>
          {technique.steps.map((step, j) => (
            <Text selectable key={j} style={[s.body, { color: c.foreground }]}>
              {j + 1}. {step}
            </Text>
          ))}
        </View>
      ))}
      {protocol.physical_safety_notes.map((note, i) => (
        <View
          key={i}
          style={[
            s.card,
            { backgroundColor: c.dangerBg, borderColor: c.dangerBorder },
          ]}
        >
          <Text style={[s.label, { color: c.dangerText }]}>
            PHYSICAL SAFETY
          </Text>
          <Text selectable style={[s.body, { color: c.dangerText }]}>
            {note.note}
          </Text>
        </View>
      ))}
      {protocol.escalation_contacts.length ? (
        <Text
          accessibilityRole="header"
          style={[s.title, { color: c.foreground }]}
        >
          Escalation contacts
        </Text>
      ) : null}
      {protocol.escalation_contacts.map((contact, i) => {
        const phone = contact.phone.replace(/[^+\d]/g, "");
        return (
          <View
            key={i}
            style={[
              s.contact,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.title, { color: c.foreground }]}>
                {contact.label}
              </Text>
              <Text selectable style={[s.body, { color: c.mutedForeground }]}>
                {contact.phone || "No phone recorded"}
              </Text>
            </View>
            {phone ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call ${contact.label}`}
                onPress={() => void Linking.openURL(`tel:${phone}`)}
                style={[s.call, { backgroundColor: c.dangerBg }]}
              >
                <Feather name="phone" size={17} color={c.dangerText} />
                <Text style={[s.label, { color: c.dangerText }]}>Call</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
const s = StyleSheet.create({
  container: { gap: 8 },
  heading: { flexDirection: "row", alignItems: "center", gap: 7 },
  title: { fontFamily: FontFamily.interSemiBold, fontSize: 13, lineHeight: 19 },
  label: { fontFamily: FontFamily.interSemiBold, fontSize: 11, lineHeight: 17 },
  body: { fontFamily: FontFamily.interRegular, fontSize: 13, lineHeight: 20 },
  card: {
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 9,
    padding: 12,
    gap: 6,
  },
  response: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    marginTop: 2,
    gap: 4,
  },
  contact: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  call: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
});

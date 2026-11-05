import { useQuery } from "@tanstack/react-query";
import { RiskManagement } from "@/components/worker/RiskManagement";
import {
  getParticipantSafetyProtocol,
  type ShiftHealthAlert,
} from "@/lib/worker-api";
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { FontFamily } from "@/constants/typography";
import { useShiftBriefing } from "@/hooks/worker/useShiftBriefing";
import { useWorkerClientDetail } from "@/hooks/worker/useWorkerClientDetail";
import { useColors } from "@/hooks/useColors";

function SupportRow({
  title,
  value,
  danger = false,
  alwaysVisible = false,
  pictogram,
}: {
  title: string;
  value: string;
  danger?: boolean;
  alwaysVisible?: boolean;
  pictogram?: string;
}) {
  const c = useColors();
  const [expanded, setExpanded] = useState(false);
  const color = danger ? c.dangerText : c.foreground;
  return (
    <View
      style={[
        s.row,
        danger && s.dangerRow,
        {
          borderTopColor: danger ? c.dangerBorder : c.border,
          backgroundColor: danger ? c.dangerBg : undefined,
        },
      ]}
    >
      {alwaysVisible ? (
        <>
          <View style={s.rowHeading}>
            {pictogram ? (
              <Text accessible={false} style={{ fontSize: 18 }}>
                {pictogram}
              </Text>
            ) : danger ? (
              <Feather name="alert-triangle" size={14} color={c.dangerText} />
            ) : null}
            <Text accessibilityRole="header" style={[s.rowTitle, { color }]}>
              {title}
            </Text>
          </View>
          <Text
            selectable
            style={[
              s.body,
              { color: danger ? c.dangerText : c.mutedForeground },
            ]}
          >
            {value}
          </Text>
        </>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              title + (expanded ? ". Hide details" : ". Show details")
            }
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((v) => !v)}
            style={s.previewToggle}
          >
            <View style={s.rowHeading}>
              <Text style={[s.rowTitle, { color, flex: 1 }]}>{title}</Text>
              <Feather
                name={expanded ? "chevron-up" : "chevron-down"}
                size={16}
                color={c.mutedForeground}
              />
            </View>
            {!expanded ? (
              <Text
                numberOfLines={1}
                style={[s.body, { color: c.mutedForeground }]}
              >
                {value}
              </Text>
            ) : null}
          </Pressable>
          {expanded ? (
            <Text selectable style={[s.body, { color: c.foreground }]}>
              {value}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

/** One place to consult support guidance without leaving the active shift. */
export function DuringShiftSupport({
  shiftId,
  participantId,
  section = "support",
  healthAlerts = [],
}: {
  shiftId: string;
  participantId?: string | null;
  section?: "support" | "briefing";
  healthAlerts?: ShiftHealthAlert[];
}) {
  const c = useColors();
  const client = useWorkerClientDetail(participantId || undefined);
  const briefing = useShiftBriefing(shiftId);
  const data = briefing.data;
  const safety = useQuery({
    queryKey: ["worker", "safety-protocol", participantId, shiftId],
    queryFn: () => getParticipantSafetyProtocol(participantId!, shiftId),
    enabled: Boolean(participantId),
    staleTime: 30_000,
  });
  return (
    <View style={s.content}>
      {client.isLoading || briefing.isLoading || safety.isLoading ? (
        <ActivityIndicator
          color={c.primary}
          accessibilityLabel="Loading support guidance"
        />
      ) : null}
      {client.error || briefing.error || safety.error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (participantId) void client.refetch();
            void briefing.refetch();
            if (participantId) void safety.refetch();
          }}
          style={[s.retry, { backgroundColor: c.soft }]}
        >
          <Text style={[s.text, { color: c.primary }]}>
            {safety.error
              ? "Risk management guidance could not load. Tap to retry."
              : "Some support details could not load. Tap to retry."}
          </Text>
        </Pressable>
      ) : null}
      {section === "support" ? (
        <View
          style={[s.group, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <SupportRow
            title="Allergies & sensitivities"
            pictogram={
              /\b(peanuts?|nuts?)\b/i.test(
                client.data?.participant.allergies || "",
              )
                ? "\uD83E\uDD5C"
                : undefined
            }
            danger
            alwaysVisible
            value={
              client.data?.participant.allergies?.trim() ||
              (client.isLoading
                ? "Loading allergy information..."
                : "Allergy information unavailable. Confirm with your coordinator if unsure.")
            }
          />
          {healthAlerts.map((alert, index) => (
            <SupportRow
              key={index}
              title={alert.title}
              danger
              alwaysVisible
              value={
                [alert.description, alert.detail, alert.instructions]
                  .filter(
                    (value, i, values) =>
                      value?.trim() && values.indexOf(value) === i,
                  )
                  .join("\n") || alert.title
              }
            />
          ))}
          {data?.critical_alerts
            .filter(
              (alert) =>
                !healthAlerts.some((item) =>
                  [
                    item.title,
                    item.description,
                    item.detail,
                    item.instructions,
                  ].includes(alert.text),
                ),
            )
            .map((alert) => (
              <SupportRow
                key={alert.id}
                title="Critical alert"
                danger
                alwaysVisible
                value={alert.text}
              />
            ))}
          {client.data?.participant.behaviour_support_plan?.trim() ? (
            <SupportRow
              title="Behaviour support plan"
              alwaysVisible
              value={client.data.participant.behaviour_support_plan}
            />
          ) : null}
          {client.data?.participant.restricted_behavioural_notes?.trim() ? (
            <SupportRow
              title="Behaviour support notes"
              alwaysVisible
              value={client.data.participant.restricted_behavioural_notes}
            />
          ) : null}
        </View>
      ) : null}
      {section === "support" && safety.data ? (
        <RiskManagement protocol={safety.data} />
      ) : null}
      <View
        style={[s.group, { backgroundColor: c.card, borderColor: c.border }]}
      >
        {section === "briefing" && data?.special_instructions?.trim() ? (
          <SupportRow
            title="Shift instructions"
            value={data.special_instructions}
            alwaysVisible
          />
        ) : null}
        {section === "support" &&
        client.data?.participant.communication_preferences?.trim() ? (
          <SupportRow
            title="Communication"
            value={client.data.participant.communication_preferences}
          />
        ) : null}
        {section === "support" &&
        data?.communication_preferences?.trim() &&
        data.communication_preferences.trim() !==
          client.data?.participant.communication_preferences?.trim() ? (
          <SupportRow
            title="Shift communication"
            value={data.communication_preferences}
          />
        ) : null}
        {section === "briefing" && data ? (
          <SupportRow
            title={
              data.previous_shift_note?.author_first_name
                ? "Handover ? " + data.previous_shift_note.author_first_name
                : "Last shift handover"
            }
            value={
              data.previous_shift_note?.content?.trim() ||
              "No previous shift handover recorded."
            }
          />
        ) : null}
        {section === "support" &&
        client.data?.participant.primary_disability?.trim() ? (
          <SupportRow
            title="Primary disability"
            value={client.data.participant.primary_disability}
          />
        ) : null}
        {section === "briefing" && data?.background_summary.text?.trim() ? (
          <SupportRow
            title="About the participant"
            value={data.background_summary.text}
          />
        ) : null}
        {section === "briefing" &&
        data &&
        !data.special_instructions?.trim() ? (
          <SupportRow
            title="Shift instructions"
            value="No additional instructions recorded for this shift."
          />
        ) : null}
        {section === "support" &&
        client.data &&
        !client.data.participant.communication_preferences?.trim() &&
        !data?.communication_preferences?.trim() &&
        !client.data.participant.primary_disability?.trim() ? (
          <Text
            style={[s.body, { color: c.mutedForeground, paddingBottom: 12 }]}
          >
            No everyday support guidance recorded. Ask your coordinator if you
            need more information.
          </Text>
        ) : null}
        {!participantId ? (
          <SupportRow
            title="Support details unavailable"
            alwaysVisible
            value="No participant is linked to this shift. Contact your coordinator for support guidance."
          />
        ) : null}
      </View>
      {section === "briefing" && data?.emergency_contacts.length ? (
        <View
          style={[
            s.contacts,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[s.title, { color: c.foreground }]}
          >
            Who to call
          </Text>
          {data.emergency_contacts.map((contact, index) => {
            const phone = contact.phone.replace(/[^+\d]/g, "");
            return (
              <View
                key={index}
                style={[s.contact, { borderTopColor: c.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text selectable style={[s.text, { color: c.foreground }]}>
                    {contact.name}
                  </Text>
                  <Text style={[s.caption, { color: c.mutedForeground }]}>
                    {contact.role}
                  </Text>
                  <Text
                    selectable
                    style={[s.caption, { color: c.mutedForeground }]}
                  >
                    {contact.phone || "No phone recorded"}
                  </Text>
                </View>
                {phone ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${contact.name}`}
                    onPress={() => void Linking.openURL(`tel:${phone}`)}
                    style={[s.call, { backgroundColor: c.soft }]}
                  >
                    <Feather name="phone" size={18} color={c.primary} />
                    <Text style={[s.text, { color: c.primary }]}>Call</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  dangerRow: {
    borderLeftWidth: 3,
    borderLeftColor: "#DC2626",
    paddingHorizontal: 10,
    borderRadius: 6,
    marginVertical: 5,
  },
  rowHeading: { flexDirection: "row", alignItems: "center", gap: 7 },
  previewToggle: { minHeight: 48, justifyContent: "center", gap: 4 },
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, gap: 3 },
  rowTitle: {
    fontFamily: FontFamily.interSemiBold,
    fontSize: 13,
    lineHeight: 19,
  },
  body: { fontFamily: FontFamily.interRegular, fontSize: 13, lineHeight: 19 },
  content: { gap: 10 },
  retry: { padding: 16, borderRadius: 12, minHeight: 48 },
  contacts: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  title: { fontFamily: FontFamily.interBold, fontSize: 13, lineHeight: 19 },
  text: { fontFamily: FontFamily.interSemiBold, fontSize: 13, lineHeight: 19 },
  caption: {
    fontFamily: FontFamily.interRegular,
    fontSize: 12,
    lineHeight: 18,
  },
  contact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  call: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});

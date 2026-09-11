import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useShiftBriefing } from "@/hooks/worker/useShiftBriefing";
import { useColors } from "@/hooks/useColors";
import { Typography } from "@/constants/typography";

/** Preparation only; the existing safety acknowledgement is still required. */
export function PreShiftParticipantCard({
  shiftId,
  participantId,
}: {
  shiftId: string;
  participantId?: string | null;
}) {
  const colors = useColors();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useShiftBriefing(shiftId);
  const section = (title: string, text?: string | null) =>
    text?.trim() ? (
      <View style={styles.section}>
        <Text
          accessibilityRole="header"
          style={[Typography.bodyStrong, { color: colors.foreground }]}
        >
          {title}
        </Text>
        <Text style={[Typography.body, { color: colors.foreground }]}>
          {text}
        </Text>
      </View>
    ) : null;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.heading}>
        <Feather name="clipboard" size={20} color={colors.primary} />
        <Text
          accessibilityRole="header"
          style={[Typography.h2, { color: colors.foreground, flex: 1 }]}
        >
          Before your shift
        </Text>
      </View>
      <Text style={[Typography.caption, { color: colors.mutedForeground }]}>
        Get to know the participant and review their support needs before
        clocking in.
      </Text>
      {isLoading ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading participant briefing"
        />
      ) : error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void refetch()}
          style={styles.link}
        >
          <Text style={[Typography.bodyStrong, { color: colors.primary }]}>
            Briefing unavailable. Tap to retry
          </Text>
        </Pressable>
      ) : data ? (
        <>
          {data.critical_alerts.length > 0 && (
            <View
              style={[
                styles.alert,
                {
                  backgroundColor: colors.dangerBg,
                  borderColor: colors.dangerBorder,
                },
              ]}
            >
              <Text
                accessibilityRole="header"
                style={[Typography.bodyStrong, { color: colors.dangerText }]}
              >
                Safety alerts · Read first
              </Text>
              {data.critical_alerts.map((alert) => (
                <Text
                  key={alert.id}
                  style={[Typography.body, { color: colors.dangerText }]}
                >
                  {alert.text}
                </Text>
              ))}
            </View>
          )}
          {section("About me", data.background_summary.text)}
          {section("How to support me", data.communication_preferences)}
          {section("For this shift", data.special_instructions)}
          {section("Last shift handover", data.previous_shift_note?.content)}
          {data.emergency_contacts.length > 0 && (
            <View style={styles.section}>
              <Text
                accessibilityRole="header"
                style={[Typography.bodyStrong, { color: colors.foreground }]}
              >
                Emergency contacts
              </Text>
              <View style={styles.contactsGrid}>
                {data.emergency_contacts.map((contact, index) => (
                  <Pressable
                    key={index}
                    accessibilityRole="link"
                    accessibilityLabel={`Call ${contact.name}, ${contact.phone}`}
                    onPress={() =>
                      void Linking.openURL(
                        `tel:${contact.phone.replace(/[^+\d]/g, "")}`,
                      )
                    }
                    style={[
                      styles.contact,
                      styles.contactGridItem,
                      { backgroundColor: colors.soft },
                    ]}
                  >
                    <Feather name="phone" size={18} color={colors.success} />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          Typography.bodyStrong,
                          { color: colors.foreground },
                        ]}
                      >
                        {contact.name}
                      </Text>
                      <Text
                        style={[
                          Typography.caption,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {contact.role} · {contact.phone}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </>
      ) : null}
      {participantId && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/client/${participantId}` as never)}
          style={[styles.contact, { backgroundColor: colors.soft }]}
        >
          <Feather name="user" size={18} color={colors.primary} />
          <Text
            style={[Typography.bodyStrong, { color: colors.primary, flex: 1 }]}
          >
            View participant profile
          </Text>
          <Feather name="arrow-right" size={18} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    gap: 18,
    marginTop: 16,
  },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  section: { gap: 8 },
  alert: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 },
  contact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 16,
    minHeight: 48,
  },
  contactsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  contactGridItem: { flexGrow: 1, flexBasis: "45%", minWidth: 150 },
  link: { minHeight: 48, justifyContent: "center" },
});

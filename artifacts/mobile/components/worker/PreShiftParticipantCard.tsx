import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
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

type Props = {
  shiftId: string;
  participantId?: string | null;
  title?: string;
  intro?: string;
};

type BriefingTab = "about" | "support" | "shift" | "handover";

export function PreShiftParticipantCard({
  shiftId,
  participantId,
  title = "Before your shift",
  intro = "Get to know the participant and review their support needs before clocking in.",
}: Props) {
  const colors = useColors();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useShiftBriefing(shiftId);
  const [activeTab, setActiveTab] = useState<BriefingTab>("about");
  const [expanded, setExpanded] = useState(false);

  const handleCall = useCallback((phone: string) => {
    const sanitizedPhone = phone.replace(/[^+\d]/g, "");
    void Linking.openURL(`tel:${sanitizedPhone}`);
  }, []);

  const handleOpenProfile = useCallback(() => {
    if (participantId) {
      router.push(`/client/${participantId}` as never);
    }
  }, [router, participantId]);

  const getActiveText = () => {
    if (!data) return "";
    switch (activeTab) {
      case "about":
        return data.background_summary.text;
      case "support":
        return data.communication_preferences;
      case "shift":
        return data.special_instructions;
      case "handover":
        return data.previous_shift_note?.content;
      default:
        return "";
    }
  };

  const activeContent =
    getActiveText()?.trim() || "No specific details provided for this section.";

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {/* Card Header */}
      <View style={styles.headingRow}>
        <View style={[styles.iconContainer, { backgroundColor: colors.soft }]}>
          <Feather name="clipboard" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            style={[Typography.h2, { color: colors.foreground, fontSize: 16 }]}
          >
            {title}
          </Text>
          <Text style={[Typography.caption, { color: colors.mutedForeground }]}>
            {intro}
          </Text>
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator
          color={colors.primary}
          accessibilityLabel="Loading participant briefing"
          style={styles.loader}
        />
      ) : error ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void refetch()}
          style={styles.retryButton}
        >
          <Text style={[Typography.bodyStrong, { color: colors.primary }]}>
            Briefing unavailable. Tap to retry
          </Text>
        </Pressable>
      ) : data ? (
        <>
          {/* Critical Safety Alert Banner */}
          {data.critical_alerts.length > 0 && (
            <View
              style={[
                styles.alertBanner,
                {
                  backgroundColor: colors.dangerBg,
                  borderColor: colors.dangerBorder,
                },
              ]}
            >
              <Feather name="alert-triangle" size={16} color={colors.dangerText} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  accessibilityRole="header"
                  style={[
                    Typography.bodyStrong,
                    { color: colors.dangerText, fontSize: 13 },
                  ]}
                >
                  Critical Safety Alert · Read First
                </Text>
                {data.critical_alerts.map((alert) => (
                  <Text
                    key={alert.id}
                    style={[
                      Typography.body,
                      { color: colors.dangerText, fontSize: 12, lineHeight: 16 },
                    ]}
                  >
                    {alert.text}
                  </Text>
                ))}
              </View>
            </View>
          )}

          {/* Segmented Briefing Selector */}
          <View style={[styles.tabBar, { backgroundColor: colors.soft }]}>
            {(
              [
                { id: "about", label: "About" },
                { id: "support", label: "Support" },
                { id: "shift", label: "Shift Notes" },
                { id: "handover", label: "Handover" },
              ] as const
            ).map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  onPress={() => {
                    setActiveTab(tab.id);
                    setExpanded(false);
                  }}
                  style={[
                    styles.tabItem,
                    isActive && {
                      backgroundColor: colors.card,
                      shadowColor: "#000",
                      shadowOpacity: 0.06,
                      shadowRadius: 3,
                      elevation: 2,
                    },
                  ]}
                >
                  <Text
                    style={[
                      Typography.caption,
                      {
                        color: isActive
                          ? colors.foreground
                          : colors.mutedForeground,
                        fontFamily: isActive
                          ? "Inter_600SemiBold"
                          : "Inter_500Medium",
                      },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Content Preview Box with Tap to Expand */}
          <Pressable
            onPress={() => setExpanded(!expanded)}
            style={[
              styles.contentBox,
              { backgroundColor: colors.soft, borderColor: colors.border },
            ]}
          >
            <Text
              numberOfLines={expanded ? undefined : 3}
              style={[
                Typography.body,
                { color: colors.foreground, fontSize: 13, lineHeight: 19 },
              ]}
            >
              {activeContent}
            </Text>
            {activeContent.length > 120 && (
              <Text
                style={[
                  Typography.caption,
                  {
                    color: colors.primary,
                    fontSize: 11,
                    marginTop: 6,
                    fontWeight: "600",
                  },
                ]}
              >
                {expanded ? "Show less" : "Tap to read more"}
              </Text>
            )}
          </Pressable>

          {/* Enhanced Emergency Contacts Grid */}
          {data.emergency_contacts.length > 0 && (
            <View style={styles.section}>
              <Text
                accessibilityRole="header"
                style={[
                  Typography.bodyStrong,
                  { color: colors.foreground, fontSize: 13 },
                ]}
              >
                Emergency Contacts
              </Text>
              <View style={styles.contactsGrid}>
                {data.emergency_contacts.map((contact, index) => {
                  const initials = contact.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <View
                      key={index}
                      style={[
                        styles.contactCardItem,
                        {
                          backgroundColor: colors.soft,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      {/* Avatar Initial Circle */}
                      <View
                        style={[
                          styles.contactAvatar,
                          { backgroundColor: colors.card },
                        ]}
                      >
                        <Text
                          style={[
                            Typography.bodyStrong,
                            { color: colors.primary, fontSize: 12 },
                          ]}
                        >
                          {initials}
                        </Text>
                      </View>

                      {/* Contact Details */}
                      <View style={{ flex: 1, justifyContent: "center" }}>
                        <Text
                          numberOfLines={1}
                          style={[
                            Typography.bodyStrong,
                            { color: colors.foreground, fontSize: 12 },
                          ]}
                        >
                          {contact.name}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={[
                            Typography.caption,
                            { color: colors.mutedForeground, fontSize: 10 },
                          ]}
                        >
                          {contact.role}
                        </Text>
                      </View>

                      {/* Call Trigger Button */}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Call ${contact.name}, ${contact.phone}`}
                        onPress={() => handleCall(contact.phone)}
                        style={[
                          styles.callButton,
                          {
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Feather name="phone-call" size={14} color={colors.success} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </>
      ) : null}

      {/* Profile Navigation Footer Button */}
      {participantId && (
        <Pressable
          accessibilityRole="button"
          onPress={handleOpenProfile}
          style={[
            styles.profileFooterButton,
            { backgroundColor: colors.soft, borderColor: colors.border },
          ]}
        >
          <Feather name="user" size={16} color={colors.primary} />
          <Text
            style={[
              Typography.bodyStrong,
              { color: colors.primary, flex: 1, fontSize: 13 },
            ]}
          >
            View full participant profile
          </Text>
          <Feather name="chevron-right" size={16} color={colors.primary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 14,
    marginTop: 16,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    gap: 8,
  },
  alertBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  tabBar: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
    gap: 6,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 10,
  },
  contentBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  contactsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  contactCardItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 52,
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 150,
  },
  contactAvatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  callButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  profileFooterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
  },
  loader: {
    marginVertical: 20,
  },
  retryButton: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
  },
});
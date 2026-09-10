import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FontFamily } from "@/constants/typography";
import { usePreferences } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

type Props = {
  shiftId: string;
  officePhone?: string | null;
  onReportIncident?: () => void;
};
export function DuringShiftActionsSidebar({
  shiftId,
  officePhone,
  onReportIncident,
}: Props) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reduceMotion } = usePreferences();
  const [expanded, setExpanded] = useState(false);
  const phone = officePhone?.replace(/[^+\d]/g, "");
  const actions: {
    label: string;
    icon: React.ComponentProps<typeof Feather>["name"];
    run: () => void;
  }[] = [
    {
      label: "Message office",
      icon: "message-square",
      run: () => router.push(`/shift/${shiftId}/message-office` as never),
    },
    ...(phone
      ? [
          {
            label: "Call office",
            icon: "phone" as const,
            run: () => {
              void Linking.openURL(`tel:${phone}`);
            },
          },
        ]
      : []),
    ...(onReportIncident
      ? [
          {
            label: "Report incident",
            icon: "alert-triangle" as const,
            run: onReportIncident,
          },
        ]
      : []),
  ];
  return (
    <>
      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(true)}
          style={[styles.trigger, { backgroundColor: colors.soft }]}
        >
          <Feather name="grid" size={18} color={colors.primary} />
          <Text style={[styles.label, { color: colors.primary }]}>
            Shift actions
          </Text>
          <Feather name="chevron-up" size={18} color={colors.primary} />
        </Pressable>
      </View>
      <Modal
        visible={expanded}
        transparent
        animationType={reduceMotion ? "none" : "slide"}
        onRequestClose={() => setExpanded(false)}
      >
        <View style={styles.backdrop}>
          <Pressable
            accessible={false}
            style={StyleSheet.absoluteFill}
            onPress={() => setExpanded(false)}
          />
          <View
            accessibilityViewIsModal
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <View style={styles.header}>
              <Text
                accessibilityRole="header"
                style={[styles.title, { color: colors.foreground }]}
              >
                Shift actions
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close shift actions"
                onPress={() => setExpanded(false)}
                style={styles.close}
              >
                <Feather name="x" size={22} color={colors.foreground} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            >
              {actions.map((action) => (
                <Pressable
                  key={action.label}
                  accessibilityRole="button"
                  onPress={() => {
                    setExpanded(false);
                    action.run();
                  }}
                  style={[styles.action, { backgroundColor: colors.soft }]}
                >
                  <Feather
                    name={action.icon}
                    size={20}
                    color={colors.primary}
                  />
                  <Text style={[styles.label, { color: colors.foreground }]}>
                    {action.label}
                  </Text>
                  <Feather
                    name="chevron-right"
                    size={18}
                    color={colors.primary}
                  />
                </Pressable>
              ))}
              {!phone ? (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  No office phone recorded. Use Message office to contact your
                  team.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  footer: { padding: 10, borderTopWidth: 1 },
  trigger: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    padding: 14,
    minHeight: 48,
    borderRadius: 16,
  },
  label: {
    fontFamily: FontFamily.interSemiBold,
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    maxHeight: "85%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  header: { flexDirection: "row", alignItems: "center", padding: 16, gap: 10 },
  title: {
    fontFamily: FontFamily.interBold,
    fontSize: 20,
    lineHeight: 27,
    flex: 1,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    padding: 16,
    borderRadius: 16,
  },
  hint: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    lineHeight: 20,
    paddingVertical: 12,
  },
});

import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import React, { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

const DEFAULT_OFFICE_PHONE = "1300 000 000";

type Props = {
  officePhone?: string | null;
};

type ActionItem = {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  accent: string;
  onPress: () => void;
};

export function DuringShiftActionsSidebar({ officePhone }: Props) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const phone = (officePhone || DEFAULT_OFFICE_PHONE).replace(/\s/g, "");

  const actions: ActionItem[] = [
    {
      id: "message",
      label: "Message office",
      icon: "message-square",
      accent: colors.primary,
      onPress: () => void Linking.openURL(`sms:${phone}`),
    },
    {
      id: "call",
      label: "Call office",
      icon: "phone-call",
      accent: "#16A34A",
      onPress: () => void Linking.openURL(`tel:${phone}`),
    },
    {
      id: "emergency",
      label: "Emergency 000",
      icon: "phone",
      accent: "#DC2626",
      onPress: () => void Linking.openURL("tel:000"),
    },
  ];

  if (!expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        style={[styles.tab, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Feather name="chevron-left" size={16} color={colors.mutedForeground} />
      </Pressable>
    );
  }

  const overlayColor = colors.scheme === "dark" ? "rgba(31,41,55,0.55)" : "rgba(255,255,255,0.55)";

  return (
    <BlurView
      intensity={28}
      tint={colors.scheme === "dark" ? "dark" : "light"}
      style={[styles.panel, { borderColor: colors.border }]}
    >
      <View style={[styles.panelOverlay, { backgroundColor: overlayColor }]}>
      <Text style={[styles.header, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
        QUICK ACTIONS
      </Text>
      {actions.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => {
            item.onPress();
            setExpanded(false);
          }}
          style={styles.row}
        >
          <Text style={[styles.rowLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            {item.label}
          </Text>
          <View style={[styles.rowIcon, { backgroundColor: item.accent }]}>
            <Feather name={item.icon} size={15} color="#FFFFFF" />
          </View>
        </Pressable>
      ))}
      <Pressable onPress={() => setExpanded(false)} style={[styles.closeRow, { borderTopColor: colors.border }]}>
        <Feather name="chevron-right" size={12} color={colors.mutedForeground} />
        <Text style={[styles.closeText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
          Close quick actions
        </Text>
      </Pressable>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  tab: {
    position: "absolute",
    right: 0,
    top: "42%",
    zIndex: 15,
    width: 22,
    height: 48,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    borderWidth: 1,
    borderRightWidth: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  panel: {
    position: "absolute",
    right: 0,
    top: "28%",
    zIndex: 30,
    width: 200,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    borderWidth: 1,
    borderRightWidth: 0,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: -2, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  panelOverlay: {
    paddingBottom: 4,
  },
  header: {
    fontSize: 9,
    letterSpacing: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  rowLabel: {
    flex: 1,
    fontSize: 13,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  closeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  closeText: {
    fontSize: 11,
  },
});

import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GuideSheet } from "@/components/worker/guide/GuideSheet";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { GUIDES, type GuideId } from "@/lib/guides";

/** The app manual: every guide in one list. */
export default function GuidesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const [open, setOpen] = useState<GuideId | null>(null);

  return (
    <WorkerStackScreen
      headerTitle={t("guide.allTitle")}
      cardsOnBackground
      showBack
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Text
          style={[
            styles.intro,
            {
              color: colors.mutedForeground,
              fontFamily: FontFamily.interRegular,
            },
          ]}
        >
          {t("guide.allIntro")}
        </Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {GUIDES.map((guide, i) => (
            <Pressable
              key={guide.id}
              accessibilityRole="button"
              onPress={() => setOpen(guide.id)}
              style={({ pressed }) => [
                styles.row,
                i < GUIDES.length - 1 && {
                  borderBottomColor: colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
                pressed && { backgroundColor: colors.soft },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: colors.soft }]}>
                <Feather name={guide.icon} size={18} color={colors.primary} />
              </View>
              <View style={styles.copy}>
                <Text
                  style={[
                    styles.title,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {t(guide.title)}
                </Text>
                <Text
                  style={[
                    styles.summary,
                    {
                      color: colors.mutedForeground,
                      fontFamily: FontFamily.interRegular,
                    },
                  ]}
                >
                  {t(guide.summary)}
                </Text>
              </View>
              <Feather
                name="chevron-right"
                size={18}
                color={colors.mutedForeground}
              />
            </Pressable>
          ))}
        </View>
      </ScrollView>
      {open ? (
        <GuideSheet
          id={open}
          visible
          onClose={() => setOpen(null)}
          showAllLink={false}
        />
      ) : null}
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 14 },
  intro: { fontSize: 15, lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: 20, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 16 },
  summary: { fontSize: 13, lineHeight: 18 },
});

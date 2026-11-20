import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { guideById, stepKeys, type GuideId } from "@/lib/guides";

/** A guide as a bottom sheet: numbered steps, then "Got it". */
export function GuideSheet({
  id,
  visible,
  onClose,
  showAllLink = true,
}: {
  id: GuideId;
  visible: boolean;
  onClose: () => void;
  showAllLink?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const guide = guideById(id);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessible={false}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, paddingBottom: insets.bottom + 18 },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={styles.head}>
            <View style={[styles.icon, { backgroundColor: colors.soft }]}>
              <Feather name={guide.icon} size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.eyebrow,
                  {
                    color: colors.primary,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t("guide.howItWorks")}
              </Text>
              <Text
                accessibilityRole="header"
                style={[
                  styles.title,
                  { color: colors.foreground, fontFamily: FontFamily.display },
                ]}
              >
                {t(guide.title)}
              </Text>
            </View>
          </View>

          <ScrollView style={styles.steps} contentContainerStyle={{ gap: 16 }}>
            {Array.from({ length: guide.steps }, (_, i) => {
              const keys = stepKeys(guide.id, i + 1);
              return (
                <View key={i} style={styles.step}>
                  <View
                    style={[styles.num, { backgroundColor: colors.primary }]}
                  >
                    <Text
                      style={[
                        styles.numText,
                        {
                          color: colors.primaryForeground,
                          fontFamily: FontFamily.interBold,
                        },
                      ]}
                    >
                      {i + 1}
                    </Text>
                  </View>
                  <View style={styles.stepCopy}>
                    <Text
                      style={[
                        styles.stepTitle,
                        {
                          color: colors.foreground,
                          fontFamily: FontFamily.interSemiBold,
                        },
                      ]}
                    >
                      {t(keys.title)}
                    </Text>
                    <Text
                      style={[
                        styles.stepBody,
                        {
                          color: colors.mutedForeground,
                          fontFamily: FontFamily.interRegular,
                        },
                      ]}
                    >
                      {t(keys.body)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.done, { backgroundColor: colors.primary }]}
          >
            <Text
              style={[
                styles.doneText,
                {
                  color: colors.primaryForeground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("guide.gotIt")}
            </Text>
          </Pressable>
          {showAllLink ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                onClose();
                router.push("/worker/guides" as never);
              }}
              style={styles.allLink}
            >
              <Text
                style={[
                  styles.allText,
                  {
                    color: colors.primary,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t("guide.seeAll")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** The "?" button for a screen's header that opens its guide. */
export function GuideButton({
  id,
  onDark = true,
}: {
  id: GuideId;
  onDark?: boolean;
}) {
  const colors = useColors();
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("guide.openFor", {
          name: t(guideById(id).title),
        })}
        onPress={() => setOpen(true)}
        style={[
          styles.qBtn,
          { backgroundColor: onDark ? "rgba(255,255,255,0.16)" : colors.soft },
        ]}
      >
        <Feather
          name="help-circle"
          size={19}
          color={onDark ? colors.primaryForeground : colors.primary}
        />
      </Pressable>
      <GuideSheet id={id} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26,26,46,0.45)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
    maxHeight: "86%",
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: { fontSize: 13 },
  title: { fontSize: 21, lineHeight: 27 },
  steps: { flexGrow: 0 },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  num: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  numText: { fontSize: 14 },
  stepCopy: { flex: 1, gap: 3 },
  stepTitle: { fontSize: 16, lineHeight: 21 },
  stepBody: { fontSize: 15, lineHeight: 21 },
  done: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { fontSize: 16 },
  allLink: { alignSelf: "center", paddingVertical: 6 },
  allText: { fontSize: 15 },
  qBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});

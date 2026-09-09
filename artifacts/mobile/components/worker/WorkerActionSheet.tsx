import { Feather } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { FontFamily, Typography } from "@/constants/typography";

export type WorkerActionFeedback = {
  kind: "loading" | "success" | "offline" | "error";
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};
export function WorkerActionSheet({
  feedback,
  onClose,
}: {
  feedback: WorkerActionFeedback;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const loading = feedback.kind === "loading";
  const tone =
    feedback.kind === "error"
      ? colors.dangerText
      : feedback.kind === "success"
        ? colors.success
        : colors.primary;
  const icon =
    feedback.kind === "error"
      ? "alert-triangle"
      : feedback.kind === "offline"
        ? "wifi-off"
        : "check";
  return (
    <View style={[styles.overlay, { paddingTop: insets.top + 16 }]}>
      <ScrollView
        accessibilityViewIsModal
        style={[styles.sheet, { backgroundColor: colors.card }]}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <View
          style={[
            styles.icon,
            {
              backgroundColor:
                feedback.kind === "error" ? colors.dangerBg : colors.soft,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator
              size="large"
              color={colors.primary}
              accessibilityLabel="Clock-in in progress"
            />
          ) : (
            <Feather name={icon} size={38} color={tone} />
          )}
        </View>
        <View accessibilityLiveRegion="polite" style={styles.copy}>
          <Text
            accessibilityRole="header"
            style={[Typography.h1, styles.title, { color: colors.foreground }]}
          >
            {feedback.title}
          </Text>
          <Text
            style={[
              Typography.body,
              styles.message,
              { color: colors.mutedForeground },
            ]}
          >
            {feedback.message}
          </Text>
        </View>
        {loading ? (
          <View style={[styles.progress, { backgroundColor: colors.soft }]}>
            <Text style={[Typography.bodyStrong, { color: colors.primary }]}>
              Please wait…
            </Text>
          </View>
        ) : (
          <View style={styles.actions}>
            {feedback.kind === "error" && feedback.onAction && (
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={[styles.button, { backgroundColor: colors.muted }]}
              >
                <Text
                  style={[styles.buttonLabel, { color: colors.foreground }]}
                >
                  Close
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={feedback.onAction ?? onClose}
              style={[styles.button, { backgroundColor: colors.primary }]}
            >
              <Text
                style={[
                  styles.buttonLabel,
                  { color: colors.primaryForeground },
                ]}
              >
                {feedback.actionLabel ??
                  (feedback.kind === "error" ? "Close" : "Continue to shift")}
              </Text>
              {feedback.kind !== "error" && (
                <Feather
                  name="arrow-right"
                  size={18}
                  color={colors.primaryForeground}
                />
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  sheet: {
    width: "100%",
    maxWidth: 600,
    maxHeight: "100%",
    flexGrow: 0,
    alignSelf: "center",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
  },
  content: { padding: 24, gap: 24, alignItems: "center" },
  handle: { width: 36, height: 4, borderRadius: 2, marginTop: -12 },
  icon: {
    width: 88,
    height: 88,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  copy: { gap: 10, width: "100%" },
  title: { textAlign: "center" },
  message: { textAlign: "center" },
  progress: {
    minHeight: 48,
    padding: 14,
    borderRadius: 24,
    alignItems: "center",
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12, width: "100%" },
  button: {
    flexGrow: 1,
    flexBasis: 120,
    minHeight: 52,
    padding: 16,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonLabel: {
    fontFamily: FontFamily.interBold,
    fontSize: 15,
    textAlign: "center",
    flexShrink: 1,
  },
});

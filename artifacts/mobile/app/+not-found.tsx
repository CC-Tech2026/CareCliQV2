import { Feather } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { FontFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";

/** Reached from an old notification or link to something that's gone (a
 * cancelled shift, a removed record). Says so plainly and offers the way
 * back, instead of the template's "Oops!". */
export default function NotFoundScreen() {
  const colors = useColors();
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.icon, { backgroundColor: colors.soft }]}>
          <Feather name="compass" size={26} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>This page isn't available</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          It may have been moved, or the shift or record it pointed to was changed or removed.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/" as never)}
          style={[styles.button, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Back to home</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 10,
  },
  icon: { width: 60, height: 60, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  title: { fontFamily: FontFamily.interBold, fontSize: 20, textAlign: "center" },
  body: { fontFamily: FontFamily.interRegular, fontSize: 14, lineHeight: 21, textAlign: "center", maxWidth: 320 },
  button: { marginTop: 14, minHeight: 48, paddingHorizontal: 26, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: FontFamily.interSemiBold, fontSize: 15 },
});

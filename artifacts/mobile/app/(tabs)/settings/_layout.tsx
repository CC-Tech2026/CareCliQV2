import { Stack } from "expo-router";
import { getReduceMotionEnabled } from "@/lib/motion";

export default function SettingsTabLayout() {
  const animation = getReduceMotionEnabled() ? "none" : "slide_from_right";

  return (
    <Stack screenOptions={{ headerShown: false, animation }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="account" />
      <Stack.Screen name="signature" />
      <Stack.Screen name="emergency-contact" />
      <Stack.Screen name="birthday" />
      <Stack.Screen name="profile" />
    </Stack>
  );
}

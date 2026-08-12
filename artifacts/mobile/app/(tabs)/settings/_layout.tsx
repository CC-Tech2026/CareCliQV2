import { Stack } from "expo-router";
import { getReduceMotionEnabled } from "@/lib/motion";

export default function SettingsTabLayout() {
  const animation = getReduceMotionEnabled() ? "none" : "slide_from_right";

  return (
    <Stack screenOptions={{ headerShown: false, animation }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="account" />
      <Stack.Screen name="signature" />
      <Stack.Screen name="practitioner" />
      <Stack.Screen name="contact" />
      <Stack.Screen name="emergency-contact" />
      <Stack.Screen name="provider" />
      <Stack.Screen name="defaults" />
      <Stack.Screen name="compliance" />
      <Stack.Screen name="change-password" />
      <Stack.Screen name="text-size" />
      <Stack.Screen name="language" />
    </Stack>
  );
}

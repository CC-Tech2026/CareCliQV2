import { Stack } from "expo-router";
import React from "react";

export default function ClientDetailLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="overview" />
      <Stack.Screen name="plan" />
      <Stack.Screen name="shift-notes" />
      <Stack.Screen name="compliance" />
      <Stack.Screen name="session" options={{ animation: "slide_from_bottom" }} />
    </Stack>
  );
}

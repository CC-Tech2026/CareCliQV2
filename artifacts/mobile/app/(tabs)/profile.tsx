import { Redirect } from "expo-router";
import React from "react";

/** Profile hub lives at Settings (avatar → Profile). */
export default function ProfileTabScreen() {
  return <Redirect href={"/(tabs)/settings" as never} />;
}

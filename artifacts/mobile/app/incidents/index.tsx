import { Redirect } from "expo-router";
import React from "react";

/** Incidents list lives under Compliance → Incidents (v1.5 redesign). */
export default function IncidentsListScreen() {
  return <Redirect href={"/(tabs)/compliance?segment=incidents" as never} />;
}

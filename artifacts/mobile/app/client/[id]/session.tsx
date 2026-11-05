import { Redirect } from "expo-router";

/** Sessions must be started from an assigned shift, not the participant profile. */
export default function ClientSessionScreen() {
  return <Redirect href="/(tabs)/shifts" />;
}

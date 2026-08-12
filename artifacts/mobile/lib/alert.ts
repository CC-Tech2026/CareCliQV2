import { Alert, Platform } from "react-native";

export type AlertAction = {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

/**
 * Cross-platform alert. React Native's `Alert.alert` is a no-op on
 * react-native-web, so on web we fall back to `window.alert`/`window.confirm`.
 */
export function showAlert(title: string, message?: string, buttons?: AlertAction[]): void {
  if (Platform.OS !== "web") {
    Alert.alert(title, message, buttons);
    return;
  }

  const body = message ? `${title}\n\n${message}` : title;

  if (typeof window === "undefined") return;

  const actionable = buttons?.filter((b) => b.style !== "cancel") ?? [];
  const cancelBtn = buttons?.find((b) => b.style === "cancel");

  if (buttons && buttons.length > 1) {
    const confirmed = window.confirm(body);
    if (confirmed) {
      actionable[0]?.onPress?.();
    } else {
      cancelBtn?.onPress?.();
    }
    return;
  }

  window.alert(body);
  buttons?.[0]?.onPress?.();
}

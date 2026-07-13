import * as ExpoHaptics from "expo-haptics";

let hapticsEnabled = true;

export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
}

export function getHapticsEnabled(): boolean {
  return hapticsEnabled;
}

export const ImpactFeedbackStyle = ExpoHaptics.ImpactFeedbackStyle;
export const NotificationFeedbackType = ExpoHaptics.NotificationFeedbackType;

export async function impactAsync(
  style: ExpoHaptics.ImpactFeedbackStyle = ExpoHaptics.ImpactFeedbackStyle.Medium,
): Promise<void> {
  if (!hapticsEnabled) return;
  try {
    await ExpoHaptics.impactAsync(style);
  } catch {
    /* unsupported platform */
  }
}

export async function notificationAsync(
  type: ExpoHaptics.NotificationFeedbackType,
): Promise<void> {
  if (!hapticsEnabled) return;
  try {
    await ExpoHaptics.notificationAsync(type);
  } catch {
    /* unsupported platform */
  }
}

export async function selectionAsync(): Promise<void> {
  if (!hapticsEnabled) return;
  try {
    await ExpoHaptics.selectionAsync();
  } catch {
    /* unsupported platform */
  }
}

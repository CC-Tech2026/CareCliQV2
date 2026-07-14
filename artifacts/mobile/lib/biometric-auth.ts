import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { CCQ_BIOMETRIC_CREDS_KEY, CCQ_BIOMETRIC_KEY } from "@/lib/storage-keys";

export type BiometricCredentials = {
  identifier: string;
  password: string;
};

export type BiometricKind = "face" | "fingerprint";

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getAvailableBiometricKinds(): Promise<BiometricKind[]> {
  if (Platform.OS === "web") return [];
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return [];
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return [];
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const kinds: BiometricKind[] = [];
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      kinds.push("face");
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      kinds.push("fingerprint");
    }
    // Some Android OEMs expose biometrics without typing face/fingerprint clearly.
    if (kinds.length === 0 && types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
      kinds.push("face");
    }
    return kinds;
  } catch {
    return [];
  }
}

export async function isBiometricHardwareAvailable(): Promise<boolean> {
  const kinds = await getAvailableBiometricKinds();
  return kinds.length > 0;
}

export function labelForBiometricKind(kind: BiometricKind): string {
  if (kind === "face") {
    return Platform.OS === "ios" ? "Face ID" : "Face unlock";
  }
  return Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
}

export async function getBiometricLabel(): Promise<string> {
  const kinds = await getAvailableBiometricKinds();
  if (kinds.includes("face")) return labelForBiometricKind("face");
  if (kinds.includes("fingerprint")) return labelForBiometricKind("fingerprint");
  return "Biometrics";
}

export async function isBiometricUnlockEnabled(): Promise<boolean> {
  const value = await AsyncStorage.getItem(CCQ_BIOMETRIC_KEY);
  return value === "true";
}

export async function setBiometricUnlockEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(CCQ_BIOMETRIC_KEY, enabled ? "true" : "false");
  if (!enabled) {
    await clearBiometricCredentials();
  }
}

export async function authenticateWithBiometrics(promptMessage?: string): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return false;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage ?? "Unlock CareCliQ",
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
      biometricsSecurityLevel: Platform.OS === "android" ? "strong" : undefined,
    });
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Enable biometric unlock and optionally store login credentials so Face/Fingerprint
 * works immediately on the next cold start (no extra password login required).
 */
export async function enableBiometricUnlock(options?: {
  identifier?: string;
  password?: string;
  promptMessage?: string;
}): Promise<{ ok: boolean; reason?: "unavailable" | "cancelled" | "missing_password" }> {
  const available = await isBiometricHardwareAvailable();
  if (!available) {
    return { ok: false, reason: "unavailable" };
  }

  const label = await getBiometricLabel();
  const ok = await authenticateWithBiometrics(
    options?.promptMessage ?? `Enable ${label}`,
  );
  if (!ok) return { ok: false, reason: "cancelled" };

  await setBiometricUnlockEnabled(true);

  const identifier = options?.identifier?.trim();
  const password = options?.password;
  if (identifier && password) {
    await secureSet(CCQ_BIOMETRIC_CREDS_KEY, JSON.stringify({ identifier, password }));
  }

  return { ok: true };
}

export async function disableBiometricUnlock(): Promise<void> {
  await setBiometricUnlockEnabled(false);
}

export async function saveBiometricCredentials(creds: BiometricCredentials): Promise<void> {
  const available = await isBiometricHardwareAvailable();
  if (!available) return;
  // Respect explicit opt-out from Settings; otherwise enable + store for next login.
  const flag = await AsyncStorage.getItem(CCQ_BIOMETRIC_KEY);
  if (flag === "false") return;
  await AsyncStorage.setItem(CCQ_BIOMETRIC_KEY, "true");
  await secureSet(CCQ_BIOMETRIC_CREDS_KEY, JSON.stringify(creds));
}

export async function readBiometricCredentials(): Promise<BiometricCredentials | null> {
  // Prefer canonical key; fall back to legacy key used in earlier builds.
  const raw =
    (await secureGet(CCQ_BIOMETRIC_CREDS_KEY)) ??
    (await secureGet("ccq_biometric_login_creds"));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BiometricCredentials;
    if (!parsed.identifier || !parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearBiometricCredentials(): Promise<void> {
  await secureDelete(CCQ_BIOMETRIC_CREDS_KEY);
  await secureDelete("ccq_biometric_login_creds");
}

export async function canUseBiometricLogin(): Promise<boolean> {
  const enabled = await isBiometricUnlockEnabled();
  if (!enabled) return false;
  const available = await isBiometricHardwareAvailable();
  if (!available) return false;
  const creds = await readBiometricCredentials();
  return Boolean(creds);
}

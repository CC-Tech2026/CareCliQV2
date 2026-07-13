import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { CCQ_BIOMETRIC_KEY } from "@/lib/storage-keys";

const CREDS_KEY = "ccq_biometric_login_creds";

export type BiometricCredentials = {
  identifier: string;
  password: string;
};

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
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

export async function isBiometricHardwareAvailable(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;
    return LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

export async function getBiometricLabel(): Promise<string> {
  if (Platform.OS === "web") return "Biometrics";
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return Platform.OS === "ios" ? "Face ID" : "Face unlock";
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return Platform.OS === "ios" ? "Touch ID" : "Fingerprint";
    }
  } catch {
    /* fall through */
  }
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
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage ?? "Unlock CareCliQ",
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}

export async function enableBiometricUnlock(): Promise<{ ok: boolean; reason?: string }> {
  const available = await isBiometricHardwareAvailable();
  if (!available) {
    return { ok: false, reason: "unavailable" };
  }
  const ok = await authenticateWithBiometrics("Enable biometric unlock");
  if (!ok) return { ok: false, reason: "cancelled" };
  await setBiometricUnlockEnabled(true);
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
  await secureSet(CREDS_KEY, JSON.stringify(creds));
}

export async function readBiometricCredentials(): Promise<BiometricCredentials | null> {
  const raw = await secureGet(CREDS_KEY);
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
  await secureDelete(CREDS_KEY);
}

export async function canUseBiometricLogin(): Promise<boolean> {
  const enabled = await isBiometricUnlockEnabled();
  if (!enabled) return false;
  const available = await isBiometricHardwareAvailable();
  if (!available) return false;
  const creds = await readBiometricCredentials();
  return Boolean(creds);
}

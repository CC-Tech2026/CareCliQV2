import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";
import {
  CCQ_DEVICE_ID_KEY,
  CCQ_TOKEN_KEY,
  migrateLegacyCareScribeStorageKeys,
} from "./storage-keys";

let memoryToken: string | null = null;
let migrationDone = false;

async function ensureStorageMigrated(): Promise<void> {
  if (migrationDone) return;
  migrationDone = true;
  await migrateLegacyCareScribeStorageKeys(
    (key) => AsyncStorage.getItem(key),
    (key, value) => AsyncStorage.setItem(key, value),
    (key) => AsyncStorage.removeItem(key),
  );
}

export function setMobileAuthToken(token: string | null): void {
  memoryToken = token;
}

export async function readMobileAuthToken(): Promise<string | null> {
  await ensureStorageMigrated();
  if (memoryToken) return memoryToken;
  try {
    return await AsyncStorage.getItem(CCQ_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getMobileDeviceId(): Promise<string> {
  await ensureStorageMigrated();
  try {
    const stored = await AsyncStorage.getItem(CCQ_DEVICE_ID_KEY);
    if (stored) return stored;
  } catch {
    /* noop */
  }

  let seed = "mobile";
  if (Platform.OS === "android" && Application.getAndroidId) {
    seed = Application.getAndroidId() ?? seed;
  } else if (Platform.OS === "ios" && Application.getIosIdForVendorAsync) {
    try {
      seed = (await Application.getIosIdForVendorAsync()) ?? seed;
    } catch {
      /* noop */
    }
  }

  const id = `m-${seed}-${Date.now().toString(36)}`;
  try {
    await AsyncStorage.setItem(CCQ_DEVICE_ID_KEY, id);
  } catch {
    /* noop */
  }
  return id;
}

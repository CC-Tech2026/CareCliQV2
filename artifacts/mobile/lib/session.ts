import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Platform } from "react-native";

const TOKEN_KEY = "carescribe_token";
const DEVICE_ID_KEY = "carescribe_device_id";

let memoryToken: string | null = null;

export function setMobileAuthToken(token: string | null): void {
  memoryToken = token;
}

export async function readMobileAuthToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getMobileDeviceId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
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
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  } catch {
    /* noop */
  }
  return id;
}

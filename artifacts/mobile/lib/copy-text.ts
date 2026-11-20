import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

type NativeClipboard = {
  setStringAsync?: (
    text: string,
    options: Record<string, unknown>,
  ) => Promise<boolean>;
};

/**
 * Copies text to the clipboard. Phones use the system clipboard (the native
 * side of expo-clipboard); the web preview uses the browser's. Throws if
 * neither is available.
 *
 * The native module is looked up rather than imported: an app build made
 * before expo-clipboard was added doesn't contain it, and importing the
 * package there crashes the whole app ("Cannot find native module
 * 'ExpoClipboard'"). Looked up, copying just fails politely in old builds.
 */
export async function copyText(text: string): Promise<void> {
  if (Platform.OS !== "web") {
    const clipboard =
      requireOptionalNativeModule<NativeClipboard>("ExpoClipboard");
    if (!clipboard?.setStringAsync) throw new Error("Clipboard unavailable");
    await clipboard.setStringAsync(text, {});
    return;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document !== "undefined") {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (copied) return;
  }

  throw new Error("Clipboard unavailable");
}

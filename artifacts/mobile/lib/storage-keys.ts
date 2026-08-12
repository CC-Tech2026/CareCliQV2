/** CareCliQ mobile storage keys (replaces legacy carescribe_*). */

export const CCQ_TOKEN_KEY = "ccq_token";
export const CCQ_DEVICE_ID_KEY = "ccq_device_id";
export const CCQ_USER_KEY = "ccq_user";
export const CCQ_THEME_MODE_KEY = "ccq_theme_mode";
export const CCQ_LANGUAGE_KEY = "ccq_language";
export const CCQ_TEXT_SCALE_KEY = "ccq_text_scale";
export const CCQ_HIGH_CONTRAST_KEY = "ccq_high_contrast";
export const CCQ_DYSLEXIA_FONT_KEY = "ccq_dyslexia_font";
export const CCQ_REAUTH_TOKEN_KEY = "ccq_reauth_token";
export const CCQ_REAUTH_UNTIL_KEY = "ccq_reauth_until";

const LEGACY_KEY_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["carescribe_token", CCQ_TOKEN_KEY],
  ["carescribe_device_id", CCQ_DEVICE_ID_KEY],
];

export async function migrateLegacyCareScribeStorageKeys(
  getItem: (key: string) => Promise<string | null>,
  setItem: (key: string, value: string) => Promise<void>,
  removeItem: (key: string) => Promise<void>,
): Promise<void> {
  for (const [legacy, next] of LEGACY_KEY_PAIRS) {
    const value = await getItem(legacy);
    if (value !== null && (await getItem(next)) === null) {
      await setItem(next, value);
    }
    await removeItem(legacy);
  }
}

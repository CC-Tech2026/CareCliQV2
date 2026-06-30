/** CareCliQ mobile storage keys (replaces legacy carescribe_*). */

export const CCQ_TOKEN_KEY = "ccq_token";
export const CCQ_DEVICE_ID_KEY = "ccq_device_id";

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

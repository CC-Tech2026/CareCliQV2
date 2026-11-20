import Constants from "expo-constants";

/** App IDs of the side-by-side test apps (see app.config.js). */
const TEST_APP_IDS = ["care.cliq2026.dev", "care.cliq2026.demo"];

/**
 * True in CareCliQ Dev, CareCliQ Demo and local development; false in the
 * real CareCliQ app that workers install. Gates tools meant for our own
 * testing, such as replaying the splash and welcome screens.
 */
export const IS_TEST_BUILD: boolean =
  __DEV__ ||
  TEST_APP_IDS.includes(Constants.expoConfig?.android?.package ?? "") ||
  TEST_APP_IDS.includes(Constants.expoConfig?.ios?.bundleIdentifier ?? "");

import { Image } from "expo-image";
import React from "react";
import { StyleSheet, View } from "react-native";

/**
 * Branded start/splash screen matching the CareCliQ logo
 * (frontend carecliQ_logo_new.png): black canvas, centered mark + wordmark.
 */
export function AppSplash() {
  return (
    <View style={styles.root} accessibilityLabel="CareCliQ">
      <Image
        source={require("@/assets/images/logo.png")}
        style={styles.logo}
        contentFit="contain"
        accessibilityLabel="CareCliQ"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    width: 280,
    height: 224,
  },
});

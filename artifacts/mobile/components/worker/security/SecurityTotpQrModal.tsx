import { Feather } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { QrCodeSvg } from "@/lib/qr-code-svg";

type Props = {
  visible: boolean;
  otpAuthUrl: string | null;
  onClose: () => void;
};

export function SecurityTotpQrModal({ visible, otpAuthUrl, onClose }: Props) {
  const colors = useColors();
  const t = useT();
  const isDark = colors.scheme === "dark";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {t("security.scanQr")}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t("common.cancel")}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={[styles.description, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("security.qrDescription")}
          </Text>
          <View
            style={[
              styles.qrWrap,
              {
                backgroundColor: isDark ? colors.background : "#FFFFFF",
                borderColor: colors.border,
              },
            ]}
          >
            {otpAuthUrl ? (
              <QrCodeSvg
                value={otpAuthUrl}
                size={220}
                color={isDark ? "#FFFFFF" : "#1A1A2E"}
              />
            ) : null}
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("security.qrManualHint")}
          </Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 18, letterSpacing: -0.2 },
  description: { fontSize: 13, lineHeight: 18 },
  qrWrap: {
    alignSelf: "center",
    borderWidth: 1,
    borderRadius: 18,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { fontSize: 12, lineHeight: 17, textAlign: "center" },
});

import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type Step = "choose" | "scanning" | "manual";

type Props = {
  onClose: () => void;
  onChooseGps: () => void;
  onQrScanned: (token: string) => void;
};

/**
 * Clock-in method chooser + QR scanner. Mobile is the only place workers
 * clock in now (the web app is read-only for anything not yet completed -
 * see my-shift-detail.tsx), so it needed the same GPS/QR choice the web app
 * already had rather than staying GPS-only: a participant's home with poor
 * GPS reception previously had no fallback at all on mobile.
 *
 * GPS itself is handled by the caller (onChooseGps just closes this sheet
 * and lets WorkerMobileShiftView's existing location logic run) - this
 * component only owns the QR path, since that's the net-new capability.
 */
export function WorkerMobileClockInSheet({
  onClose,
  onChooseGps,
  onQrScanned,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>("choose");
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState("");
  const scannedRef = useRef(false);

  const startScanning = async () => {
    scannedRef.current = false;
    try {
      if (!permission || !permission.granted) {
        const result = await requestPermission();
        if (!result.granted) {
          setStep("manual");
          return;
        }
      }
      setStep("scanning");
    } catch {
      // Permission API unavailable/failed on this device - fall back to manual entry.
      setStep("manual");
    }
  };

  const handleBarcodeScanned = (result: { data: string }) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    onQrScanned(result.data.trim());
  };

  const submitManualCode = () => {
    const token = manualCode.trim();
    if (!token) return;
    onQrScanned(token);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.overlay, { paddingTop: insets.top + 16 }]}
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close clock-in options"
      />
      <View
        accessibilityViewIsModal
        style={[
          styles.wrap,
          { backgroundColor: colors.card, paddingBottom: insets.bottom + 12 },
          step === "scanning" && { flex: 1 },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, backgroundColor: colors.card },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close clock-in options"
            onPress={onClose}
            hitSlop={8}
            style={[styles.back, { borderColor: colors.border }]}
          >
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>
          <Text
            style={[
              styles.title,
              {
                color: colors.foreground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            Clock in
          </Text>
        </View>

        {step === "choose" && (
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.introIcon, { backgroundColor: colors.soft }]}>
              <Feather name="map-pin" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.introTitle, { color: colors.foreground }]}>
              Ready to begin?
            </Text>
            <Text style={[styles.introHint, { color: colors.mutedForeground }]}>
              Choose how to verify your arrival.
            </Text>
            <Pressable
              onPress={onChooseGps}
              style={[
                styles.choiceCard,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <Feather name="map-pin" size={22} color={colors.primary} />
              <View style={styles.choiceText}>
                <Text
                  style={[
                    styles.choiceTitle,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  Use my location
                </Text>
                <Text
                  style={[
                    styles.choiceHint,
                    {
                      color: colors.mutedForeground,
                      fontFamily: FontFamily.interRegular,
                    },
                  ]}
                >
                  Verifies you're at the participant's address.
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => void startScanning()}
              style={[
                styles.choiceCard,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <Feather name="maximize" size={22} color={colors.primary} />
              <View style={styles.choiceText}>
                <Text
                  style={[
                    styles.choiceTitle,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  Scan QR code
                </Text>
                <Text
                  style={[
                    styles.choiceHint,
                    {
                      color: colors.mutedForeground,
                      fontFamily: FontFamily.interRegular,
                    },
                  ]}
                >
                  Use this if your location can't be verified (e.g. weak GPS
                  signal).
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => setStep("manual")}
              style={styles.manualLink}
            >
              <Text
                style={[
                  styles.manualLinkText,
                  {
                    color: colors.primary,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                Enter a code instead
              </Text>
            </Pressable>
          </ScrollView>
        )}

        {step === "scanning" && (
          <View style={styles.scannerWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={handleBarcodeScanned}
            />
            <View style={styles.scannerOverlay} pointerEvents="none">
              <View style={styles.scannerBox} />
            </View>
            <Text style={styles.scannerHint}>
              Point your camera at the shift's QR code
            </Text>
            <Pressable
              onPress={() => setStep("choose")}
              style={[styles.scannerCancel, { bottom: insets.bottom + 30 }]}
            >
              <Text style={styles.scannerCancelText}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {step === "manual" && (
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {permission && !permission.granted && (
              <Text
                style={[
                  styles.deniedText,
                  {
                    color: colors.destructive,
                    fontFamily: FontFamily.interMedium,
                  },
                ]}
              >
                Camera access isn't available - enter the code shown on the
                shift's QR code instead.
              </Text>
            )}
            <TextInput
              accessibilityLabel="Shift QR code"
              value={manualCode}
              onChangeText={setManualCode}
              placeholder="Enter code"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.manualInput,
                {
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            />
            <Pressable
              onPress={submitManualCode}
              disabled={!manualCode.trim()}
              style={[
                styles.submitBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: manualCode.trim() ? 1 : 0.5,
                },
              ]}
            >
              <Text style={styles.submitBtnText}>Continue</Text>
            </Pressable>
            <Pressable
              onPress={() => setStep("choose")}
              style={styles.manualLink}
            >
              <Text
                style={[
                  styles.manualLinkText,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interMedium,
                  },
                ]}
              >
                Back
              </Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  wrap: {
    maxHeight: "100%",
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: "hidden",
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
  },
  introIcon: {
    width: 64,
    height: 64,
    borderRadius: 24,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  introTitle: {
    fontSize: 24,
    fontFamily: FontFamily.interBold,
    textAlign: "center",
  },
  introHint: {
    fontSize: 15,
    fontFamily: FontFamily.interRegular,
    textAlign: "center",
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16 },
  body: { padding: 20, gap: 12 },
  choiceCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  choiceText: { flex: 1, gap: 2 },
  choiceTitle: { fontSize: 15 },
  choiceHint: { fontSize: 14, lineHeight: 21 },
  manualLink: { alignSelf: "center", marginTop: 8, padding: 12, minHeight: 48 },
  manualLinkText: { fontSize: 13 },
  scannerWrap: { flex: 1, backgroundColor: "#000" },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  scannerBox: {
    width: 240,
    height: 240,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  scannerHint: {
    position: "absolute",
    bottom: 90,
    alignSelf: "center",
    color: "#FFFFFF",
    fontSize: 13,
    paddingHorizontal: 16,
    textAlign: "center",
  },
  scannerCancel: {
    position: "absolute",
    bottom: 30,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  scannerCancelText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontFamily: FontFamily.interSemiBold,
  },
  deniedText: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  manualInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  submitBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  submitBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: FontFamily.interBold,
  },
});

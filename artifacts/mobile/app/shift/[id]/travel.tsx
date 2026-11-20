import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { FontFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";
import {
  RECEIPT_REQUIRED_CENTS,
  TRANSIT_TYPES,
  TRIP_DETAILS_MIN_CHARS,
  dollars,
  getShiftFareDraft,
  getShiftMileageEstimate,
  mileageNeedsExplanation,
  saveCarTrip,
  saveFare,
  type EvidencePhoto,
  type TransitType,
} from "@/lib/travel-api";

type Mode = "car" | "fare";

/**
 * Claim travel for one shift, with the evidence the office needs:
 * - a car trip: the distance (checked against the route from home to the
 *   participant), where you went and why if it's different, and an optional
 *   photo (odometer, parking or toll receipt);
 * - a fare: what kind, how much, and a receipt photo for anything over $10.
 * Nothing is chosen for the worker. Saved claims wait in Travel claims until
 * they're sent to the office together.
 */
export default function ShiftTravelClaimScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();

  const estimateQuery = useQuery({
    queryKey: ["worker", "travel", "estimate", id],
    queryFn: () => getShiftMileageEstimate(String(id)),
    enabled: !!id,
  });
  const fareQuery = useQuery({
    queryKey: ["worker", "travel", "fare", id],
    queryFn: () => getShiftFareDraft(String(id)),
    enabled: !!id,
  });

  const estimate = estimateQuery.data;
  const routeKm = estimate?.available && estimate.distance_km != null ? Number(estimate.distance_km) : null;

  const [mode, setMode] = useState<Mode | null>(null);
  const [km, setKm] = useState("");
  const [carDetails, setCarDetails] = useState("");
  const [carPhoto, setCarPhoto] = useState<EvidencePhoto | null>(null);
  const [fareType, setFareType] = useState<TransitType | "">("");
  const [fareAmount, setFareAmount] = useState("");
  const [fareDetails, setFareDetails] = useState("");
  const [receipt, setReceipt] = useState<EvidencePhoto | null>(null);
  const [saving, setSaving] = useState(false);

  // Start from what's already saved (or the route distance), never a guess.
  useEffect(() => {
    const draft = estimate?.draft_mileage;
    if (draft?.claimed_km != null) {
      setKm(String(draft.claimed_km));
      setCarDetails(draft.trip_details ?? "");
    } else if (routeKm != null) {
      setKm(String(routeKm));
    }
  }, [estimate?.draft_mileage?.id, routeKm]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const draft = fareQuery.data?.draft_transit;
    if (!draft) return;
    setFareType((draft.transit_type as TransitType) ?? "");
    setFareAmount((draft.amount_cents / 100).toFixed(2));
    setFareDetails(draft.trip_details ?? "");
  }, [fareQuery.data?.draft_transit?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const kmValue = Number(km);
  const kmValid = km.trim() !== "" && !Number.isNaN(kmValue) && kmValue > 0 && kmValue <= 2000;
  const needsWhy = kmValid && mileageNeedsExplanation(kmValue, routeKm);
  const carReady = kmValid && (!needsWhy || carDetails.trim().length >= TRIP_DETAILS_MIN_CHARS);
  const carAmount = kmValid && estimate ? Math.round(kmValue * estimate.rate_cents) : null;

  const amountCents = Math.round(Number(fareAmount) * 100);
  const amountValid = fareAmount.trim() !== "" && !Number.isNaN(amountCents) && amountCents > 0;
  const hasSavedReceipt = Boolean(fareQuery.data?.draft_transit?.receipt_storage_path);
  const receiptNeeded = amountValid && amountCents > RECEIPT_REQUIRED_CENTS && !receipt && !hasSavedReceipt;
  const fareReady = !!fareType && amountValid && !receiptNeeded;

  const missing = useMemo(() => {
    if (mode === "car") {
      if (!kmValid) return "Enter the distance you drove.";
      if (needsWhy && carDetails.trim().length < TRIP_DETAILS_MIN_CHARS) {
        return routeKm == null
          ? "Say where you drove: there's no route estimate to check the distance against."
          : "Say where you drove and why: the distance is different from the route.";
      }
    }
    if (mode === "fare") {
      if (!fareType) return "Choose what you caught.";
      if (!amountValid) return "Enter what the fare cost.";
      if (receiptNeeded) return "Add a photo of the receipt. It's needed for fares over $10.";
    }
    return null;
  }, [mode, kmValid, needsWhy, carDetails, routeKm, fareType, amountValid, receiptNeeded]);

  const pickPhoto = async (set: (p: EvidencePhoto) => void, from: "camera" | "library") => {
    const perm =
      from === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert("Permission needed", from === "camera" ? "Allow the camera to take a photo." : "Allow photos to choose one.");
      return;
    }
    const result =
      from === "camera"
        ? await ImagePicker.launchCameraAsync({ quality: 0.6 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ["images"] });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    set({ uri: asset.uri, name: asset.fileName ?? `evidence-${Date.now()}.jpg`, type: asset.mimeType ?? "image/jpeg" });
  };

  const save = async () => {
    if (saving || missing || !mode) return;
    setSaving(true);
    try {
      if (mode === "car") {
        await saveCarTrip(String(id), { claimedKm: kmValue, calculatedKm: routeKm, tripDetails: carDetails, photo: carPhoto });
      } else if (fareType) {
        await saveFare(String(id), { amountCents, transitType: fareType, tripDetails: fareDetails, receipt });
      }
      await queryClient.invalidateQueries({ queryKey: ["worker", "travel"] });
      showAlert("Claim saved", "It's in Travel claims, ready to send to the office with your others.", [
        { text: "Travel claims", onPress: () => router.replace("/worker/travel" as never) },
        { text: "Done", style: "cancel", onPress: () => router.back() },
      ]);
    } catch (err) {
      showAlert("Couldn't save the claim", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const text = { color: colors.foreground, fontFamily: FontFamily.interRegular };
  const muted = { color: colors.mutedForeground, fontFamily: FontFamily.interRegular };
  const label = { color: colors.foreground, fontFamily: FontFamily.interSemiBold };
  const input = [styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card, fontFamily: FontFamily.interRegular }];

  const choice = (active: boolean) => [
    styles.choice,
    { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.activeBg : colors.card },
  ];

  const PhotoField = ({ photo, onPick, onClear, title }: { photo: EvidencePhoto | null; onPick: (from: "camera" | "library") => void; onClear: () => void; title: string }) =>
    photo ? (
      <View style={styles.photoRow}>
        <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" />
        <Pressable accessibilityRole="button" onPress={onClear} style={styles.linkBtn}>
          <Text style={{ color: colors.primary, fontFamily: FontFamily.interSemiBold }}>Remove photo</Text>
        </Pressable>
      </View>
    ) : (
      <View style={styles.photoButtons}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${title}: take a photo`} onPress={() => onPick("camera")} style={[styles.secondary, { borderColor: colors.border }]}>
          <Feather name="camera" size={16} color={colors.foreground} />
          <Text style={label}>Take a photo</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${title}: choose a photo`} onPress={() => onPick("library")} style={[styles.secondary, { borderColor: colors.border }]}>
          <Feather name="image" size={16} color={colors.foreground} />
          <Text style={label}>Choose one</Text>
        </Pressable>
      </View>
    );

  return (
    <WorkerStackScreen headerTitle="" pageTitle="Claim travel" subtitle="For this shift, with what the office needs to pay it." minimalHeader showBack cardsOnBackground>
      {estimateQuery.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <KeyboardAwareScrollViewCompat contentContainerStyle={styles.body} bottomOffset={24} keyboardShouldPersistTaps="handled">
          <Text style={[styles.question, label]}>How did you travel?</Text>
          <View style={styles.choices} accessibilityRole="radiogroup">
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: mode === "car" }} onPress={() => setMode("car")} style={choice(mode === "car")}>
              <Feather name="truck" size={18} color={colors.primary} />
              <Text style={label}>I drove my car</Text>
            </Pressable>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: mode === "fare" }} onPress={() => setMode("fare")} style={choice(mode === "fare")}>
              <Feather name="credit-card" size={18} color={colors.primary} />
              <Text style={label}>I paid a fare</Text>
            </Pressable>
          </View>

          {mode === "car" ? (
            <View style={styles.section}>
              {!estimate?.home_address_set ? (
                <Text style={muted}>Add your home address in your profile so the route can be worked out. You can still claim and say where you drove.</Text>
              ) : routeKm != null ? (
                <Text style={muted}>
                  Route from home to {estimate?.destination_address ?? "the participant"}: {routeKm} km. {estimate?.rate_display}.
                </Text>
              ) : (
                <Text style={muted}>The route couldn't be worked out, so say where you drove.</Text>
              )}

              <Text style={label}>Kilometres driven</Text>
              <TextInput value={km} onChangeText={setKm} keyboardType="decimal-pad" placeholder="For example 12.5" placeholderTextColor={colors.mutedForeground} style={input} accessibilityLabel="Kilometres driven" />
              {carAmount != null ? <Text style={muted}>That's {dollars(carAmount)} at the current rate.</Text> : null}

              <Text style={label}>{needsWhy ? "Where did you drive, and why?" : "Where did you drive? (optional)"}</Text>
              <TextInput
                value={carDetails}
                onChangeText={setCarDetails}
                multiline
                placeholder="For example: took Liam to the library, then home via the pharmacy"
                placeholderTextColor={colors.mutedForeground}
                style={[input, styles.multiline]}
                accessibilityLabel="Where did you drive, and why"
              />
              {needsWhy ? <Text style={muted}>Needed because the distance is different from the route.</Text> : null}

              <Text style={label}>Photo (optional)</Text>
              <Text style={muted}>Odometer, parking or toll receipt.</Text>
              <PhotoField photo={carPhoto} title="Car trip photo" onPick={(from) => void pickPhoto(setCarPhoto, from)} onClear={() => setCarPhoto(null)} />
            </View>
          ) : null}

          {mode === "fare" ? (
            <View style={styles.section}>
              <Text style={label}>What did you catch?</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {TRANSIT_TYPES.map((t) => (
                  <Pressable key={t.value} accessibilityRole="radio" accessibilityState={{ selected: fareType === t.value }} onPress={() => setFareType(t.value)} style={[styles.chip, { borderColor: fareType === t.value ? colors.primary : colors.border, backgroundColor: fareType === t.value ? colors.activeBg : colors.card }]}>
                    <Text style={label}>{t.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={label}>Fare</Text>
              <TextInput value={fareAmount} onChangeText={setFareAmount} keyboardType="decimal-pad" placeholder="$0.00" placeholderTextColor={colors.mutedForeground} style={input} accessibilityLabel="Fare in dollars" />

              <Text style={label}>{amountValid && amountCents > RECEIPT_REQUIRED_CENTS ? "Receipt photo" : "Receipt photo (needed over $10)"}</Text>
              {hasSavedReceipt && !receipt ? <Text style={muted}>A receipt is already attached. Add a new one only to replace it.</Text> : null}
              <PhotoField photo={receipt} title="Receipt" onPick={(from) => void pickPhoto(setReceipt, from)} onClear={() => setReceipt(null)} />

              <Text style={label}>Where did you travel? (optional)</Text>
              <TextInput value={fareDetails} onChangeText={setFareDetails} multiline placeholder="For example: train from Mawson Lakes to the city with Liam" placeholderTextColor={colors.mutedForeground} style={[input, styles.multiline]} accessibilityLabel="Where did you travel" />
            </View>
          ) : null}

          {mode ? (
            <View style={styles.footer}>
              {missing ? <Text accessibilityRole="alert" style={[muted, { color: colors.destructive }]}>{missing}</Text> : null}
              <Pressable accessibilityRole="button" onPress={() => void save()} disabled={saving || !!missing || !(mode === "car" ? carReady : fareReady)} style={[styles.primary, { backgroundColor: colors.primary, opacity: saving || missing ? 0.5 : 1 }]}>
                {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontFamily: FontFamily.interSemiBold, fontSize: 16 }}>Save claim</Text>}
              </Pressable>
              <Text style={[muted, { textAlign: "center" }]}>Saved claims wait in Travel claims until you send them to the office.</Text>
            </View>
          ) : null}
          <Text style={[text, { height: 1 }]} />
        </KeyboardAwareScrollViewCompat>
      )}
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  center: { padding: 32, alignItems: "center" },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  question: { fontSize: 16 },
  choices: { flexDirection: "row", gap: 10 },
  choice: { flex: 1, minHeight: 56, borderWidth: 1, borderRadius: 14, padding: 12, gap: 6, justifyContent: "center" },
  section: { gap: 8, marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, minHeight: 48 },
  multiline: { minHeight: 84, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
  photoButtons: { flexDirection: "row", gap: 8 },
  secondary: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 12, minHeight: 48 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  photo: { width: 72, height: 72, borderRadius: 10 },
  linkBtn: { minHeight: 44, justifyContent: "center" },
  footer: { gap: 10, marginTop: 8 },
  primary: { minHeight: 52, borderRadius: 999, alignItems: "center", justifyContent: "center" },
});

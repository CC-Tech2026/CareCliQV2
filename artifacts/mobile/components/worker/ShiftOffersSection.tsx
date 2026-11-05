import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { ShiftOfferCard } from "@/components/worker/ShiftOfferCard";
import { FontFamily } from "@/constants/typography";
import { useOffline } from "@/context/OfflineContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";
import { acceptShiftOffer, declineShiftOffer, listShiftOffers } from "@/lib/worker-api";

/** Shifts the coordinator has offered this worker, answered right from the
 * schedule. Until now an offer could only be reached from the push that
 * announced it; a missed notification meant a missed shift. */
export function ShiftOffersSection() {
  const colors = useColors();
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isOnline } = useOffline();
  const offers = useQuery({
    queryKey: ["worker", "shift-offers"],
    queryFn: listShiftOffers,
    enabled: isOnline,
    staleTime: 30_000,
  });

  if (!offers.data?.length) return null;

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          {t("offers.title")}
        </Text>
        <View style={[styles.count, { backgroundColor: colors.primary }]}>
          <Text style={[styles.countText, { color: colors.primaryForeground }]}>{offers.data.length}</Text>
        </View>
      </View>
      {offers.data.map((offer) => (
        <ShiftOfferCard
          key={offer.offer_id}
          inList
          offer={offer}
          onAccept={async () => {
            try {
              await acceptShiftOffer(offer.shift_id);
              await queryClient.invalidateQueries({ queryKey: ["worker"] });
              router.push(`/shift/${offer.shift_id}` as never);
            } catch (err) {
              showAlert(t("offers.acceptFailed"), err instanceof Error ? err.message : t("shifts.tryAgain"));
            }
          }}
          onDecline={async (reason) => {
            try {
              await declineShiftOffer(offer.shift_id, reason);
              await queryClient.invalidateQueries({ queryKey: ["worker", "shift-offers"] });
            } catch (err) {
              showAlert(t("offers.declineFailed"), err instanceof Error ? err.message : t("shifts.tryAgain"));
            }
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginBottom: 6 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontFamily: FontFamily.interBold, fontSize: 17 },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  countText: { fontFamily: FontFamily.interBold, fontSize: 12 },
});

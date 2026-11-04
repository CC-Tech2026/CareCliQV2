import React from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ShiftReviewItem } from "@/components/worker/review/ShiftReviewItem";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { useShiftReviews } from "@/hooks/worker/useShiftReviews";

/** Every finished shift, verified ones included. The compliance overview
 * shows only shifts still with the office; this is where the rest live. */
export default function PastShiftsScreen() {
  const colors = useColors();
  const t = useT();
  const { data, isLoading, isRefetching, refetch } = useShiftReviews(true);
  const shifts = data?.shifts ?? [];

  return (
    <WorkerStackScreen headerTitle="" pageTitle={t("review.history.title")} subtitle={t("review.history.subtitle")} minimalHeader showBack cardsOnBackground>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={shifts}
          keyExtractor={(item) => item.shift_id}
          renderItem={({ item }) => <ShiftReviewItem item={item} />}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("review.history.empty")}
            </Text>
          }
        />
      )}
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  empty: { fontSize: 13, lineHeight: 19, textAlign: "center", paddingTop: 24 },
});

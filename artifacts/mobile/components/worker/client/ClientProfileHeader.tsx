import { FontFamily } from "@/constants/typography";
import React, { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import { clientInitials, safeClientDate } from "@/lib/client-utils";
import type { WorkerClient } from "@/lib/worker-api";
import { useColors } from "@/hooks/useColors";

type Props = {
  client: WorkerClient;
  compact?: boolean;
  /**
   * Optional override when the screen already has the participant photo URL.
   * If omitted, the component checks common image fields on `client`.
   */
  photoUri?: string | null;
};

type PhotoFields = {
  profile_photo_url?: unknown;
  profile_image_url?: unknown;
  profile_picture_url?: unknown;
  photo_url?: unknown;
  image_url?: unknown;
  avatar_url?: unknown;
  profile_photo?: unknown;
  profile_image?: unknown;
  profile_picture?: unknown;
  photo?: unknown;
  avatar?: unknown;
  profile?: unknown;
};

/** Only pass a usable URI to React Native's Image. */
function imageUri(value: unknown): string | null {
  if (typeof value === "string") {
    const uri = value.trim();
    return /^(https?:\/\/|file:\/\/|data:image\/)/i.test(uri) ? uri : null;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const data = value as Record<string, unknown>;
    return (
      imageUri(data.url) ??
      imageUri(data.uri) ??
      imageUri(data.signed_url) ??
      imageUri(data.signedUrl) ??
      imageUri(data.download_url)
    );
  }

  return null;
}

/**
 * Allow the existing screen to keep passing `client` without changing its API.
 * The explicit `photoUri` prop is the reliable integration point if the API uses
 * a differently named field.
 */
function resolveClientPhoto(client: WorkerClient, override?: string | null) {
  const explicitUri = imageUri(override);
  if (explicitUri) return explicitUri;

  const media = client as unknown as PhotoFields;
  const profile =
    media.profile && typeof media.profile === "object"
      ? (media.profile as PhotoFields)
      : null;

  const candidates: unknown[] = [
    media.profile_photo_url,
    media.profile_image_url,
    media.profile_picture_url,
    media.photo_url,
    media.image_url,
    media.avatar_url,
    media.profile_photo,
    media.profile_image,
    media.profile_picture,
    media.photo,
    media.avatar,
    profile?.profile_photo_url,
    profile?.profile_image_url,
    profile?.profile_picture_url,
    profile?.photo_url,
    profile?.image_url,
    profile?.avatar_url,
    profile?.profile_photo,
    profile?.profile_image,
    profile?.profile_picture,
    profile?.photo,
    profile?.avatar,
  ];

  for (const candidate of candidates) {
    const uri = imageUri(candidate);
    if (uri) return uri;
  }

  return null;
}

/** Plan states are stored as lowercase codes ("active", "under_review"). */
const PLAN_STATUS_LABELS: Record<string, string> = {
  active: "Active NDIS plan",
  expired: "NDIS plan expired",
  inactive: "Inactive",
  pending: "Plan pending",
  under_review: "Plan under review",
  suspended: "Suspended",
  cancelled: "Plan cancelled",
};

export function planStatusLabel(state: string): string {
  const key = state.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (PLAN_STATUS_LABELS[key]) return PLAN_STATUS_LABELS[key];
  const words = state.trim().replace(/[_-]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "plan-managed" -> "Plan-managed", "NDIA-managed" stays as written. */
function managementLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function ClientProfileHeader({
  client,
  compact = false,
  photoUri,
}: Props) {
  const colors = useColors();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const resolvedPhotoUri = resolveClientPhoto(client, photoUri);
  const showPhoto = Boolean(resolvedPhotoUri && failedUri !== resolvedPhotoUri);

  const planState = client.plan_status?.trim() ?? "";
  const isInactive =
    /expired|inactive|cancelled|canceled|suspended|rejected/i.test(planState);

  if (compact) {
    return (
      <View style={{ gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            client.full_name +
            ", " +
            (detailsOpen ? "hide" : "show") +
            " profile details"
          }
          accessibilityState={{ expanded: detailsOpen }}
          onPress={() => setDetailsOpen((v) => !v)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 6,
            opacity: pressed ? 0.65 : 1,
          })}
        >
          <View
            style={[
              styles.compactAvatar,
              { backgroundColor: colors.secondary },
            ]}
          >
            {showPhoto ? (
              <Image
                source={{ uri: resolvedPhotoUri! }}
                style={styles.photo}
                onError={() => setFailedUri(resolvedPhotoUri)}
                accessibilityLabel="Participant photo"
              />
            ) : (
              <Text
                style={{
                  color: colors.secondaryForeground,
                  fontFamily: FontFamily.interBold,
                  fontSize: 18,
                }}
              >
                {clientInitials(client.full_name)}
              </Text>
            )}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              accessibilityRole="header"
              style={{
                color: colors.foreground,
                fontFamily: FontFamily.interBold,
                fontSize: 19,
                lineHeight: 25,
              }}
            >
              {client.full_name}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
                fontSize: 12,
                lineHeight: 18,
              }}
            >
              {planState ? planStatusLabel(planState) : "Participant"}
            </Text>
          </View>
          <Text
            style={{
              color: colors.primary,
              fontFamily: FontFamily.interSemiBold,
              fontSize: 13,
              lineHeight: 20,
              textDecorationLine: "underline",
            }}
          >
            {detailsOpen ? "Close details" : "Details"}
          </Text>
        </Pressable>
        {detailsOpen ? (
          <View
            style={[
              styles.compactDetails,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <PlanFact
              label="NDIS number"
              value={String(client.ndis_number || "Not recorded")}
            />
            <PlanFact
              label="Date of birth"
              value={safeClientDate(client.date_of_birth)}
            />
            {client.plan_start_date ? (
              <PlanFact
                label="Plan start"
                value={safeClientDate(client.plan_start_date)}
              />
            ) : null}
            {client.plan_management_type ? (
              <PlanFact
                label="Management"
                value={managementLabel(client.plan_management_type)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.card,
        compact && styles.compactCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {/* Identity stays with the photo, including when this card is reused. */}
      <View style={[styles.profileRow, compact && styles.compactProfileRow]}>
        <View
          style={[
            styles.photoFrame,
            compact && styles.compactPhotoFrame,
            { backgroundColor: colors.activeBg },
          ]}
        >
          {showPhoto ? (
            <Image
              key={resolvedPhotoUri}
              source={{ uri: resolvedPhotoUri! }}
              style={styles.photo}
              resizeMode="cover"
              accessibilityLabel="Participant profile photo"
              onError={() => setFailedUri(resolvedPhotoUri)}
            />
          ) : (
            <Text
              style={[
                styles.initials,
                compact && styles.compactInitials,
                { color: colors.primary, fontFamily: FontFamily.interBold },
              ]}
              accessibilityLabel="Participant photo not available"
            >
              {clientInitials(client.full_name)}
            </Text>
          )}
        </View>

        <View style={styles.profileFacts}>
          <Text style={[styles.profileEyebrow, { color: colors.primary }]}>
            PARTICIPANT
          </Text>
          <Text
            accessibilityRole="header"
            style={[styles.profileName, { color: colors.foreground }]}
          >
            {client.full_name}
          </Text>
          <View style={styles.factLine}>
            <Text
              style={[
                styles.factLabel,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              NDIS number
            </Text>
            <Text
              selectable
              style={[
                styles.factValue,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {client.ndis_number != null && String(client.ndis_number).trim()
                ? String(client.ndis_number).trim()
                : "Not recorded"}
            </Text>
          </View>
          <View style={styles.factLine}>
            <Text
              style={[
                styles.factLabel,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              Date of birth
            </Text>
            <Text
              style={[
                styles.factValue,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {client.date_of_birth
                ? safeClientDate(client.date_of_birth)
                : "Not recorded"}
            </Text>
          </View>
        </View>
      </View>

      {planState ? (
        <View style={[styles.statusRow, { borderTopColor: colors.border }]}>
          <View
            style={[
              styles.statusChip,
              { backgroundColor: isInactive ? colors.dangerBg : colors.soft },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: isInactive
                    ? colors.dangerText
                    : colors.primary,
                },
              ]}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.statusText,
                {
                  color: isInactive ? colors.dangerText : colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {planStatusLabel(planState)}
            </Text>
          </View>
        </View>
      ) : null}

      {!compact && (client.plan_start_date || client.plan_management_type) && (
        <View style={[styles.planDetails, { borderTopColor: colors.border }]}>
          {client.plan_start_date && (
            <PlanFact
              label="Plan start"
              value={safeClientDate(client.plan_start_date)}
            />
          )}
          {client.plan_management_type && (
            <PlanFact label="Management" value={managementLabel(client.plan_management_type)} />
          )}
        </View>
      )}
    </View>
  );
}

function PlanFact({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.planFact}>
      <Text
        style={[
          styles.planFactLabel,
          { color: colors.mutedForeground, fontFamily: FontFamily.interMedium },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.planFactValue,
          { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  compactAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  compactDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
  },
  compactCard: { borderRadius: 24 },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  compactProfileRow: { paddingVertical: 20, paddingHorizontal: 20, gap: 18 },
  photoFrame: {
    width: 88,
    height: 88,
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  compactPhotoFrame: { width: 80, height: 96, borderRadius: 24 },
  photo: { width: "100%", height: "100%" },
  initials: { fontSize: 26 },
  compactInitials: { fontSize: 20 },
  profileFacts: { flex: 1, minWidth: 0, gap: 10 },
  profileEyebrow: {
    fontFamily: FontFamily.interBold,
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 1.5,
  },
  profileName: {
    fontFamily: FontFamily.interBold,
    fontSize: 23,
    lineHeight: 29,
    letterSpacing: -0.6,
  },
  factLine: { gap: 3 },
  factLabel: { fontSize: 11, lineHeight: 15 },
  factValue: { fontSize: 14, lineHeight: 19 },
  statusRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  statusChip: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, lineHeight: 16 },
  planDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 20,
    rowGap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  planFact: { minWidth: "26%", flexGrow: 1, gap: 4 },
  planFactLabel: { fontSize: 11, lineHeight: 15 },
  planFactValue: { fontSize: 13, lineHeight: 18 },
});

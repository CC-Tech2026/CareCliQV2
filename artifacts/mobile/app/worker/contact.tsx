import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsSection } from "@/components/worker/settings/settings-ui";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { getSupportConfig, type SupportConfig } from "@/lib/help-api";

function isWithinBusinessHours(config: SupportConfig | null): boolean {
  if (!config?.business_hours_json) return true;
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-AU", {
      timeZone: config.business_hours_json.timezone || "Australia/Adelaide",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
    const isWeekday = !["Sat", "Sun"].includes(weekday);
    return isWeekday && hour >= 9 && hour < 17;
  } catch {
    return true;
  }
}

export default function WorkerContactScreen() {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getSupportConfig()
      .catch(() => null)
      .then((cfg) => {
        if (!active) return;
        setConfig(cfg);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const inHours = isWithinBusinessHours(config);
  const supportPhone = config?.support_phone?.trim() || "";
  const supportEmail = config?.support_email?.trim() || "support@carecliq.com.au";

  return (
    <SettingsSubScreen showBottomNav={false} title={t("settings.row.contact")}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsSection
          title={t("settings.row.contact")}
          description={t("help.chat.hoursDefault")}
          icon="mail"
        >
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.wrap}>
              {!inHours ? (
                <View style={[styles.notice, { backgroundColor: colors.statusProgressBg }]}>
                  <Text style={{ color: colors.warning, fontFamily: "Inter_500Medium", fontSize: 13, lineHeight: 18 }}>
                    {config?.outside_hours_message || t("help.chat.outsideHours")}
                  </Text>
                </View>
              ) : null}

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  {t("help.chat.fallbackTitle")}
                </Text>

                {supportPhone ? (
                  <Pressable
                    onPress={() => void Linking.openURL(`tel:${supportPhone.replace(/\s/g, "")}`)}
                    style={[styles.contactBtn, { borderColor: colors.border }]}
                  >
                    <Feather name="phone" size={16} color={colors.primary} />
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
                      {t("help.chat.callNow", { phone: supportPhone })}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
                  style={[styles.contactBtn, { borderColor: colors.border }]}
                >
                  <Feather name="mail" size={16} color={colors.primary} />
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
                    {supportEmail}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </SettingsSection>
      </ScrollView>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  loading: { paddingVertical: 40, alignItems: "center" },
  wrap: { gap: 12 },
  notice: { borderRadius: 14, padding: 14 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  title: { fontSize: 17, lineHeight: 22 },
  contactBtn: {
    marginTop: 4,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});

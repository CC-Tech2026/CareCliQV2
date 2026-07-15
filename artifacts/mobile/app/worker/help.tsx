import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsSection } from "@/components/worker/settings/settings-ui";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { WORKER_FAQ_FALLBACK } from "@/content/worker-faq-fallback";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  getKnownIssues,
  searchFaq,
  type FaqArticle,
  type KnownIssue,
} from "@/lib/help-api";

type Tab = "faq" | "issues";

export default function WorkerHelpScreen() {
  const t = useT();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();

  const initialTab: Tab = params.tab === "issues" ? "issues" : "faq";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [faq, setFaq] = useState<FaqArticle[]>([]);
  const [issues, setIssues] = useState<KnownIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  useEffect(() => {
    if (params.tab === "issues" || params.tab === "faq") {
      setTab(params.tab);
    }
  }, [params.tab]);

  useEffect(() => {
    let active = true;
    Promise.all([
      searchFaq().catch(() => ({ articles: WORKER_FAQ_FALLBACK })),
      getKnownIssues().catch(() => ({ issues: [] as KnownIssue[] })),
    ]).then(([faqRes, issuesRes]) => {
      if (!active) return;
      setFaq(faqRes.articles?.length ? faqRes.articles : WORKER_FAQ_FALLBACK);
      setIssues(issuesRes.issues ?? []);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const filteredFaq = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return faq;
    return faq.filter((article) => {
      const hay = `${article.title} ${article.body_markdown} ${(article.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(term);
    });
  }, [faq, query]);

  const tabs: { id: Tab; labelKey: "help.tab.faq" | "help.tab.issues" }[] = [
    { id: "faq", labelKey: "help.tab.faq" },
    { id: "issues", labelKey: "help.tab.issues" },
  ];

  return (
    <SettingsSubScreen showBottomNav={false} title={t("help.title")}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <SettingsSection title={t("help.title")} description={t("help.subtitle")} icon="help-circle">
          <View style={styles.tabs}>
            {tabs.map((item) => {
              const active = tab === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setTab(item.id)}
                  style={[
                    styles.tab,
                    {
                      backgroundColor: active ? colors.primary : colors.soft,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? "#FFFFFF" : colors.mutedForeground,
                      fontFamily: "Inter_700Bold",
                      fontSize: 12,
                    }}
                  >
                    {t(item.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}

          {!loading && tab === "faq" ? (
            <View style={styles.faqWrap}>
              <View
                style={[
                  styles.searchRow,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
              >
                <Feather name="search" size={16} color={colors.mutedForeground} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t("help.faq.search")}
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.searchInput, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
                />
              </View>

              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {filteredFaq.length === 0 ? (
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                    {t("help.faq.empty")}
                  </Text>
                ) : (
                  filteredFaq.map((article, index) => {
                    const expanded = expandedSlug === article.slug;
                    return (
                      <View
                        key={article.slug}
                        style={[
                          index < filteredFaq.length - 1 && {
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: colors.soft,
                          },
                        ]}
                      >
                        <Pressable
                          onPress={() =>
                            setExpandedSlug((prev) => (prev === article.slug ? null : article.slug))
                          }
                          style={[styles.faqItem, expanded && { backgroundColor: colors.activeBg }]}
                        >
                          <Text
                            style={{
                              flex: 1,
                              color: expanded ? colors.primary : colors.foreground,
                              fontFamily: expanded ? "Inter_700Bold" : "Inter_500Medium",
                              fontSize: 14,
                            }}
                          >
                            {article.title}
                          </Text>
                          <Feather
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={18}
                            color={expanded ? colors.primary : colors.mutedForeground}
                          />
                        </Pressable>
                        {expanded ? (
                          <View style={styles.faqBody}>
                            <Text
                              style={[
                                styles.articleBody,
                                { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                              ]}
                            >
                              {article.body_markdown}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          ) : null}

          {!loading && tab === "issues" ? (
            <View style={styles.issuesWrap}>
              {issues.length === 0 ? (
                <View
                  style={[
                    styles.card,
                    styles.emptyIssues,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                    {t("help.issues.empty")}
                  </Text>
                </View>
              ) : (
                issues.map((issue) => (
                  <View
                    key={issue.id}
                    style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <Text style={[styles.articleTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                      {issue.title}
                    </Text>
                    <Text style={[styles.articleBody, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                      {issue.description}
                    </Text>
                    {issue.workaround ? (
                      <Text
                        style={{
                          color: colors.foreground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 13,
                          marginTop: 8,
                        }}
                      >
                        <Text style={{ fontFamily: "Inter_700Bold" }}>{t("help.issues.workaround")} </Text>
                        {issue.workaround}
                      </Text>
                    ) : null}
                  </View>
                ))
              )}
            </View>
          ) : null}
        </SettingsSection>
      </ScrollView>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tab: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  loading: { paddingVertical: 40, alignItems: "center" },
  faqWrap: { gap: 12 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 10 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 6,
    gap: 0,
  },
  faqItem: {
    paddingHorizontal: 10,
    paddingVertical: 14,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  faqBody: {
    paddingHorizontal: 10,
    paddingBottom: 14,
  },
  articleTitle: { fontSize: 17, lineHeight: 22 },
  articleBody: { fontSize: 14, lineHeight: 21 },
  issuesWrap: { gap: 12 },
  emptyIssues: { alignItems: "center", paddingVertical: 28, paddingHorizontal: 14 },
});

import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Confetti } from "@/components/worker/birthday/Confetti";
import {
  Burst,
  Bunting,
  GlowRing,
  PARTY,
  Sparkle,
} from "@/components/worker/birthday/PartyDecor";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import * as Haptics from "@/lib/haptics";
import { useBirthday } from "@/hooks/worker/useBirthday";

/** A deeper CareCliQ purple, so the gold, pink and white really show. */
const PARTY_BG = "#2E2566";
const CONFETTI = [PARTY.gold, PARTY.pink, PARTY.white, PARTY.lilac, PARTY.mint];
const CAKE = 150;

/**
 * The birthday welcome: shown once, the first time a worker opens the app on
 * their birthday. Bunting, balloons, confetti and a glowing cake, then home.
 */
export default function BirthdayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { firstName, markSeen } = useBirthday();
  const [reduce, setReduce] = useState(false);
  const pop = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void markSeen();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void AccessibilityInfo.isReduceMotionEnabled().then((isReduced) => {
      setReduce(isReduced);
      if (isReduced) {
        pop.setValue(1);
        rise.setValue(1);
        return;
      }
      Animated.sequence([
        Animated.spring(pop, {
          toValue: 1,
          friction: 4,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.timing(rise, {
          toValue: 1,
          duration: 480,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [markSeen, pop, rise]);

  const done = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)" as never);
  };

  const cakeStyle = {
    transform: [
      { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) },
      {
        rotate: pop.interpolate({
          inputRange: [0, 1],
          outputRange: ["-12deg", "0deg"],
        }),
      },
    ],
  };
  const textStyle = {
    opacity: rise,
    transform: [
      {
        translateY: rise.interpolate({
          inputRange: [0, 1],
          outputRange: [20, 0],
        }),
      },
    ],
  };

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: insets.bottom + 20 },
      ]}
    >
      <Bunting top={insets.top + 6} />
      <Confetti count={60} colours={CONFETTI} />

      <View style={styles.middle}>
        <View style={styles.cakeWrap}>
          <GlowRing size={CAKE} reduce={reduce} />
          <Burst size={CAKE} colours={CONFETTI} reduce={reduce} />
          <Animated.View style={[styles.cake, cakeStyle]}>
            <MaterialCommunityIcons
              name="cake-variant"
              size={78}
              color={PARTY.pink}
            />
          </Animated.View>
          <Sparkle left={-22} top={8} size={22} reduce={reduce} />
          <Sparkle
            left={CAKE + 2}
            top={-4}
            size={16}
            delay={400}
            colour={PARTY.white}
            reduce={reduce}
          />
          <Sparkle
            left={CAKE - 8}
            top={CAKE - 26}
            size={20}
            delay={800}
            reduce={reduce}
          />
          <Sparkle
            left={-10}
            top={CAKE - 10}
            size={14}
            delay={1200}
            colour={PARTY.lilac}
            reduce={reduce}
          />
        </View>

        <Animated.View style={[styles.copy, textStyle]}>
          <Text accessibilityRole="header" style={styles.titleWrap}>
            <Text style={[styles.title, { fontFamily: FontFamily.display }]}>
              {firstName ? t("birthday.heading") : t("birthday.title")}
            </Text>
            {firstName ? (
              <Text
                style={[styles.name, { fontFamily: FontFamily.display }]}
              >{`\n${firstName}!`}</Text>
            ) : null}
          </Text>
          <Text style={[styles.body, { fontFamily: FontFamily.interRegular }]}>
            {t("birthday.body")}
          </Text>
          <View style={styles.signoff}>
            <View style={styles.signoffRule} />
            <Text
              style={[
                styles.signoffLead,
                { fontFamily: FontFamily.interRegular },
              ]}
            >
              {t("birthday.signoffLead")}
            </Text>
            <View style={styles.signoffTeam}>
              <Text
                style={[
                  styles.signoffName,
                  { fontFamily: FontFamily.interSemiBold },
                ]}
              >
                {t("birthday.signoffTeam")}
              </Text>
            </View>
          </View>
        </Animated.View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={done}
        style={({ pressed }) => [styles.button, { opacity: pressed ? 0.9 : 1 }]}
      >
        <MaterialCommunityIcons
          name="party-popper"
          size={22}
          color={PARTY_BG}
        />
        <Text
          style={[styles.buttonText, { fontFamily: FontFamily.interSemiBold }]}
        >
          {t("birthday.continue")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PARTY_BG,
    paddingHorizontal: 24,
    alignItems: "center",
    overflow: "hidden",
  },
  middle: {
    zIndex: 2,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 36,
    width: "100%",
    maxWidth: 420,
    paddingTop: 60,
  },
  cakeWrap: {
    width: CAKE,
    height: CAKE,
    alignItems: "center",
    justifyContent: "center",
  },
  cake: {
    width: CAKE,
    height: CAKE,
    borderRadius: CAKE / 2,
    backgroundColor: "#FFFFFF",
    borderWidth: 6,
    borderColor: PARTY.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { alignItems: "center", gap: 16 },
  titleWrap: { textAlign: "center" },
  title: {
    color: "#FFFFFF",
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.3,
  },
  name: {
    color: PARTY.gold,
    fontSize: 46,
    lineHeight: 54,
    letterSpacing: -0.6,
  },
  body: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 17,
    lineHeight: 25,
    textAlign: "center",
    maxWidth: 340,
  },
  signoff: { alignItems: "center", gap: 6, marginTop: 4 },
  signoffRule: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: PARTY.gold,
    marginBottom: 6,
  },
  signoffLead: { color: "rgba(255,255,255,0.7)", fontSize: 15 },
  signoffTeam: { flexDirection: "row", alignItems: "center" },
  signoffName: { color: "#FFFFFF", fontSize: 17 },
  button: {
    zIndex: 2,
    flexDirection: "row",
    gap: 10,
    alignSelf: "stretch",
    maxWidth: 420,
    width: "100%",
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: PARTY_BG, fontSize: 17 },
});

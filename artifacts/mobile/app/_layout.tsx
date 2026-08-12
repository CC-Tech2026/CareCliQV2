import {
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppSplash } from "@/components/auth/AppSplash";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { OfflineProvider } from "@/context/OfflineContext";
import { PreferencesProvider } from "@/context/PreferencesContext";
import { ToastProvider } from "@/context/ToastContext";
import { useExpoPushRegistration, usePushNotificationNavigation } from "@/hooks/useExpoPush";
import { readMobileAuthToken } from "@/lib/session";
import { getMobileApiBaseUrl } from "@/lib/api-base-url";

const apiBase = getMobileApiBaseUrl();
if (apiBase) {
  setBaseUrl(apiBase);
}

setAuthTokenGetter(readMobileAuthToken);

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
    mutations: {
      // Avoid uncaught mutation rejections bubbling as redbox overlays.
      throwOnError: false,
    },
  },
});

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth();
  useExpoPushRegistration(isAuthenticated);
  usePushNotificationNavigation(isAuthenticated, isLoading);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const authRoute = segments[0];
    const onPreAuthScreen =
      authRoute === "splash" ||
      authRoute === "onboarding" ||
      authRoute === "login" ||
      authRoute === "forgot-password" ||
      authRoute === "signup";

    if (!isAuthenticated && !onPreAuthScreen) {
      router.replace("/splash" as never);
    } else if (isAuthenticated && onPreAuthScreen) {
      router.replace("/(tabs)" as never);
    }
  }, [isAuthenticated, isLoading, segments, router]);

  return (
    <Stack>
      <Stack.Screen name="splash" options={{ headerShown: false, animation: "fade" }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, animation: "fade" }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="shift/[id]/index"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="shift/[id]/briefing"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="shift/[id]/message-office"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="client/[id]"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="worker/notifications"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="worker/security"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="worker/sessions"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="worker/privacy"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="worker/help"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="worker/credentials/add"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="session/[id]"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="participant/[id]"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="worker/availability"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="worker/profile-photo"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="incidents/index"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="incidents/new"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="credentials"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="toolkit"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="training"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="accessibility"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="incidents/[id]"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="incidents/participant/[id]"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
  });
  const splashStartedAt = React.useRef(Date.now());
  const [showSplash, setShowSplash] = React.useState(true);

  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    void SplashScreen.hideAsync();

    // Hold only for the mark motion (350ms), never pad artificially past readiness.
    const elapsed = Date.now() - splashStartedAt.current;
    const remaining = Math.max(0, 350 - elapsed);
    const timer = setTimeout(() => setShowSplash(false), remaining);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  if ((!fontsLoaded && !fontError) || showSplash) {
    return <AppSplash />;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <PreferencesProvider>
            <ToastProvider>
              <AuthProvider>
                <OfflineProvider>
                  <GestureHandlerRootView style={{ flex: 1 }}>
                    <KeyboardProvider>
                      <RootLayoutNav />
                    </KeyboardProvider>
                  </GestureHandlerRootView>
                </OfflineProvider>
              </AuthProvider>
            </ToastProvider>
          </PreferencesProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

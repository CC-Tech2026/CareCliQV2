import type { ComponentProps } from "react";
import { KeyboardAvoidingView as NativeKeyboardAvoidingView, Platform } from "react-native";
import { KeyboardAvoidingView as ControllerKeyboardAvoidingView } from "react-native-keyboard-controller";

type Props = Omit<ComponentProps<typeof NativeKeyboardAvoidingView>, "behavior" | "contentContainerStyle"> & {
  behavior?: "padding" | "height";
};

/**
 * Keeps what's being typed above the keyboard on both platforms.
 *
 * React Native's own KeyboardAvoidingView relies on Android resizing the
 * window for the keyboard, and with edge-to-edge (Expo SDK 54) Android no
 * longer does that, so fields at the bottom were hidden behind the keyboard.
 * react-native-keyboard-controller's version measures the keyboard itself
 * and works on both. "padding" is the right behaviour everywhere.
 */
export function KeyboardAvoidingViewCompat({ behavior = "padding", children, ...props }: Props) {
  if (Platform.OS === "web") {
    return <NativeKeyboardAvoidingView {...props}>{children}</NativeKeyboardAvoidingView>;
  }
  return (
    <ControllerKeyboardAvoidingView behavior={behavior} {...props}>
      {children}
    </ControllerKeyboardAvoidingView>
  );
}

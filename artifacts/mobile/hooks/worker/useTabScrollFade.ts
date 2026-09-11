import { useCallback, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

/** Tracks whether a horizontal tab ScrollView currently has content scrolled
 * off the trailing edge, so callers can show a fade hint instead of silently
 * clipping a tab label with no indication there's more to scroll to. Only
 * true while there's actually unscrolled content — once the user has
 * scrolled to the end, the fade goes away rather than sitting permanently
 * over the last tab's label. */
export function useTabScrollFade() {
  const [showFade, setShowFade] = useState(false);
  const containerWidthRef = useRef(0);
  const contentWidthRef = useRef(0);

  const evaluate = useCallback((offsetX: number) => {
    const overflow = contentWidthRef.current - containerWidthRef.current;
    setShowFade(overflow > 1 && offsetX < overflow - 4);
  }, []);

  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      containerWidthRef.current = e.nativeEvent.layout.width;
      evaluate(0);
    },
    [evaluate],
  );

  const onContentSizeChange = useCallback(
    (width: number) => {
      contentWidthRef.current = width;
      evaluate(0);
    },
    [evaluate],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      evaluate(e.nativeEvent.contentOffset.x);
    },
    [evaluate],
  );

  return { showFade, onLayout, onContentSizeChange, onScroll, scrollEventThrottle: 32 as const };
}

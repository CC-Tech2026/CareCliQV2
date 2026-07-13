import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Image as RNImage, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

export type CropTransform = {
  translateX: number;
  translateY: number;
  scale: number;
  imageWidth: number;
  imageHeight: number;
};

type Props = {
  uri: string;
  size: number;
  onTransformChange: (transform: CropTransform) => void;
};

export function ProfilePhotoCropEditor({ uri, size, onTransformChange }: Props) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  const imageW = useSharedValue(size);
  const imageH = useSharedValue(size);

  const notify = useCallback(
    (tx: number, ty: number, sc: number, width: number, height: number) => {
      onTransformChange({
        translateX: tx,
        translateY: ty,
        scale: sc,
        imageWidth: width,
        imageHeight: height,
      });
    },
    [onTransformChange],
  );

  useEffect(() => {
    translateX.value = 0;
    translateY.value = 0;
    scale.value = 1;
    let cancelled = false;
    RNImage.getSize(
      uri,
      (width, height) => {
        if (cancelled) return;
        imageW.value = width;
        imageH.value = height;
        setNatural({ width, height });
        notify(0, 0, 1, width, height);
      },
      () => {
        if (cancelled) return;
        imageW.value = size;
        imageH.value = size;
        setNatural({ width: size, height: size });
        notify(0, 0, 1, size, size);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri, size, translateX, translateY, scale, imageW, imageH, notify]);

  const baseScale = useMemo(() => {
    if (!natural) return 1;
    return Math.max(size / natural.width, size / natural.height);
  }, [natural, size]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = startX.value + event.translationX;
      translateY.value = startY.value + event.translationY;
    })
    .onEnd(() => {
      runOnJS(notify)(translateX.value, translateY.value, scale.value, imageW.value, imageH.value);
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.min(3, Math.max(1, startScale.value * event.scale));
    })
    .onEnd(() => {
      runOnJS(notify)(translateX.value, translateY.value, scale.value, imageW.value, imageH.value);
    });

  const composed = Gesture.Simultaneous(pan, pinch);

  const imageStyle = useAnimatedStyle(() => {
    const renderW = (natural?.width ?? size) * baseScale * scale.value;
    const renderH = (natural?.height ?? size) * baseScale * scale.value;
    return {
      width: renderW,
      height: renderH,
      transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
    };
  });

  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: size / 2 }]}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.imageWrap, { width: size, height: size }]}>
          <Animated.Image source={{ uri }} style={imageStyle} resizeMode="stretch" />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/** Map circle viewport + pan/zoom into a square crop on the source image. */
export function cropRectFromTransform(
  transform: CropTransform,
  circleSize: number,
): { originX: number; originY: number; width: number; height: number } {
  const { translateX, translateY, scale, imageWidth, imageHeight } = transform;
  const baseScale = Math.max(circleSize / imageWidth, circleSize / imageHeight);
  const displayScale = baseScale * scale;
  const renderW = imageWidth * displayScale;
  const renderH = imageHeight * displayScale;
  const left = (circleSize - renderW) / 2 + translateX;
  const top = (circleSize - renderH) / 2 + translateY;
  let originX = -left / displayScale;
  let originY = -top / displayScale;
  let size = circleSize / displayScale;

  originX = Math.max(0, Math.min(originX, imageWidth - 1));
  originY = Math.max(0, Math.min(originY, imageHeight - 1));
  size = Math.min(size, imageWidth - originX, imageHeight - originY);
  size = Math.max(1, size);

  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.round(size),
    height: Math.round(size),
  };
}

const styles = StyleSheet.create({
  frame: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8E6F2",
  },
  imageWrap: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});

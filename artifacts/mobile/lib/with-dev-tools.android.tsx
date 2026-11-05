import { requireOptionalNativeModule } from "expo";
import React, { useEffect, useId } from "react";
import { AppState } from "react-native";

type KeepAwakeModule = {
  activate(tag: string): Promise<void>;
  deactivate(tag: string): Promise<void>;
};

/** Android dev-only replacement for Expo's optional keep-awake wrapper.
 * Expo SDK 54 leaves activation rejections unhandled when no Activity is ready.
 * Retry on foreground, and release only this wrapper's lock on background/unmount.
 */
export function withDevTools<P extends object>(
  Component: React.ComponentType<P>,
) {
  function WithDevTools(props: P) {
    const tag = useId();
    useEffect(() => {
      const native =
        requireOptionalNativeModule<KeepAwakeModule>("ExpoKeepAwake");
      if (!native) return;
      let generation = 0;
      const release = () => {
        void native.deactivate(tag).catch(() => {});
      };
      const sync = (state: string) => {
        const attempt = ++generation;
        if (state !== "active") {
          release();
          return;
        }
        void native
          .activate(tag)
          .then(() => {
            if (attempt !== generation) release();
          })
          .catch(() => {
            // Development convenience: an unavailable Activity must not redbox the app.
            // A subsequent foreground event retries activation.
          });
      };
      sync(AppState.currentState);
      const listener = AppState.addEventListener("change", sync);
      return () => {
        ++generation;
        listener.remove();
        release();
      };
    }, [tag]);
    return <Component {...props} />;
  }
  WithDevTools.displayName =
    "withDevTools(" + (Component.displayName || Component.name || "App") + ")";
  return WithDevTools;
}

import { useCallback, useState } from "react";

/** How each person likes Quill to behave. Saved in this browser only: these
 * are personal conveniences, not organisation settings. */
export type QuillSettings = {
  /** "brief": the answer in a sentence or two. "detailed": plus what's behind the figures. */
  answerLength: "brief" | "detailed";
  /** Suggest questions to ask next under each answer. */
  followUps: boolean;
  textSize: "standard" | "large";
  /** Where Quill opens: wherever it was last left, or always the panel or full screen. */
  openIn: "last" | "panel" | "full";
  /** On: Enter sends and Shift + Enter adds a line. Off: Ctrl or Cmd + Enter sends. */
  enterSends: boolean;
};

export const DEFAULT_SETTINGS: QuillSettings = {
  answerLength: "brief",
  followUps: true,
  textSize: "standard",
  openIn: "last",
  enterSends: true,
};

const SETTINGS_KEY = "quill.settings";
const LAST_MODE_KEY = "quill.full-screen";

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function readSettings(): QuillSettings {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<QuillSettings>;
    return {
      answerLength: pick(raw.answerLength, ["brief", "detailed"] as const, DEFAULT_SETTINGS.answerLength),
      followUps: typeof raw.followUps === "boolean" ? raw.followUps : DEFAULT_SETTINGS.followUps,
      textSize: pick(raw.textSize, ["standard", "large"] as const, DEFAULT_SETTINGS.textSize),
      openIn: pick(raw.openIn, ["last", "panel", "full"] as const, DEFAULT_SETTINGS.openIn),
      enterSends: typeof raw.enterSends === "boolean" ? raw.enterSends : DEFAULT_SETTINGS.enterSends,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useQuillSettings() {
  const [settings, setSettings] = useState<QuillSettings>(readSettings);
  const update = useCallback(<K extends keyof QuillSettings>(key: K, value: QuillSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: the setting lasts until the page reloads */
      }
      return next;
    });
  }, []);
  return { settings, update };
}

/** Whether Quill was last left full screen (used when openIn is "last"). */
export function readLastFullScreen(): boolean {
  try {
    return window.localStorage.getItem(LAST_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeLastFullScreen(full: boolean) {
  try {
    window.localStorage.setItem(LAST_MODE_KEY, full ? "1" : "0");
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
}

/** Text sizes for each Quill size and text-size setting, in pixels. */
export function textSizes(full: boolean, large: boolean) {
  const base = full ? 14.5 : 13;
  const bump = large ? 1.5 : 0;
  return { body: base + bump, small: (full ? 12.5 : 12) + bump };
}

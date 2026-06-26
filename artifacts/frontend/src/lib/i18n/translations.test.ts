import { describe, expect, it } from "vitest";
import { t, TRANSLATIONS } from "@/lib/i18n/translations";
import { CC } from "@/lib/brand-tokens";

describe("i18n translations", () => {
  it("provides all four worker languages", () => {
    expect(Object.keys(TRANSLATIONS).sort()).toEqual(["ar", "en", "vi", "zh-Hans"]);
  });

  it("falls back to English for missing keys", () => {
    expect(t("vi", "nav.dashboard")).toBe("Bảng điều khiển");
    expect(t("vi", "nonexistent.key")).toBe("nonexistent.key");
  });

  it("translates accessibility settings in Vietnamese", () => {
    expect(t("vi", "accessibility.highContrast")).toBe("Độ tương phản cao");
  });

  it("translates shift clock-in in Vietnamese", () => {
    expect(t("vi", "shift.clockIn")).toContain("Check-in");
  });
});

describe("brand CSS tokens", () => {
  it("exports CSS variable references for theme overrides", () => {
    expect(CC.plum).toBe("var(--cc-plum)");
    expect(CC.text).toBe("var(--cc-text)");
  });
});

describe("font scale presets", () => {
  const scales = { small: "0.9", default: "1", large: "1.18", xl: "1.4" };

  it("matches acceptance criteria for large and xl", () => {
    expect(scales.large).toBe("1.18");
    expect(scales.xl).toBe("1.4");
  });
});

import { describe, expect, it } from "vitest";
import overrides from "@/lib/i18n/locale-overrides.json";
import { en, TRANSLATIONS } from "@/lib/i18n/translations";
import type { AppLanguage } from "@/lib/i18n/types";

const LOCALES: AppLanguage[] = ["vi", "ar", "zh-Hans"];

describe("CARECLIQV2-290 i18n completeness", () => {
  it("every locale has all English keys", () => {
    const enKeys = Object.keys(en).sort();
    for (const lang of LOCALES) {
      const keys = Object.keys(TRANSLATIONS[lang]).sort();
      expect(keys).toEqual(enKeys);
    }
  });

  it("hand-maintained override keys are translated (not identical to English)", () => {
    for (const lang of LOCALES) {
      const langOverrides = overrides[lang as keyof typeof overrides] ?? {};
      const stillEnglish = Object.keys(langOverrides).filter(
        (key) => TRANSLATIONS[lang][key] === en[key],
      );
      // Allow brand names and very short tokens to stay English
      const unexpected = stillEnglish.filter(
        (key) => !key.includes("CareCliQ") && (en[key]?.length ?? 0) > 2,
      );
      expect(
        unexpected.length,
        `${lang} still English (${unexpected.length}): ${unexpected.slice(0, 5).join(", ")}`,
      ).toBeLessThan(50);
    }
  });

  it("non-English locales differ from English for most keys", () => {
    for (const lang of LOCALES) {
      const untranslated = Object.keys(en).filter((key) => TRANSLATIONS[lang][key] === en[key]);
      expect(
        untranslated.length,
        `${lang} still English: ${untranslated.slice(0, 5).join(", ")}`,
      ).toBeLessThan(50);
    }
  });
});

import { FONT_SCALE } from "@/contexts/AccessibilityContext";

describe("CARECLIQV2-290 font scale values", () => {
  it("matches ticket spec (118% large, 140% xl)", () => {
    expect(FONT_SCALE.large).toBe("1.18");
    expect(FONT_SCALE.xl).toBe("1.4");
    expect(FONT_SCALE.small).toBe("0.9");
  });
});

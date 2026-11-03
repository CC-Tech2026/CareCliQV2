import AsyncStorage from "@react-native-async-storage/async-storage";

import { CCQ_NOTE_LANGUAGE_KEY } from "@/lib/storage-keys";
import { translateNoteToEnglish } from "@/lib/worker-api";

/**
 * Languages a worker can write or speak a shift note in. The note is saved in
 * English (the record the provider is audited on), with the worker's own
 * words kept beside it. Covers the languages most spoken by Australia's
 * disability support workforce, well beyond the four the app itself is
 * translated into; every one is supported by the backend's translation
 * providers.
 */
export const NOTE_LANGUAGES: ReadonlyArray<{ value: string; label: string; nativeLabel: string }> = [
  { value: "auto", label: "Auto detect", nativeLabel: "Auto detect" },
  { value: "en", label: "English", nativeLabel: "English" },
  { value: "ar", label: "Arabic", nativeLabel: "العربية" },
  { value: "am", label: "Amharic", nativeLabel: "አማርኛ" },
  { value: "bn", label: "Bengali", nativeLabel: "বাংলা" },
  { value: "zh", label: "Chinese (Mandarin)", nativeLabel: "中文" },
  { value: "zh-TW", label: "Chinese (Cantonese)", nativeLabel: "廣東話" },
  { value: "fa", label: "Persian (Farsi, Dari)", nativeLabel: "فارسی" },
  { value: "tl", label: "Filipino (Tagalog)", nativeLabel: "Filipino" },
  { value: "fr", label: "French", nativeLabel: "Français" },
  { value: "el", label: "Greek", nativeLabel: "Ελληνικά" },
  { value: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  { value: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia" },
  { value: "it", label: "Italian", nativeLabel: "Italiano" },
  { value: "ko", label: "Korean", nativeLabel: "한국어" },
  { value: "ml", label: "Malayalam", nativeLabel: "മലയാളം" },
  { value: "ne", label: "Nepali", nativeLabel: "नेपाली" },
  { value: "pa", label: "Punjabi", nativeLabel: "ਪੰਜਾਬੀ" },
  { value: "si", label: "Sinhala", nativeLabel: "සිංහල" },
  { value: "so", label: "Somali", nativeLabel: "Soomaali" },
  { value: "es", label: "Spanish", nativeLabel: "Español" },
  { value: "sw", label: "Swahili", nativeLabel: "Kiswahili" },
  { value: "ta", label: "Tamil", nativeLabel: "தமிழ்" },
  { value: "th", label: "Thai", nativeLabel: "ไทย" },
  { value: "ur", label: "Urdu", nativeLabel: "اردو" },
  { value: "vi", label: "Vietnamese", nativeLabel: "Tiếng Việt" },
];

export function noteLanguageLabel(code: string | null | undefined): string {
  const option = NOTE_LANGUAGES.find((o) => o.value === code);
  if (!option) return code ?? "";
  return option.nativeLabel === option.label ? option.label : `${option.nativeLabel} (${option.label})`;
}

export async function loadNoteLanguage(): Promise<string | null> {
  try {
    const saved = await AsyncStorage.getItem(CCQ_NOTE_LANGUAGE_KEY);
    return saved && NOTE_LANGUAGES.some((o) => o.value === saved) ? saved : null;
  } catch {
    return null;
  }
}

export async function saveNoteLanguage(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CCQ_NOTE_LANGUAGE_KEY, code);
  } catch {
    /* only a convenience; the picker still works for this note */
  }
}

export type RecordTranslation = {
  /** The English text that is saved as the note. */
  english: string;
  /** The worker's own words, when they weren't already English. */
  original?: string;
  /** The language the original was in. */
  originalLanguage?: string;
};

/**
 * Turns what the worker wrote into the English record. Throws when a
 * non-English note can't be translated, so the caller keeps the draft rather
 * than saving the worker's own-language text as if it were the English record
 * (the backend's translate_to_english has the same rule).
 */
export async function toEnglishRecord(text: string, language: string): Promise<RecordTranslation> {
  const trimmed = text.trim();
  if (!trimmed || language === "en") return { english: trimmed };
  const result = await translateNoteToEnglish(trimmed, language);
  const english = String(result?.translated ?? "").trim();
  if (!english || result?.status === "failed" || result?.status === "unsupported") {
    throw new Error("translation unavailable");
  }
  const detected = String(result?.detected_language ?? "").toLowerCase();
  if (detected === "en" || english === trimmed) return { english };
  return {
    english,
    original: trimmed,
    originalLanguage: language === "auto" ? detected || "auto" : language,
  };
}

const LIBRETRANSLATE_URL: string =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).env?.VITE_LIBRETRANSLATE_URL ?? "http://localhost:5000";

export interface TranslationResult {
  translated: string;
  detectedLanguage: string;
  confidence: number;
  source: "libretranslate" | "openai" | "cache";
}

const cache = new Map<string, TranslationResult>();

async function tryLibreTranslate(text: string): Promise<TranslationResult> {
  const res = await fetch(`${LIBRETRANSLATE_URL}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, source: "auto", target: "en", format: "text" }),
  });
  if (!res.ok) throw new Error(`LibreTranslate ${res.status}`);
  const data = await res.json();
  return {
    translated: data.translatedText ?? text,
    detectedLanguage: data.detectedLanguage?.language ?? "",
    confidence: data.detectedLanguage?.confidence ?? 0.9,
    source: "libretranslate",
  };
}

async function tryBackendTranslate(text: string): Promise<TranslationResult> {
  const res = await fetch("/api/ai/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Backend translate ${res.status}`);
  const data = await res.json();
  return {
    translated: data.translated ?? text,
    detectedLanguage: data.detected_language ?? "",
    confidence: data.confidence ?? 0.9,
    source: "openai",
  };
}

export async function translateToEnglish(text: string): Promise<TranslationResult> {
  if (!text.trim()) {
    return { translated: text, detectedLanguage: "en", confidence: 1, source: "cache" };
  }

  const key = text.trim();
  if (cache.has(key)) {
    return { ...cache.get(key)!, source: "cache" };
  }

  let result: TranslationResult;
  try {
    result = await tryLibreTranslate(key);
  } catch {
    result = await tryBackendTranslate(key);
  }

  cache.set(key, result);
  return result;
}

export function clearTranslationCache(): void {
  cache.clear();
}

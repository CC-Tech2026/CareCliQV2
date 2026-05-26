import { apiFetch } from "@/lib/api-fetch";

export type TranslationStatus =
  | "not_required"
  | "pending"
  | "translated"
  | "failed"
  | "unsupported"
  | "manually_confirmed";

export interface TranslationResult {
  translated: string;
  detectedLanguage: string;
  confidence: number;
  status: TranslationStatus;
  provider: string;
  metadata: Record<string, unknown>;
  error: string | null;
}

const cache = new Map<string, TranslationResult>();

export async function translateToEnglish(
  text: string,
  sourceLanguage?: string,
): Promise<TranslationResult> {
  const key = `${sourceLanguage || "auto"}:${text.trim()}`;
  if (!text.trim()) {
    return {
      translated: "",
      detectedLanguage: "en",
      confidence: 0,
      status: "failed",
      provider: "none",
      metadata: {},
      error: "Text is empty.",
    };
  }

  if (cache.has(key)) {
    return cache.get(key)!;
  }

  try {
    const res = await apiFetch("/api/ai/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source_language: sourceLanguage || "auto" }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Backend translate ${res.status}`);
    }
    const data = await res.json();
    const translated = String(data.translated || "").trim();
    if (!translated) throw new Error("Translation returned empty text.");

    const result: TranslationResult = {
      translated,
      detectedLanguage: data.detected_language || data.detectedLanguage || "en",
      confidence: Number(data.confidence ?? 0.95),
      status: translated === text.trim() ? "not_required" : "translated",
      provider: data.provider || "openai",
      metadata: data.metadata || {},
      error: null,
    };
    cache.set(key, result);
    return result;
  } catch (error) {
    return {
      translated: "",
      detectedLanguage: sourceLanguage || "",
      confidence: 0,
      status: "failed",
      provider: "none",
      metadata: {},
      error: error instanceof Error ? error.message : "Translation failed.",
    };
  }
}

export function clearTranslationCache(): void {
  cache.clear();
}

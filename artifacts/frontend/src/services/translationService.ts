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

function friendlyTranslationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Translation failed.");
  const lower = message.toLowerCase();
  if (
    lower.includes("api key") ||
    lower.includes("authorization header") ||
    lower.includes("translation provider is not configured")
  ) {
    return "Translation provider is not configured on the backend. Add OPENAI_API_KEY or LIBRETRANSLATE_URL and restart the backend.";
  }
  if (lower.includes("translation provider failed")) {
    return "Translation provider failed. Check the backend translation settings and retry.";
  }
  return message || "Translation failed.";
}

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
      error: friendlyTranslationError(error),
    };
  }
}

export function clearTranslationCache(): void {
  cache.clear();
}

import { useCallback, useState } from "react";
import { translateToEnglish, type TranslationResult } from "@/services/translationService";

interface UseTranslationReturn {
  translate: (text: string) => Promise<TranslationResult | null>;
  isTranslating: boolean;
  lastError: string | null;
  clearError: () => void;
}

export function useTranslation(): UseTranslationReturn {
  const [isTranslating, setIsTranslating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const translate = useCallback(async (text: string): Promise<TranslationResult | null> => {
    if (!text.trim()) return null;
    setIsTranslating(true);
    setLastError(null);
    try {
      const result = await translateToEnglish(text);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Translation failed";
      setLastError(msg);
      return null;
    } finally {
      setIsTranslating(false);
    }
  }, []);

  return {
    translate,
    isTranslating,
    lastError,
    clearError: () => setLastError(null),
  };
}

/**
 * TranslationAuditView — Phase 6 (SCRUM-113)
 *
 * Read-only, side-by-side display of:
 *  - Left panel : original language input (as dictated / typed)
 *  - Right panel: translated English note
 *
 * This component is intentionally non-editable. It serves as an immutable
 * audit trail of what the worker said vs. what was stored as the clinical note.
 */

import { Globe, Lock, FileText, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface TranslationMetadata {
  model?: string;
  source_language?: string;
  source_language_name?: string;
  provider?: string;
  created_at?: string;
  translated_at?: string;
  confidence?: number;
}

interface TranslationAuditViewProps {
  originalLanguageInput?: string | null;
  translatedEnglishNote?: string | null;
  translationMetadata?: TranslationMetadata | null;
  translationStatus?: string | null;
  translationProvider?: string | null;
}

export function TranslationAuditView({
  originalLanguageInput,
  translatedEnglishNote,
  translationMetadata,
  translationStatus,
  translationProvider,
}: TranslationAuditViewProps) {
  if (!originalLanguageInput && !translatedEnglishNote) return null;

  const lang = translationMetadata?.source_language_name
    ?? translationMetadata?.source_language
    ?? "Original";

  const model = translationMetadata?.model ?? translationProvider ?? "AI";
  const provider = translationProvider ?? translationMetadata?.provider ?? "AI";
  const translatedAtRaw = translationMetadata?.translated_at || translationMetadata?.created_at;
  const translatedAt = translatedAtRaw
    ? new Date(translatedAtRaw).toLocaleString()
    : null;

  return (
    <div className="rounded-xl border border-[rgba(232,213,232,0.5)] overflow-hidden bg-white shadow-[0_1px_4px_rgba(55,48,163,0.06)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[rgba(55,48,163,0.04)] border-b border-[rgba(232,213,232,0.4)]">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-[#E8457A]" />
          <span className="text-sm font-semibold text-[#1C1626]">
            Translation Audit Trail
          </span>
          <Badge
            variant="outline"
            className="text-[10px] py-0 px-1.5 border-[#E8457A]/30 text-[#E8457A] bg-[#E8457A]/5"
          >
            {translationStatus ?? "audit"}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[#7A6A8A]">
          <Lock className="h-3 w-3" />
          Read-only audit mode
        </div>
      </div>

      {/* Metadata bar */}
      {translationMetadata && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-[rgba(55,48,163,0.02)] border-b border-[rgba(232,213,232,0.3)] text-[11px] text-[#7A6A8A]">
          <span className="flex items-center gap-1">
            <Info className="h-3 w-3" />
            Source: <strong className="text-[#374151] ml-0.5">{lang}</strong>
          </span>
          <span>Provider: <strong className="text-[#374151]">{provider}</strong></span>
          <span>Model: <strong className="text-[#374151]">{model}</strong></span>
          {translatedAt && (
            <span>Translated: <strong className="text-[#374151]">{translatedAt}</strong></span>
          )}
        </div>
      )}

      {/* Side-by-side panels */}
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[rgba(232,213,232,0.5)]">
        {/* Left: original input */}
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-3.5 w-3.5 text-[#F1738A]" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#7A6A8A]">
              Original ({lang})
            </span>
          </div>
          {originalLanguageInput ? (
            <p className="text-sm text-[#1C1626] whitespace-pre-wrap leading-relaxed select-text">
              {originalLanguageInput}
            </p>
          ) : (
            <p className="text-sm text-[#7A6A8A] italic">No original input recorded.</p>
          )}
        </div>

        {/* Right: translated English */}
        <div className="p-4 bg-[rgba(55,48,163,0.015)]">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="h-3.5 w-3.5 text-[#E8457A]" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[#7A6A8A]">
              Translated (English)
            </span>
          </div>
          {translatedEnglishNote ? (
            <p className="text-sm text-[#1C1626] whitespace-pre-wrap leading-relaxed select-text">
              {translatedEnglishNote}
            </p>
          ) : (
            <p className="text-sm text-[#7A6A8A] italic">No translation stored.</p>
          )}
        </div>
      </div>
    </div>
  );
}

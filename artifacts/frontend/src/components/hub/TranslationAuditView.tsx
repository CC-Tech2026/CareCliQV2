import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TranslationStatus } from "@/services/translationService";

export interface TranslationAuditMessage {
  id: string;
  /** Raw text as typed by the user (original language). */
  originalLanguageInput: string | null;
  /** English translation stored in DB. */
  translatedContent: string | null;
  detectedLanguage: string | null;
  translationStatus: TranslationStatus | null;
  translationProvider: string | null;
  /** Raw metadata JSONB from DB — may include confidence, model, etc. */
  translationMetadata: Record<string, unknown> | null;
}

interface TranslationAuditViewProps {
  messages: TranslationAuditMessage[];
  className?: string;
}

const STATUS_BADGE: Record<TranslationStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  translated: { label: "Translated", variant: "default" },
  not_required: { label: "No translation needed", variant: "secondary" },
  manually_confirmed: { label: "Manually confirmed", variant: "outline" },
  pending: { label: "Pending", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
  unsupported: { label: "Unsupported language", variant: "destructive" },
};

function StatusBadge({ status }: { status: TranslationStatus | null }) {
  if (!status) return null;
  const cfg = STATUS_BADGE[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function ConfidencePill({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return null;
  const raw = metadata.confidence ?? metadata.score;
  if (raw == null) return null;
  const pct = Math.round(Number(raw) * 100);
  return (
    <span className="text-xs text-muted-foreground tabular-nums">
      {pct}% confidence
    </span>
  );
}

export function TranslationAuditView({ messages, className }: TranslationAuditViewProps) {
  if (!messages.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No messages to review.
      </p>
    );
  }

  return (
    <ScrollArea className={className}>
      <div className="space-y-4">
        {messages.map((msg) => {
          const needsReview =
            msg.translationStatus === "failed" ||
            msg.translationStatus === "pending" ||
            msg.translationStatus === "unsupported";

          return (
            <div
              key={msg.id}
              className={`rounded-lg border p-4 ${needsReview ? "border-destructive/50 bg-destructive/5" : "border-border"}`}
            >
              {/* Header row */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <StatusBadge status={msg.translationStatus} />
                {msg.detectedLanguage && msg.detectedLanguage !== "en" && (
                  <Badge variant="outline" className="font-mono text-xs uppercase">
                    {msg.detectedLanguage}
                  </Badge>
                )}
                {msg.translationProvider && msg.translationProvider !== "none" && (
                  <span className="text-xs text-muted-foreground">
                    via {msg.translationProvider}
                  </span>
                )}
                <ConfidencePill metadata={msg.translationMetadata} />
              </div>

              {/* Side-by-side panels */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Left: original language input */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Original ({msg.detectedLanguage ?? "unknown"})
                  </p>
                  <div className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap min-h-[3rem]">
                    {msg.originalLanguageInput ?? (
                      <span className="italic text-muted-foreground">Not recorded</span>
                    )}
                  </div>
                </div>

                {/* Right: English translation */}
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    English translation
                  </p>
                  <div className="rounded-md bg-background border px-3 py-2 text-sm whitespace-pre-wrap min-h-[3rem]">
                    {msg.translatedContent ?? (
                      <span className="italic text-muted-foreground">
                        {msg.translationStatus === "failed"
                          ? "Translation failed — review manually"
                          : "No translation"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

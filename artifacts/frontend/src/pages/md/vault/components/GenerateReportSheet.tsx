import { useState } from "react";
import { FileText } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { apiFetch } from "@/lib/api-fetch";
import { ChoiceCard, PanelFooter, PanelHeader, PrimaryButton, SecondaryButton } from "./PanelKit";

/** The report types the backend can generate (REPORT_TYPES in api/reports.py). */
export const PARTICIPANT_REPORT_TYPES = [
  { value: "therapy_progress_report", title: "Therapy progress report", description: "Progress against goals from recent sessions." },
  { value: "functional_capacity_assessment", title: "Functional capacity assessment", description: "Daily living, mobility and support needs." },
  { value: "goal_review_report", title: "Goal review report", description: "Each goal, its progress and what's next." },
  { value: "annual_review_report", title: "Annual review report", description: "A year of supports, for the plan review." },
  { value: "assistive_technology_assessment", title: "Assistive technology assessment", description: "Equipment needs and recommendations." },
  { value: "home_modification_report", title: "Home modification report", description: "Home access and modification needs." },
] as const;

/**
 * Generates a PDF report for one participant from their recorded care
 * information. It's filed in their Clinical Docs folder, so it's kept,
 * versioned and shareable like every other vault document.
 */
export function GenerateReportSheet({
  open,
  onOpenChange,
  participantId,
  participantName,
  onGenerated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  participantName: string;
  onGenerated: () => void;
}) {
  const { toast } = useToast();
  const { requireReAuth, modal } = useReAuth();
  const [reportType, setReportType] = useState<string>(PARTICIPANT_REPORT_TYPES[0].value);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const response = await requireReAuth(() =>
        apiFetch(`/api/reports/participant/${encodeURIComponent(participantId)}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report_type: reportType }),
        }),
      );
      if (!response) return;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Could not generate the report.");
      toast({ title: "Report generated", description: `${payload.title ?? "The report"} is in ${participantName}'s Clinical Docs.` });
      onOpenChange(false);
      onGenerated();
    } catch (error) {
      toast({
        title: "Report not generated",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {modal}
      <Sheet open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetTitle className="sr-only">Generate a report</SheetTitle>
          <SheetDescription className="sr-only">Generate a report for {participantName}.</SheetDescription>
          <PanelHeader
            icon={FileText}
            title="Generate a report"
            description={`Built from ${participantName}'s plan, goals and recorded sessions, then filed in their Clinical Docs.`}
          />
          <div className="mt-6 flex-1 space-y-2" role="radiogroup" aria-label="Report type">
            <p className="text-sm font-medium" style={{ color: "var(--cc-text)" }}>Report type</p>
            {PARTICIPANT_REPORT_TYPES.map((type) => (
              <ChoiceCard
                key={type.value}
                selected={reportType === type.value}
                onSelect={() => setReportType(type.value)}
                title={type.title}
                description={type.description}
              />
            ))}
          </div>
          <PanelFooter>
            <SecondaryButton onClick={() => onOpenChange(false)} disabled={busy}>Cancel</SecondaryButton>
            <PrimaryButton onClick={() => void generate()} busy={busy}>
              {busy ? "Generating…" : "Generate PDF"}
            </PrimaryButton>
          </PanelFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

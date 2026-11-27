/**
 * Where Employment Hero sends the director back after they sign in. It adds a
 * code; this hands it to the API to finish connecting, then opens Employment
 * Hero's page in Settings > Integrations (to choose the business, if their
 * login sees more than one). If they cancelled, says so.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { completeEmploymentHeroConnect } from "@/services/employmentHeroService";
import { useToast } from "@/hooks/use-toast";

const INTEGRATIONS = "/settings?section=integrations";

export default function EmploymentHeroCallbackPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const started = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    if (error) {
      setProblem(
        error === "access_denied"
          ? "Connecting to Employment Hero was cancelled."
          : `Employment Hero said: ${params.get("error_description") || error}`,
      );
      return;
    }
    if (!code || !state) {
      setProblem("This link is missing the details Employment Hero sends back. Start again from Settings > Integrations.");
      return;
    }
    completeEmploymentHeroConnect(code, state)
      .then((status) => {
        void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("integrations") });
        toast({
          title: status.needs_business ? "Connected to Employment Hero" : `Connected to ${status.business_name || "Employment Hero"}`,
          description: status.needs_business
            ? "Choose which payroll business is yours."
            : "Approved timesheets will now go to Employment Hero for the pay run.",
        });
        setLocation(`${INTEGRATIONS}&integration=employment-hero`, { replace: true });
      })
      .catch((err) => setProblem(err instanceof Error ? err.message : "Couldn't finish connecting to Employment Hero."));
  }, [qc, setLocation, toast]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-cc-border bg-cc-surface p-6 text-center">
        {problem ? (
          <>
            <h1 className="text-lg font-semibold text-cc-text">Employment Hero isn't connected</h1>
            <p className="mt-2 text-sm text-cc-muted">{problem}</p>
            <Link
              href={INTEGRATIONS}
              className="mt-5 inline-flex h-10 md:h-8 items-center rounded-lg px-4 text-sm font-semibold text-white"
              style={{ background: "var(--cc-cta)" }}
            >
              Back to Integrations
            </Link>
          </>
        ) : (
          <div role="status" className="flex flex-col items-center gap-3 text-sm text-cc-muted">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--cc-brand-purple)" }} />
            Finishing connecting to Employment Hero...
          </div>
        )}
      </div>
    </div>
  );
}

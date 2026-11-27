/**
 * Where Xero sends the director back after they choose their organisation.
 * Hands the code to the API to finish connecting, then returns to
 * Settings > Integrations. If they cancelled in Xero, says so.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { completeXeroConnect } from "@/services/integrationsService";
import { useToast } from "@/hooks/use-toast";

export default function XeroCallbackPage() {
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
      setProblem(error === "access_denied" ? "Connecting to Xero was cancelled." : `Xero said: ${params.get("error_description") || error}`);
      return;
    }
    if (!code || !state) {
      setProblem("This link is missing the details Xero sends back. Start again from Settings > Integrations.");
      return;
    }
    completeXeroConnect(code, state)
      .then((status) => {
        void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("integrations") });
        toast({ title: `Connected to ${status.tenant_name || "Xero"}`, description: "Approved invoices will now go to Xero." });
        setLocation("/settings?section=integrations", { replace: true });
      })
      .catch((err) => setProblem(err instanceof Error ? err.message : "Couldn't finish connecting to Xero."));
  }, [qc, setLocation, toast]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-cc-border bg-cc-surface p-6 text-center">
        {problem ? (
          <>
            <h1 className="text-lg font-semibold text-cc-text">Xero isn't connected</h1>
            <p className="mt-2 text-sm text-cc-muted">{problem}</p>
            <Link
              href="/settings?section=integrations"
              className="mt-5 inline-flex h-10 md:h-8 items-center rounded-lg px-4 text-sm font-semibold text-white"
              style={{ background: "var(--cc-cta)" }}
            >
              Back to Integrations
            </Link>
          </>
        ) : (
          <div role="status" className="flex flex-col items-center gap-3 text-sm text-cc-muted">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--cc-brand-purple)" }} />
            Finishing connecting to Xero...
          </div>
        )}
      </div>
    </div>
  );
}

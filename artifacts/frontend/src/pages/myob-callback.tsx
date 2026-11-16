/**
 * Where MYOB sends the director back after they sign in and choose the
 * company file. MYOB adds the code and the file's businessId; this hands them
 * to the API to finish connecting, then returns to Settings > Integrations.
 * If they cancelled in MYOB, says so.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { completeMyobConnect } from "@/services/myobService";
import { useToast } from "@/hooks/use-toast";

export default function MyobCallbackPage() {
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
    const businessId = params.get("businessId") ?? params.get("businessid");
    const error = params.get("error");
    if (error) {
      setProblem(error === "access_denied" ? "Connecting to MYOB was cancelled." : `MYOB said: ${params.get("error_description") || error}`);
      return;
    }
    if (!code || !state || !businessId) {
      setProblem("This link is missing the details MYOB sends back. Start again from Settings > Integrations.");
      return;
    }
    completeMyobConnect(code, state, businessId)
      .then((status) => {
        void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("integrations") });
        const ready = status.settings.income_account_uid && status.settings.tax_code_uid;
        toast({
          title: `Connected to ${status.business_name || "MYOB"}`,
          description: ready
            ? "Approved invoices will now go to MYOB."
            : "Choose the income account and tax code in MYOB's settings, then invoices will go across.",
        });
        setLocation("/settings?section=integrations", { replace: true });
      })
      .catch((err) => setProblem(err instanceof Error ? err.message : "Couldn't finish connecting to MYOB."));
  }, [qc, setLocation, toast]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-cc-border bg-cc-surface p-6 text-center">
        {problem ? (
          <>
            <h1 className="text-lg font-semibold text-cc-text">MYOB isn't connected</h1>
            <p className="mt-2 text-sm text-cc-muted">{problem}</p>
            <Link
              href="/settings?section=integrations"
              className="mt-5 inline-flex h-10 items-center rounded-lg px-4 text-sm font-semibold text-white"
              style={{ background: "var(--cc-cta)" }}
            >
              Back to Integrations
            </Link>
          </>
        ) : (
          <div role="status" className="flex flex-col items-center gap-3 text-sm text-cc-muted">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--cc-brand-purple)" }} />
            Finishing connecting to MYOB...
          </div>
        )}
      </div>
    </div>
  );
}

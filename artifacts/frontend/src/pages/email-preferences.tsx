import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { CheckCircle2, Loader2, MailX } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { ctaClass, outlineClass } from "@/components/layout/PageKit";
import { apiFetch } from "@/lib/api-fetch";

/** Opened from the unsubscribe link in a CareCliQ news email; works signed
 *  out. The link only opens this page: the choice is saved when the person
 *  presses the button, so mail scanners that follow links change nothing. */
export default function EmailPreferencesPage() {
  const token = new URLSearchParams(useSearch()).get("token") ?? "";
  const [state, setState] = useState<{ email: string; news: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!token) { setError("This link is missing its code. Use the link in your most recent email."); return; }
    apiFetch(`/api/email-preferences?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : "This link isn't valid.");
        setState(body);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "This link isn't valid."));
  }, [token]);

  async function save(news: boolean) {
    setSaving(true);
    try {
      const r = await apiFetch("/api/email-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, news }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : "That didn't save.");
      setState(body);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-cc-bg px-4 py-10">
      <div className="w-full max-w-md rounded-3xl bg-cc-surface p-6 shadow-[var(--cc-shadow-md)] sm:p-8">
        <CareCliQLogo size={64} />
        <h1 className="mt-5 text-xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>Email preferences</h1>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-cc-muted">{error}</p>
        ) : !state ? (
          <Loader2 className="mt-6 animate-spin text-cc-muted" />
        ) : (
          <>
            <p className="mt-2 text-sm text-cc-muted">For {state.email}</p>
            <div className="mt-5 flex items-start gap-3 rounded-2xl bg-cc-soft p-4">
              {state.news ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" style={{ color: "var(--cc-status-success)" }} /> : <MailX size={18} className="mt-0.5 shrink-0 text-cc-muted" />}
              <p className="text-sm text-cc-text">
                {state.news ? "You get CareCliQ news and product updates." : "You won't get CareCliQ news and product updates."}
                {saved && <span className="block text-cc-muted">Saved.</span>}
              </p>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-cc-muted">
              Service messages about your account (maintenance, billing and security) still come through, because you need them to use CareCliQ.
            </p>
            <div className="mt-6">
              {state.news ? (
                <button type="button" className={`${ctaClass} w-full`} disabled={saving} onClick={() => void save(false)}>
                  {saving && <Loader2 size={15} className="animate-spin" />} Unsubscribe from news
                </button>
              ) : (
                <button type="button" className={`${outlineClass} w-full`} disabled={saving} onClick={() => void save(true)}>
                  {saving && <Loader2 size={15} className="animate-spin" />} Get news again
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

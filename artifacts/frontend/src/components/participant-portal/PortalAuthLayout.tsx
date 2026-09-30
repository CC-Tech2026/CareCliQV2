import { useEffect } from "react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";

/** Browser tab title for Participants Portal pages, so a tab or bookmark
 * clearly reads as the portal rather than the staff app. */
export function usePortalDocumentTitle(page?: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = page ? `${page} · Participants Portal` : "Participants Portal";
    return () => { document.title = previous; };
  }, [page]);
}

/**
 * The Participants Portal's own sign-in shell (sign in, forgot password) —
 * deliberately separate from the staff auth pages: plain language, larger
 * text, one centred card, no staff options.
 */
export function PortalAuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  usePortalDocumentTitle(title);
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10" style={{ background: "var(--cc-bg)" }}>
      <div
        className="w-full max-w-md rounded-3xl border p-6 shadow-sm sm:p-8"
        style={{ borderColor: "var(--cc-border)", background: "var(--cc-surface)" }}
      >
        <div className="mb-2 flex justify-center">
          <CareCliQLogo size={64} />
        </div>
        <p className="mb-6 text-center text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--cc-muted)" }}>
          Participants Portal
        </p>
        {children}
      </div>
    </div>
  );
}

export const portalInputClass = "mt-1 w-full rounded-xl border px-3 py-3 text-[16px]";
export const portalButtonClass =
  "flex w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-[15px] font-bold text-white disabled:opacity-60";

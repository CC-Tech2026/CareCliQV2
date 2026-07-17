import { ChevronLeft } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { FormHeader } from "./FormHeader";

interface FormPanelProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  showMobileBackButton?: boolean;
  showLogo?: boolean;
}

type FormLayout = "mobile" | "tablet" | "desktop";

function useFormLayout(): FormLayout {
  const [layout, setLayout] = useState<FormLayout>(() => {
    if (typeof window === "undefined") return "desktop";
    if (window.matchMedia("(min-width: 1280px)").matches) return "desktop";
    if (window.matchMedia("(min-width: 768px)").matches) return "tablet";
    return "mobile";
  });

  useEffect(() => {
    const xl = window.matchMedia("(min-width: 1280px)");
    const md = window.matchMedia("(min-width: 768px)");
    const sync = () => {
      if (xl.matches) setLayout("desktop");
      else if (md.matches) setLayout("tablet");
      else setLayout("mobile");
    };
    sync();
    xl.addEventListener("change", sync);
    md.addEventListener("change", sync);
    return () => {
      xl.removeEventListener("change", sync);
      md.removeEventListener("change", sync);
    };
  }, []);

  return layout;
}

/**
 * Smart Adaptive Form Panel with CareCliQ branding
 *
 * Desktop (xl, 1280px+): Fixed right-side panel (32% width)
 * Tablet (md-lg, 768-1279px): Slide-over drawer from right (60% width), background dims
 * Mobile (< 768px): Fullscreen form with back button and breadcrumb
 *
 * Only one layout mounts at a time so refs (e.g. contentEditable) stay correct.
 */
export function FormPanel({
  isOpen,
  title,
  subtitle,
  children,
  onClose,
  showMobileBackButton = true,
  showLogo = true,
}: FormPanelProps) {
  const layout = useFormLayout();

  if (!isOpen) return null;

  const header = (
    <FormHeader title={title} subtitle={subtitle} onClose={onClose} showLogo={showLogo} />
  );
  const body = (
    <div className="overflow-y-auto flex-1 px-4 py-4 sm:px-6 space-y-4" style={{ color: "var(--cc-text)" }}>
      {children}
    </div>
  );

  return (
    <>
      {showMobileBackButton && layout === "mobile" && (
        <div className="mb-3 flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 text-[12px] font-bold text-[#E8457A] hover:text-[#2D2A7F] transition-colors"
          >
            <ChevronLeft size={16} /> Back to Goals & Tasks
          </button>
        </div>
      )}

      {layout === "desktop" && (
        <div
          className="fixed right-0 top-14 w-[32%] z-40"
          style={{ height: "calc(100dvh - 3.5rem)" }}
        >
          <div
            className="flex flex-col border-l-4 border-l-[#E5D9FF] h-full shadow-2xl"
            style={{ background: "var(--cc-surface)" }}
          >
            {header}
            {body}
          </div>
        </div>
      )}

      {layout === "tablet" && (
        <>
          <div
            className="fixed left-0 right-0 top-14 bg-black bg-opacity-40 z-40 transition-opacity backdrop-blur-sm"
            style={{ height: "calc(100dvh - 3.5rem)" }}
            onClick={onClose}
          />
          <div
            className="fixed right-0 top-14 w-[60%] shadow-2xl z-50 flex flex-col border-l-4 border-l-[#E5D9FF]"
            style={{ height: "calc(100dvh - 3.5rem)", background: "var(--cc-surface)" }}
          >
            {header}
            {body}
          </div>
        </>
      )}

      {layout === "mobile" && (
        <div
          className="fixed left-0 right-0 z-50 flex flex-col border-t-4 border-t-[#E5D9FF]"
          style={{
            top: "calc(4rem + env(safe-area-inset-top))",
            height: "calc(100dvh - 4rem - env(safe-area-inset-top))",
            background: "var(--cc-surface)",
          }}
        >
          {header}
          {body}
        </div>
      )}
    </>
  );
}

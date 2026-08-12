import { X } from "lucide-react";
import { CareCliQLogo } from "./CareCliQLogo";

interface FormHeaderProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  showLogo?: boolean;
}

export function FormHeader({ title, subtitle, onClose, showLogo = true }: FormHeaderProps) {
  return (
    <div
      className="border-b-2 px-4 py-5 sm:px-6 sm:py-6 flex items-start justify-between gap-4"
      style={{
        background: "var(--cc-surface)",
        borderColor: "var(--cc-border)",
      }}
    >
      <div className="min-w-0 flex-1">
        {showLogo && (
          <div className="mb-3">
            <CareCliQLogo compact className="h-8" />
          </div>
        )}
        <h2
          className="text-[18px] sm:text-[20px] font-black tracking-tight leading-snug"
          style={{ fontFamily: "var(--app-font-display)", color: "var(--cc-text)" }}
        >
          {title}
        </h2>
        {subtitle && (
          <p className="text-[13px] mt-2 font-semibold" style={{ color: "var(--cc-muted)" }}>
            {subtitle}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 p-2 rounded-lg transition-all hover:shadow-sm"
        style={{ color: "var(--cc-muted)" }}
        title="Close"
        aria-label="Close form"
      >
        <X size={20} />
      </button>
    </div>
  );
}

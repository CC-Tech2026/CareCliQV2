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
    <div className="border-b border-[#E5E7EB] bg-white px-4 py-3 sm:px-6 sm:py-4 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {showLogo && (
          <div className="mb-2">
            <CareCliQLogo compact className="h-7" />
          </div>
        )}
        <h2 className="text-[16px] sm:text-[18px] font-black text-[#111827] tracking-tight" style={{ fontFamily: "var(--app-font-display)" }}>
          {title}
        </h2>
        {subtitle && <p className="text-[12px] text-[#6B7280] mt-1">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 p-1.5 rounded-lg hover:bg-[#F3F4F6] transition-colors text-[#6B7280] hover:text-[#111827]"
        title="Close"
        aria-label="Close form"
      >
        <X size={18} />
      </button>
    </div>
  );
}

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
    <div className="bg-gradient-to-r from-white via-white to-[#F3F0FF] border-b-2 border-[#E5D9FF] px-4 py-5 sm:px-6 sm:py-6 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        {showLogo && (
          <div className="mb-3">
            <CareCliQLogo compact className="h-8" />
          </div>
        )}
        <h2 className="text-[18px] sm:text-[20px] font-black text-[#1F2937] tracking-tight leading-snug" style={{ fontFamily: "var(--app-font-display)" }}>
          {title}
        </h2>
        {subtitle && <p className="text-[13px] text-[#6B7280] mt-2 font-semibold">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 p-2 rounded-lg hover:bg-[#F0ECFF] transition-all text-[#6B7280] hover:text-[#3730A3] hover:shadow-sm"
        title="Close"
        aria-label="Close form"
      >
        <X size={20} />
      </button>
    </div>
  );
}

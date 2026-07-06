import { ChevronLeft } from "lucide-react";
import { ReactNode } from "react";
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

/**
 * Smart Adaptive Form Panel with CareCliQ branding
 *
 * Desktop (xl, 1280px+): Fixed right-side panel (40% width)
 * Tablet (md-lg, 768-1279px): Slide-over drawer from right (60% width), background dims
 * Mobile (< 768px): Fullscreen form with back button and breadcrumb
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
  if (!isOpen) return null;

  return (
    <>
      {/* Mobile Breadcrumb Back Button (visible only on mobile) */}
      {showMobileBackButton && (
        <div className="md:hidden mb-3 flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 text-[12px] font-bold text-[#3730A3] hover:text-[#2D2A7F] transition-colors"
          >
            <ChevronLeft size={16} /> Back to Goals & Tasks
          </button>
        </div>
      )}

      {/* Desktop: Fixed Right-Side Panel (32% width, visible on xl+) */}
      <div className="hidden xl:block fixed right-0 top-0 bottom-0 w-[32%] z-40">
        <div className="flex flex-col bg-white border-l-4 border-l-[#E5D9FF] h-full shadow-2xl">
          <FormHeader title={title} subtitle={subtitle} onClose={onClose} showLogo={showLogo} />
          <div className="overflow-y-auto flex-1 px-4 py-4 sm:px-6 space-y-4">
            {children}
          </div>
        </div>
      </div>

      {/* Tablet: Slide-over Drawer (60% width, visible on md-lg) */}
      <div className="hidden md:block xl:hidden">
        {/* Background overlay */}
        <div
          className="fixed inset-0 bg-black bg-opacity-40 z-40 transition-opacity backdrop-blur-sm"
          onClick={onClose}
        />
        {/* Drawer panel */}
        <div className="fixed right-0 top-0 h-screen w-[60%] bg-white shadow-2xl z-50 flex flex-col border-l-4 border-l-[#E5D9FF]">
          <FormHeader title={title} subtitle={subtitle} onClose={onClose} showLogo={showLogo} />
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
            {children}
          </div>
        </div>
      </div>

      {/* Mobile: Fullscreen Form (visible on md and below) */}
      <div className="md:hidden">
        <div className="fixed inset-0 bg-white z-50 flex flex-col border-t-4 border-t-[#E5D9FF]">
          <FormHeader title={title} subtitle={subtitle} onClose={onClose} showLogo={showLogo} />
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

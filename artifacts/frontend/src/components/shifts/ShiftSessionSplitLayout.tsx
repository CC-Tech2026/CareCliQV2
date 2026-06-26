import type { ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";

const SPLIT_STORAGE_ID = "carecliq-shift-session-split";

type Props = {
  left: ReactNode;
  right: ReactNode;
  className?: string;
};

export function ShiftSessionSplitLayout({ left, right, className }: Props) {
  const isMobile = useIsMobile();
  const direction = isMobile ? "vertical" : "horizontal";

  return (
    <ResizablePanelGroup
      autoSaveId={SPLIT_STORAGE_ID}
      direction={direction}
      className={className ?? "min-h-0 flex-1"}
    >
      <ResizablePanel
        defaultSize={isMobile ? 52 : 55}
        minSize={isMobile ? 30 : 35}
        maxSize={isMobile ? 70 : 68}
        className="min-h-0 min-w-0"
      >
        <div className="h-full overflow-y-auto pr-1">{left}</div>
      </ResizablePanel>

      <ResizableHandle
        withHandle
        className="bg-[var(--cc-border)] data-[panel-group-direction=horizontal]:mx-1.5 data-[panel-group-direction=vertical]:my-1.5"
      />

      <ResizablePanel
        defaultSize={isMobile ? 48 : 45}
        minSize={isMobile ? 28 : 32}
        maxSize={isMobile ? 70 : 65}
        className="min-h-0 min-w-0"
      >
        <div className="h-full min-h-[280px] overflow-hidden">{right}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MeetingRecorderProvider, useMeetingRecorder } from "./MeetingRecorderContext";
import { RecordMeetingPanel, useMeetingVoiceAccess } from "./RecordMeetingPanel";
import { RecordingIndicator } from "./RecordingIndicator";

export const MEETING_PANEL = "flex w-full flex-col gap-0 p-0 sm:max-w-2xl";

function RecorderSheet() {
  const rec = useMeetingRecorder();
  // Only once the panel is open: this sits on every page, signed in or not.
  const voice = useMeetingVoiceAccess(rec.panelOpen);
  const title =
    rec.phase === "idle" ? (voice.off || rec.entry === "write" ? "Write up a meeting" : "Record a meeting")
    : rec.phase === "recording" ? (rec.paused ? "Recording paused" : "Recording")
    : rec.phase === "review" ? "Check what was found"
    : "Working on the meeting";
  return (
    <Sheet open={rec.panelOpen && !!rec.target} onOpenChange={(open) => (open ? rec.openPanel() : rec.closePanel())}>
      <SheetContent className={MEETING_PANEL}>
        <SheetHeader className="border-b border-cc-border p-5 pr-12 text-left sm:px-6">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>With {rec.target?.participantName}</SheetDescription>
        </SheetHeader>
        <RecordMeetingPanel />
      </SheetContent>
    </Sheet>
  );
}

/** Wraps the app's pages so a meeting can keep recording from any page. */
export function MeetingRecorderRoot({ children }: { children: ReactNode }) {
  return (
    <MeetingRecorderProvider renderChrome={() => (<><RecorderSheet /><RecordingIndicator /></>)}>
      {children}
    </MeetingRecorderProvider>
  );
}

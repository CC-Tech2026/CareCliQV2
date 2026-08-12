# AI Voice Dictation for Plan Meeting Capture - Implementation Summary

## Overview
Successfully implemented AI-powered voice dictation for the plan meeting capture flow in CareCliQ. Coordinators can now speak meeting conversations and have them automatically transcribed using OpenAI's Whisper API.

## Files Modified

### 1. Backend: `backend/app/api/plan_meetings.py`

**Changes:**
- Added imports: `File`, `UploadFile`, and `_build_openai_client`
- Added `TranscriptionResponse` Pydantic model for response serialization
- Added new endpoint: `POST /coordinator/plan-meetings/transcribe`

**New Endpoint: POST `/coordinator/plan-meetings/transcribe`**
- **Authentication:** Requires coordinator role (via existing `_require_coordinator`)
- **Input:** Multipart form with `audio_file` field (webm/mp4/wav blob from browser)
- **Processing:**
  - Validates file size (max 25MB - OpenAI Whisper limit)
  - Calls `openai.audio.transcriptions.create(model="whisper-1", file=audio_file)`
  - Returns transcribed text
- **Error Handling:**
  - 400: Missing audio file
  - 413: File too large (>25MB)
  - 422: Audio could not be transcribed (silent/poor audio)
  - 500: Transcription service error
- **Reuses:** `_build_openai_client()` from `ai_service.py` (respects Replit AI Integrations or direct OpenAI key)

### 2. Frontend Service: `artifacts/frontend/src/services/coordinatorService.ts`

**New Function:**
```typescript
export function transcribePlanMeetingAudio(audioBlob: Blob): Promise<{ transcript: string }> {
  const form = new FormData();
  form.append("audio_file", audioBlob, "recording.webm");
  return jsonFetch<{ transcript: string }>("/api/coordinator/plan-meetings/transcribe", {
    method: "POST",
    body: form,
  });
}
```
- Accepts audio blob from browser MediaRecorder
- Sends as FormData (no Content-Type header - browser sets it automatically)
- Returns promise resolving to `{ transcript: string }`

### 3. Frontend Component: `artifacts/frontend/src/components/coordinator/PlanMeetingCapture.tsx`

**Enhanced Step 1 (Record Meeting)**

**New State Variables:**
- `useVoiceDictation` - Toggle between voice and manual text entry
- `isRecording` - Recording state
- `elapsedTime` - Timer for recording duration
- `mediaRecorder` - MediaRecorder instance
- `transcriptLoading` - Transcription in-progress state
- `voiceNotSupported` - Device capability check

**Features Implemented:**

1. **Microphone Access**
   - Requests `navigator.mediaDevices.getUserMedia({ audio: true })`
   - Graceful error handling for denied/missing microphone
   - Fallback message for unsupported browsers

2. **Audio Recording**
   - Prefers `audio/webm;codecs=opus` format
   - Falls back to `audio/mp4` or `audio/webm`
   - Native MediaRecorder API (no external libraries)
   - Collects audio chunks on `ondataavailable`

3. **Recording UI States**
   - **Idle:** "Start dictating meeting" button
   - **Recording:** 
     - Red pulsing indicator with elapsed timer (MM:SS format)
     - "Stop & Transcribe" button
     - "Cancel" button to discard
   - **Processing:** Spinner with "Transcribing your recording..." message
   - **Complete:** Editable transcript textarea with character count

4. **Transcript Editing**
   - Textarea populated with transcript (Whisper may make errors)
   - Character count displayed
   - Buttons to:
     - "Re-record" - discard and start over
     - "Type manually" - switch to manual text entry

5. **Toggle Between Modes**
   - "Use voice dictation" button when in manual mode
   - "Type manually" button when in voice mode
   - Seamless switching, no data loss when editing

6. **Design Compliance**
   - Recording active state: `var(--cc-plum)` background
   - Recording indicator pulse: `#EF4444` red pulsing ring
   - Rounded corners: `rounded-xl` throughout
   - Typography: `font-black` labels, `text-[12px]/text-[13px]` body
   - Borders: `var(--cc-border)` color
   - Soft backgrounds: `var(--cc-soft)` for info sections

7. **Error Handling**
   - Microphone permission denied: User-friendly toast notification
   - No microphone: Shows "Not supported" message, falls back to manual entry
   - Transcription failure: Toast with retry suggestion
   - Empty transcript: Returns service error, prompts retry

8. **Accessibility & UX**
   - Timer provides real-time recording duration feedback
   - All buttons have clear labels
   - Color-coded states (red for recording, plum for actions)
   - Character count helps coordinators track progress
   - Manual fallback ensures no blockers

## Design Decisions

### 1. Native MediaRecorder API Only
- No `react-mic` or other libraries (per requirements)
- Browser support: Chrome/Edge/Firefox/Safari (iOS 14.7+)
- Lightweight, zero external dependencies

### 2. Batch Transcription (Not Live Streaming)
- Captures entire recording, transcribes on stop
- Reduces cost, improves accuracy (Whisper processes full context)
- Simpler error handling (one API call vs. streaming)

### 3. Editable Transcript
- Whisper produces ~95% accuracy, not 100%
- Coordinators review/correct errors before submission
- Ensures clinical documentation accuracy for audit trail

### 4. Coordinator-Only Access
- Reuses existing `is_coordinator_role` check
- Plan meeting capture is coordinator function
- No change to role system needed

### 5. Multipart Form Upload
- FastAPI native support via `UploadFile`
- `python-multipart` is standard FastAPI dependency (already installed)
- Browser FormData handles encoding automatically

## Workflow

1. **Coordinator opens plan meeting capture** → Step 1 defaults to voice dictation
2. **Clicks "Start dictating meeting"** → Browser requests microphone permission
3. **Speaks meeting conversation** → Recording indicator shows elapsed time
4. **Clicks "Stop & Transcribe"** → Audio blob sent to `/coordinator/plan-meetings/transcribe`
5. **Whisper transcribes** → Transcript appears in editable textarea
6. **Coordinator reviews/edits** → Character count updates in real-time
7. **Continues with other fields** → participant_priorities, observations, outcomes (manual only)
8. **Clicks "Save & get AI suggestions"** → Proceeds to Step 2 (existing AI pipeline)
9. **Step 2 consumes conversation_notes** → Extracts goals and tasks from transcript

## Testing Checklist

- [ ] Start recording, speak clearly, verify transcript accuracy
- [ ] Re-record without saving, verify audio is discarded
- [ ] Switch to manual mode, verify existing transcript is preserved
- [ ] Edit transcript, verify character count updates
- [ ] Test microphone denied error handling
- [ ] Test on Safari (iOS) fallback handling
- [ ] Verify Steps 2 & 3 consume transcript correctly
- [ ] Test with poor audio quality (Whisper error handling)
- [ ] Verify coordinator role enforcement on backend
- [ ] Confirm 25MB file size limit works

## Backward Compatibility

- Existing manual text entry fully functional
- No changes to Step 2 (AI review) or Step 3 (apply) logic
- `conversation_notes` field works identically whether from voice or manual entry
- Existing meetings unaffected
- No database schema changes required

## Future Enhancements (Out of Scope)

- Live transcription (streaming to Whisper as user speaks)
- Language selection (currently English-only, Whisper default)
- Audio pre-processing (noise reduction, voice enhancement)
- Meeting recording storage (currently not stored, only transcript)
- Transcription history/audit log
- Custom vocabulary/medical terminology hints to Whisper

## Deployment Notes

1. Ensure `python-multipart` is in `requirements.txt` (should already be there)
2. Verify OpenAI API key is configured (via Replit AI Integrations or `OPENAI_API_KEY` env var)
3. Test transcription endpoint before rolling to production
4. Monitor Whisper API costs (charged per minute of audio)
5. Consider rate limiting on transcription endpoint for abuse prevention

---

**Implementation Date:** 2026-07-02  
**Developer:** AI Assistant  
**Status:** Complete & Ready for Testing

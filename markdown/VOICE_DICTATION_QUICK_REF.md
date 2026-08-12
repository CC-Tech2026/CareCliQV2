# Voice Dictation Feature - Quick Reference

## What Was Built

Voice dictation for plan meeting capture in CareCliQ. Coordinators can speak to record meeting conversations instead of typing.

## How It Works

1. **Backend Endpoint** (`backend/app/api/plan_meetings.py`)
   - `POST /coordinator/plan-meetings/transcribe`
   - Accepts audio file (webm/mp4/wav)
   - Uses OpenAI Whisper to transcribe
   - Returns text transcript

2. **Frontend Service** (`artifacts/frontend/src/services/coordinatorService.ts`)
   - `transcribePlanMeetingAudio(audioBlob)` function
   - Sends audio as FormData
   - Returns `{ transcript: string }`

3. **Frontend Component** (`artifacts/frontend/src/components/coordinator/PlanMeetingCapture.tsx`)
   - Step 1 now has voice dictation UI
   - MediaRecorder for audio capture
   - Toggle between voice and manual text entry
   - Editable transcript with character count
   - Re-record option

## Flow Diagram

```
Coordinator opens Step 1
        ↓
    [Toggle: Voice/Manual]
        ↓
    START RECORDING (🎤 button)
        ↓
    SPEAKING (Timer running, red pulse)
        ↓
    STOP & TRANSCRIBE (button)
        ↓
    [Spinner] Transcribing...
        ↓
    Transcript appears (editable textarea)
        ↓
    [Can Re-record] OR [Edit & Continue]
        ↓
    Fill other fields manually
        ↓
    Save → Step 2 (AI review)
```

## Key Features

✅ Native browser MediaRecorder (no external libraries)  
✅ Graceful degradation (fallback to manual entry)  
✅ Editable transcript (Whisper not 100% perfect)  
✅ Character count display  
✅ Timer during recording  
✅ Re-record button  
✅ Mode toggle (voice ↔ manual)  
✅ Coordinator-only access  
✅ Error handling (microphone denied, transcription failed, etc.)  

## Testing the Feature

### Manual Test (Happy Path)
```
1. Navigate to coordinator → add plan meeting
2. In Step 1, click "Start dictating meeting"
3. Allow microphone permission
4. Speak slowly and clearly: "This is a test of the voice dictation system"
5. Click "Stop & Transcribe"
6. Wait for spinner to complete
7. Verify transcript appears and is editable
8. Fill in other fields
9. Click "Save & get AI suggestions"
10. Verify Step 2 consumes the transcript correctly
```

### Edge Cases
```
- Microphone denied: Should show error toast
- No microphone: Should show "not supported" message
- Poor audio: Whisper may return empty or garbled text
- Network timeout: 5xx error, show retry message
- File > 25MB: Should reject with 413 error
```

## Configuration

**Backend:**
- Relies on existing OpenAI client from `ai_service.py`
- Works with Replit AI Integrations OR direct OPENAI_API_KEY
- No new env vars needed

**Frontend:**
- No npm packages to install
- Uses native browser APIs
- No environment config needed

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `backend/app/api/plan_meetings.py` | +63 lines | Added transcription endpoint |
| `artifacts/frontend/src/services/coordinatorService.ts` | +8 lines | Added transcribePlanMeetingAudio function |
| `artifacts/frontend/src/components/coordinator/PlanMeetingCapture.tsx` | +280 lines | Enhanced Step 1 with voice UI |

## Performance Notes

- **API Latency:** Whisper typically takes 5-30 seconds depending on audio length
- **Audio Format:** Converts to webm/opus (smallest file size)
- **File Size Limit:** 25MB (OpenAI Whisper constraint)
- **Cost:** $0.006 per minute of audio (OpenAI pricing)

## Security & Privacy

- Coordinator role required (existing auth)
- No audio stored, only transcript saved
- Transcript encrypted at rest (via existing Supabase)
- Audio blob discarded after transcription
- Follows NDIS privacy requirements

## Troubleshooting

**Problem:** "Microphone access denied"  
**Solution:** Check browser permissions, allow microphone for this site

**Problem:** "Audio could not be transcribed"  
**Solution:** Check audio quality, speak clearly, ensure low background noise

**Problem:** Transcript is garbled or partial  
**Solution:** Re-record with clearer audio, Whisper works best with standard English accent

**Problem:** Feature not showing voice button  
**Solution:** Verify you're logged in as coordinator (not worker/admin)

---

**Feature Status:** ✅ Implemented & Ready for QA  
**Date:** 2026-07-02

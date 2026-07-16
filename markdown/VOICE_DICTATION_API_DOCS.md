# Voice Dictation API Documentation

## Endpoint: Transcribe Plan Meeting Audio

### Route
```
POST /coordinator/plan-meetings/transcribe
```

### Authentication
- **Required:** Coordinator role (via JWT in Authorization header)
- **Method:** Bearer token (existing CareCliQ auth)

### Request

**Content-Type:** `multipart/form-data`

**Form Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audio_file` | `Blob` | Yes | Audio file (webm, mp4, wav, etc.) |

**cURL Example:**
```bash
curl -X POST http://localhost:8000/api/coordinator/plan-meetings/transcribe \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "audio_file=@recording.webm"
```

**JavaScript Example:**
```javascript
const audioBlob = new Blob([audioData], { type: "audio/webm" });
const form = new FormData();
form.append("audio_file", audioBlob, "recording.webm");

const response = await fetch("/api/coordinator/plan-meetings/transcribe", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`
  },
  body: form
});

const result = await response.json();
console.log(result.transcript); // Transcribed text
```

### Response

**Success (200 OK)**
```json
{
  "transcript": "This is the transcribed text from the audio file."
}
```

**Error Responses**

| Status | Code | Description | Example |
|--------|------|-------------|---------|
| 400 | Bad Request | Missing audio file | `{"detail": "Audio file is required."}` |
| 403 | Forbidden | Not a coordinator | `{"detail": "Only support coordinators can access plan meetings."}` |
| 413 | Payload Too Large | Audio > 25MB | `{"detail": "Audio file too large. Maximum size is 25MB."}` |
| 422 | Unprocessable Entity | Audio too silent/unrecognizable | `{"detail": "Audio could not be transcribed. Please try again with clearer audio."}` |
| 500 | Internal Server Error | Whisper API failure | `{"detail": "Transcription failed. Please try again."}` |

### Constraints

| Constraint | Limit | Notes |
|-----------|-------|-------|
| Max file size | 25 MB | OpenAI Whisper constraint |
| File formats | webm, mp4, wav, etc. | Any format supported by ffmpeg |
| Audio duration | No limit | Longer audio = higher cost |
| Language | English (default) | Whisper auto-detects, works best with English |
| Response time | 5-30 seconds | Depends on audio length |

### Cost (OpenAI Whisper Pricing)
- **$0.006 per 1 minute of audio** (rounded up to nearest minute)
- Example: 2.5 min audio = 3 min charged = $0.018

### Implementation Details

**Backend Handler:**
```python
@router.post("/plan-meetings/transcribe", response_model=TranscriptionResponse)
async def transcribe_plan_meeting_audio(
    audio_file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Transcribe audio recording using OpenAI Whisper API."""
    _require_coordinator(current_user)
    
    # Validate file exists
    if not audio_file.filename:
        raise HTTPException(status_code=400, detail="Audio file is required.")
    
    # Read and validate file size (25MB limit)
    file_content = await audio_file.read()
    if len(file_content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file too large...")
    
    # Transcribe using OpenAI Whisper
    client = _build_openai_client()
    response = client.audio.transcriptions.create(
        model="whisper-1",
        file=("recording.webm", file_content),
    )
    
    transcript = response.text.strip()
    
    # Validate transcription result
    if not transcript:
        raise HTTPException(status_code=422, detail="Audio could not be transcribed...")
    
    return TranscriptionResponse(transcript=transcript)
```

**Frontend Integration:**
```typescript
// Service function
export function transcribePlanMeetingAudio(audioBlob: Blob): Promise<{ transcript: string }> {
  const form = new FormData();
  form.append("audio_file", audioBlob, "recording.webm");
  return jsonFetch<{ transcript: string }>(
    "/api/coordinator/plan-meetings/transcribe",
    { method: "POST", body: form }
  );
}

// Usage in component
const handleTranscribe = async (audioBlob: Blob) => {
  try {
    const result = await transcribePlanMeetingAudio(audioBlob);
    setForm(f => ({ ...f, conversation_notes: result.transcript }));
  } catch (err) {
    toast({ variant: "destructive", title: "Transcription failed" });
  }
};
```

### Rate Limiting Recommendations

To prevent abuse and manage costs, consider adding rate limiting:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/plan-meetings/transcribe")
@limiter.limit("5/minute")  # 5 requests per minute per IP
async def transcribe_plan_meeting_audio(...):
    ...
```

### Monitoring & Logging

**Logs Generated:**
```python
logger.info("Transcription started for user: %s, file size: %d bytes", user_id, file_size)
logger.info("Transcription complete: %d characters", len(transcript))
logger.exception("Transcription failed: %s", exc)
```

**Metrics to Track:**
- Transcription success rate (%)
- Average transcription duration (seconds)
- Average transcript length (characters)
- Error rate by type (permissions, size, API failure, etc.)
- Cost per day ($)

### Example Workflow

```
Step 1: Coordinator initiates plan meeting capture
   ↓
Step 2: Browser requests microphone permission
   ↓
Step 3: Coordinator speaks meeting notes (~2-5 minutes typical)
   ↓
Step 4: Coordinator clicks "Stop & Transcribe"
   ↓
Step 5: Client captures audio blob from MediaRecorder
   ↓
Step 6: POST /coordinator/plan-meetings/transcribe with audio_file
   ↓
Step 7: Backend validates auth, file size, format
   ↓
Step 8: Backend calls OpenAI Whisper API
   ↓
Step 9: Whisper returns transcript (takes 5-30 seconds)
   ↓
Step 10: Backend returns { transcript: "..." }
   ↓
Step 11: Frontend displays transcript in editable textarea
   ↓
Step 12: Coordinator reviews, edits, and proceeds
   ↓
Step 13: Transcript saved in conversation_notes field
   ↓
Step 14: Step 2 AI review consumes conversation_notes
```

### Debugging

**Test Endpoint Locally:**
```bash
# Generate test audio (5 seconds of silence)
ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 5 test.wav

# Transcribe it
curl -X POST http://localhost:8000/api/coordinator/plan-meetings/transcribe \
  -H "Authorization: Bearer test_token" \
  -F "audio_file=@test.wav"

# Expected: Empty transcript or very short text
```

**Common Issues:**
1. **403 Forbidden** → Check JWT token validity, user role
2. **413 Payload Too Large** → Audio file > 25MB, split into smaller chunks
3. **422 Unprocessable** → Audio is too quiet/silent, record with better microphone
4. **500 Internal Error** → Check OpenAI API key, rate limits, network connectivity

### Backwards Compatibility

- Endpoint is new, no breaking changes
- Existing manual text entry unaffected
- `conversation_notes` field accepts both manual and transcribed text
- No database migrations needed
- Existing plan meetings unaffected

---

**API Version:** 1.0  
**Last Updated:** 2026-07-02  
**Status:** Stable

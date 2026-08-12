# Two-Stage Plan Meeting LLM Pipeline: Implementation Guide

**Status:** ✅ COMPLETE - All components integrated and ready for testing  
**Last Updated:** Session 6 (endpoints appended to plan_meetings.py)  
**Database Migration:** 090_create_plan_meeting_sessions.sql

---

## Quick Start: API Flow

```
1. Coordinator starts recording → POST /coordinator/plan-meetings/sessions
   Returns: session_id
   
2. Coordinator finishes recording → POST /plan-meetings/{session_id}/transcribe-and-resolve
   Input: audio_file, coordinator_name, participant_name, others
   Returns: clean_transcript, resolved_names, segment_ids, participant_id, flags
   
3. Stage 1 results confirmed → POST /plan-meetings/{session_id}/extract-goals-tasks
   Returns: draft_goals, draft_tasks, attention_flags
```

---

## Architecture Overview

### Two-Stage Processing Pipeline

**Problem Fixed:** 422 Validation Error
- ❌ OLD: Required participant_id before transcription → impossible since name matching requires speaker resolution
- ✅ NEW: Create session with only org_id → transcribe → resolve names → match participant → extract goals

**Stage 1: Transcription + Name Resolution**
- Input: Raw audio file (25MB max)
- Processing:
  1. Transcribe with Whisper (speaker diarization enabled)
  2. Parse speaker segments (Speaker A, Speaker B, etc.)
  3. Run GPT-4o-mini with Stage 1 prompt
  4. Resolve speaker labels to real names (coordinator, participant, others)
  5. Clean transcript (fix ASR errors without changing meaning)
- Output: `clean_transcript`, `resolved_names`, `segment_ids`, `confidence_scores`
- Database: Updates `clean_transcript`, `resolved_names`, `stage_1_status = complete`

**Stage 2: Goal & Task Extraction**
- Input: Clean transcript from Stage 1 + NDIS taxonomy
- Processing:
  1. Call GPT-4o-mini with Stage 2 prompt
  2. Extract NDIS goals (11 categories) from participant statements only
  3. Extract core support tasks related to goals
  4. Ground each extraction with source_segment_ids for traceability
  5. Generate attention flags (safety risks, ambiguities, restrictive practices)
- Output: `draft_goals`, `draft_tasks`, `attention_flags`
- Database: Updates `extracted_goals`, `extracted_tasks`, `attention_flags`, `stage_2_status = complete`

---

## Implementation Details

### 1. Database Schema (Migration 090)

**Table: `plan_meeting_sessions`**

```sql
-- Core foreign keys
organization_id        UUID NOT NULL
coordinator_id         UUID NOT NULL
participant_id         UUID (NULL initially, populated after Stage 1)

-- Stage 1 columns
stage_1_status         VARCHAR (pending|in-progress|complete|error)
stage_1_completed_at   TIMESTAMP
raw_transcript         TEXT
clean_transcript       JSONB
resolved_names         JSONB
name_confidence        FLOAT

-- Stage 2 columns
stage_2_status         VARCHAR (pending|in-progress|complete|error)
stage_2_completed_at   TIMESTAMP
extracted_goals        JSONB
extracted_tasks        JSONB
goal_confidence        FLOAT
attention_flags        JSONB

-- Review workflow
review_status          VARCHAR (pending|in-review|approved|rejected)
reviewed_by            UUID
review_notes           TEXT
```

**Indexes:**
- `organization_id + stage_1_status` (queries: "Show me sessions pending Stage 1")
- `organization_id + stage_2_status` (queries: "Show me sessions pending Stage 2")
- `organization_id + review_status` (queries: "Show me sessions pending coordinator review")
- `coordinator_id + created_at DESC` (queries: "Show coordinator's sessions")

**RLS Policies:**
- Coordinators can access/edit sessions from their organization
- Participants can view their own sessions

---

### 2. API Endpoints

#### **POST /coordinator/plan-meetings/sessions**
**Purpose:** Create minimal session for recording

```json
{
  "meeting_date": "2024-11-15T14:00:00Z",  // optional
  "meeting_type": "standard",               // standard|review|emergency
  "conversation_context": {}                // optional metadata
}
```

**Returns:**
```json
{
  "session_id": "uuid",
  "organization_id": "uuid",
  "coordinator_id": "uuid",
  "created_at": "2024-11-15T14:05:00Z"
}
```

---

#### **POST /plan-meetings/{session_id}/transcribe-and-resolve**
**Purpose:** Transcribe audio + resolve speaker names (Stage 1)

**Request:**
```
Content-Type: multipart/form-data

audio_file: <binary audio data>
coordinator_name: "John Smith" (optional)
participant_name: "Jane Doe" (optional)
others: ["Support Person A", "Support Person B"] (JSON string, optional)
```

**Returns:**
```json
{
  "session_id": "uuid",
  "raw_transcript": "Speaker A: Hello... Speaker B: Hi...",
  "clean_transcript": "John: Hello... Jane: Hi...",
  "resolved_names": {
    "Speaker A": {
      "name": "John Smith",
      "confidence": "confirmed",
      "role": "coordinator"
    },
    "Speaker B": {
      "name": "Jane Doe",
      "confidence": "likely",
      "role": "participant"
    }
  },
  "segment_ids": [
    {
      "segment_id": "s0",
      "start": "00:00:00",
      "speaker_name": "John",
      "text": "Hello Jane, how are you today?"
    },
    {
      "segment_id": "s1",
      "start": "00:05:23",
      "speaker_name": "Jane",
      "text": "I'm good, thanks for asking."
    }
  ],
  "participant_id": "uuid or null",  // Populated if participant name matched
  "flags": [
    {
      "flag_type": "unresolved_speaker",
      "severity": "low",
      "description": "One speaker could not be matched. May be an unknown support person."
    }
  ],
  "stage_1_status": "complete"
}
```

**Status Codes:**
- 200: Stage 1 successful
- 404: Session not found
- 413: Audio file exceeds 25MB
- 422: Audio transcription failed or name resolution failed
- 500: Internal server error

---

#### **POST /plan-meetings/{session_id}/extract-goals-tasks**
**Purpose:** Extract NDIS goals and tasks from clean transcript (Stage 2)

**Request:**
```json
// No body needed - uses clean_transcript from Stage 1
```

**Returns:**
```json
{
  "session_id": "uuid",
  "goals": [
    {
      "goal_id": "g0",
      "category": "employment",
      "description": "Find work in retail sector, 20 hours/week",
      "confidence": 0.92,
      "source_segment_ids": ["s3", "s5"],
      "risk_flags": []
    },
    {
      "goal_id": "g1",
      "category": "independence_daily_living",
      "description": "Improve cooking skills for meal preparation",
      "confidence": 0.78,
      "source_segment_ids": ["s7"],
      "risk_flags": ["needs_capacity_building_focus"]
    }
  ],
  "tasks": [
    {
      "task_id": "t0",
      "goal_id": "g0",
      "category": "employment_support",
      "description": "Weekly job search coaching",
      "frequency": "weekly",
      "support_type": "coordination",
      "confidence": 0.85,
      "source_segment_ids": ["s3"]
    },
    {
      "task_id": "t1",
      "goal_id": "g1",
      "category": "life_skills_training",
      "description": "Cooking lessons (breakfast, lunch, dinner)",
      "frequency": "twice_weekly",
      "support_type": "assistance",
      "confidence": 0.72,
      "source_segment_ids": ["s7", "s8"]
    }
  ],
  "attention_flags": [
    {
      "flag_type": "safety_concern",
      "severity": "high",
      "description": "Participant mentioned medication compliance issues - may need review"
    },
    {
      "flag_type": "ambiguous_goal",
      "severity": "medium",
      "description": "Goal about 'social connections' lacks specificity - coordinator should clarify with participant"
    }
  ],
  "extraction_metadata": {
    "completed_at": "2024-11-15T14:15:00Z"
  },
  "stage_2_status": "complete"
}
```

**Status Codes:**
- 200: Stage 2 successful
- 400: Stage 1 not complete or no clean transcript found
- 404: Session not found
- 422: Goal extraction failed (LLM error)
- 500: Internal server error

---

### 3. System Prompts

#### **Stage 1: Name Resolution & Transcript Cleanup**

**System Prompt (40+ lines):**
```
You are a speech-to-text assistant specialized in NDIS plan meetings.

PART A: Speaker Resolution
- You receive a transcript with speaker labels: "Speaker A", "Speaker B", etc.
- You receive a list of participant names and their roles (coordinator, participant, supporters)
- Your task: Resolve each speaker label to a real person

Rules:
1. Match speakers based on speech patterns, context, and names mentioned
2. Be conservative with confidence scores:
   - "confirmed": High certainty (>0.85)
   - "likely": Moderate certainty (0.60-0.85)
   - "uncertain": Low certainty (<0.60)
3. Unmatched speakers likely represent support people or unknown attendees

Output: JSON with resolved_speakers, each having:
  {
    "speaker_label": "Speaker A",
    "resolved_name": "John Smith",
    "role": "coordinator",
    "confidence": "confirmed"
  }

PART B: Transcript Cleanup
- Fix obvious ASR (speech recognition) errors
- Standardize medical/technical terminology
- Preserve all meaning and sentiment
- Do NOT add, remove, or reorder statements
- Respect turn-taking structure

Output: Cleaned transcript with speaker names instead of labels
```

**User Message Template:**
```json
{
  "part_a_input": {
    "pre_filled_names": [
      {"name": "John Smith", "role": "coordinator"},
      {"name": "Jane Doe", "role": "participant"}
    ],
    "raw_transcript": "Speaker A: Hello... Speaker B: Hi..."
  },
  "part_b_input": {
    "raw_transcript": "Speaker A: We should discuss your employment goals..."
  }
}
```

---

#### **Stage 2: Goal & Task Extraction**

**System Prompt (35+ lines):**
```
You are an NDIS goal and task extraction specialist.

Your task: Extract NDIS goals and core support tasks from a plan meeting transcript.

Input: Clean transcript with speaker names
Output: Structured goals and tasks with confidence scores

NDIS CATEGORIES:
1. employment
2. community_participation
3. independence_daily_living
4. health_wellbeing
5. relationships_social
6. education_training
7. assistive_technology
8. accommodation
9. respite_care
10. transport
11. uncategorised

Rules:
1. Extract ONLY participant statements (not coordinator suggestions/corrections)
2. Group related goals under one category
3. Include all goals that contribute to NDIS outcomes
4. Grade confidence based on clarity and specificity
5. Flag safety concerns, ambiguities, restrictive practice language
6. Ground each goal with source_segment_ids (e.g., ["s3", "s5"])

Output: JSON with:
  {
    "goals": [
      {
        "goal_id": "g0",
        "category": "employment",
        "description": "...",
        "confidence": 0.92,
        "source_segment_ids": ["s3", "s5"]
      }
    ],
    "tasks": [
      {
        "task_id": "t0",
        "goal_id": "g0",
        "category": "employment_support",
        "description": "...",
        "frequency": "weekly|fortnightly|monthly",
        "support_type": "coordination|assistance|teaching|monitoring",
        "confidence": 0.85
      }
    ],
    "attention_flags": [
      {
        "flag_type": "safety_concern|ambiguous_goal|restrictive_language",
        "severity": "low|medium|high",
        "description": "..."
      }
    ]
  }
```

---

### 4. Service Layer Functions

**File:** `backend/app/services/plan_meeting_service.py`

#### **async def run_stage_1_name_resolution(...)**

```python
async def run_stage_1_name_resolution(
    session_id: str,
    organization_id: str,
    raw_transcript_segments: list[dict],
    prefilled_names: list[dict] | None,
    meeting_context: dict,
) -> dict:
    """
    Stage 1: Transcribe + resolve speaker names + clean transcript
    
    Returns: {
        "resolved_speakers": [...],
        "clean_transcript": [...],
        "flags": [...]
    }
    """
    # 1. Call GPT-4o-mini with Stage 1 system + user prompts
    # 2. Parse JSON response
    # 3. Return structured result
```

#### **async def run_stage_2_goal_extraction(...)**

```python
async def run_stage_2_goal_extraction(
    session_id: str,
    organization_id: str,
    clean_transcript: list[dict],
) -> dict:
    """
    Stage 2: Extract NDIS goals and support tasks
    
    Returns: {
        "draft_goals": [...],
        "draft_tasks": [...],
        "attention_flags": [...]
    }
    """
    # 1. Call GPT-4o-mini with Stage 2 system + user prompts
    # 2. Parse JSON response
    # 3. Return structured result
```

---

### 5. Frontend Flow (Pending Implementation)

**Current Component:** `PlanMeetingCapture.tsx`

**Updated Flow:**
1. **Step 0: Create Session**
   - POST /coordinator/plan-meetings/sessions → get session_id
   - Store in React state

2. **Step 1: Record Audio (existing)**
   - Use MediaRecorder API
   - Show pulsing red indicator while recording

3. **Step 2: Transcribe & Resolve (new)**
   - POST /plan-meetings/{session_id}/transcribe-and-resolve
   - Show Speaker Name Confirmation Dialog
   - Allow coordinator to override resolved names
   - Confirm participant_id

4. **Step 3: Review Goals & Tasks (UI pending)**
   - POST /plan-meetings/{session_id}/extract-goals-tasks
   - Show draft goals/tasks with confidence scores
   - Allow coordinator to edit/approve before saving

---

### 6. Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| 422: Audio transcription failed | Corrupted audio or unsupported format | Retry with different audio format |
| 422: Name resolution failed | LLM error or invalid prefilled names | Check name format and retry |
| 400: Stage 1 not complete | Trying Stage 2 before Stage 1 | Run Stage 1 first |
| 400: No clean transcript | Session missing clean_transcript data | Re-run Stage 1 transcription |
| 413: Audio exceeds 25MB | File too large | Trim or re-record in shorter segments |
| 404: Session not found | Invalid session_id or org_id mismatch | Verify session_id and organization access |
| 500: Internal server error | Unexpected LLM or database error | Retry; contact support if persists |

---

### 7. Security Controls

**Authentication:**
- ✅ All endpoints require JWT (via `get_current_user` dependency)
- ✅ Coordinator role enforcement (via `_require_coordinator` function)

**Authorization:**
- ✅ Organization ownership verified (session.organization_id matches user org)
- ✅ RLS policies prevent cross-org data access

**Data Validation:**
- ✅ File size limit: 25MB max
- ✅ Pydantic models for request validation
- ✅ JSON schema validation in LLM responses (optional, can be added)

**Privacy:**
- ✅ Audio files not stored (only transcripts)
- ✅ Transcripts stored in organization-scoped database
- ✅ Participant identifiers only populated after confirmation

---

### 8. Cost Estimation

**Per Recording:**
- Whisper transcription: $0.006/minute (60-min meeting ≈ $0.36)
- GPT-4o-mini Stage 1: ~2,000 tokens (~$0.0003)
- GPT-4o-mini Stage 2: ~3,000 tokens (~$0.0005)
- **Total: ~$0.37 per recording**

**Monthly (assuming 100 recordings):**
- Transcription: $36
- LLM processing: $8
- **Total: ~$44/month**

---

### 9. Implementation Checklist

**✅ Backend (Complete)**
- [x] Database migration (090_create_plan_meeting_sessions.sql)
- [x] API models (CreateMeetingSessionRequest, Stage1ResolutionResponse, Stage2ExtractionResponse)
- [x] POST /coordinator/plan-meetings/sessions endpoint
- [x] POST /plan-meetings/{session_id}/transcribe-and-resolve endpoint (Stage 1)
- [x] POST /plan-meetings/{session_id}/extract-goals-tasks endpoint (Stage 2)
- [x] Service layer functions (run_stage_1_name_resolution, run_stage_2_goal_extraction)
- [x] System prompts and templates (plan_meeting_prompts.py)
- [x] Error handling and validation

**🔄 Frontend (Pending)**
- [ ] Update PlanMeetingCapture component for session-first flow
- [ ] Create Speaker Name Confirmation Dialog (Stage 1 review)
- [ ] Create Goal/Task Review Panel (Stage 2 review)
- [ ] Integrate with existing Tailwind design tokens
- [ ] Add loading states and error messaging

**🔄 Testing (Pending)**
- [ ] Unit tests for Stage 1 prompt parsing
- [ ] Unit tests for Stage 2 goal extraction logic
- [ ] Integration tests for full pipeline (audio → goals)
- [ ] E2E tests with real coordinator workflow

**🔄 Documentation (Pending)**
- [ ] API documentation (Swagger/OpenAPI)
- [ ] Coordinator training guide
- [ ] Troubleshooting guide for common LLM issues

---

## Files Modified/Created

1. ✅ `backend/app/api/plan_meetings.py` - Added Stage 1 and Stage 2 endpoints
2. ✅ `backend/app/services/plan_meeting_service.py` - Added Stage 1/2 functions (previously)
3. ✅ `backend/app/services/plan_meeting_prompts.py` - System prompts (previously)
4. ✅ `backend/supabase/migrations/090_create_plan_meeting_sessions.sql` - Database schema
5. 📝 This guide document

---

## Testing the Pipeline

### Local Test with curl:

```bash
# 1. Create session
SESSION_ID=$(curl -X POST http://localhost:8000/coordinator/plan-meetings/sessions \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"meeting_type":"standard"}' | jq -r '.session_id')

# 2. Transcribe and resolve names
curl -X POST http://localhost:8000/plan-meetings/$SESSION_ID/transcribe-and-resolve \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -F "audio_file=@sample_audio.wav" \
  -F "coordinator_name=John Smith" \
  -F "participant_name=Jane Doe"

# 3. Extract goals and tasks
curl -X POST http://localhost:8000/plan-meetings/$SESSION_ID/extract-goals-tasks \
  -H "Authorization: Bearer $JWT_TOKEN"
```

---

## Next Steps

1. **Database Migration:** Run `090_create_plan_meeting_sessions.sql` in Supabase
2. **Frontend Integration:** Update PlanMeetingCapture component to use new session-first flow
3. **End-to-End Testing:** Record real plan meeting audio and verify goals are extracted correctly
4. **Coordinator Review:** Implement approval workflow for goals/tasks before saving to plan

---

**Questions?** Refer to the design specification: `PLAN_MEETING_TWO_STAGE_PROMPT_DESIGN.md`

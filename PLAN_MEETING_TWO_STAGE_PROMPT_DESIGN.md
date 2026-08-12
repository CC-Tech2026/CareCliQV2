# Two-Stage Prompt Design for Plan Meeting Transcript Processing

## Problem: Fix 422 Error

**Current Issue:** Session creation requires `participant_id` upfront, but name matching should happen AFTER transcription, not before.

**Solution:** Create sessions with minimal metadata first, then resolve names post-transcription.

---

## Architecture Overview

```
Recording Session Created
  ├─ org_id, coordinator_id, timestamp ONLY
  └─ Returns: session_id (no participant_id yet)
       ↓
Audio Uploaded + Transcribed
  ├─ Raw speaker-diarized transcript (e.g. "Speaker A: ...", "Speaker B: ...")
  └─ Returns: raw_transcript + session_id
       ↓
STAGE 1: Name Resolution & Transcript Cleanup
  ├─ Input:
  │   ├─ raw_transcript (speaker-diarized)
  │   ├─ optional pre-filled names (hint, not requirement)
  │   ├─ coordinator_name, participant_name, others expected
  │   └─ conversation_context (meeting_type, participant_priorities, etc.)
  ├─ Process: LLM resolves speakers to real people
  └─ Output:
      ├─ clean_transcript (attributed: "Coordinator John: ...", "Participant Sarah: ...")
      ├─ resolved_names { "Speaker A": "Coordinator John", "Speaker B": "Participant Sarah" }
      ├─ segment_ids (each segment preserved for citation)
      └─ confidence scores per resolution
       ↓
Session Updated + Participant Matched
  ├─ Sets: participant_id, coordinator_id (if different speaker)
  ├─ Sets: clean_transcript, resolved_names, segment_ids
  └─ Sets: status = "transcript_ready" (ready for Stage 2)
       ↓
STAGE 2: Goal & Task Extraction
  ├─ Input:
  │   ├─ clean_transcript (from Stage 1)
  │   ├─ segment_ids (for citation)
  │   ├─ participant_priorities, coordinator_observations (if provided)
  │   └─ agreed_outcomes (if provided)
  ├─ Process: LLM extracts draft goals/tasks
  └─ Output:
      ├─ goals: [{title, description, segment_id_refs, priority}]
      ├─ tasks: [{title, description, segment_id_refs, due_date, owner}]
      └─ metadata: {extraction_date, confidence_scores}
       ↓
Coordinator Review Gate
  ├─ Human reviews goals/tasks
  ├─ Accepts/rejects/modifies
  └─ Nothing is auto-published
```

---

## Database Schema Changes

### New Table: `plan_meeting_sessions`

```sql
CREATE TABLE plan_meeting_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  coordinator_id UUID NOT NULL,
  participant_id UUID,  -- NULL until Stage 1 resolution
  
  -- Recording metadata
  created_at TIMESTAMP DEFAULT now(),
  recorded_at TIMESTAMP,
  
  -- Transcription
  raw_transcript TEXT,
  transcript_language VARCHAR(10) DEFAULT 'en-AU',
  
  -- Stage 1: Name Resolution
  stage_1_status VARCHAR(50),  -- 'pending', 'complete', 'failed'
  clean_transcript TEXT,
  resolved_names JSONB,  -- { "Speaker A": "Coordinator John", "Speaker B": "Participant Sarah" }
  segment_ids JSONB,     -- [{ id: "seg_1", speaker: "Coordinator", timestamp: "00:15" }, ...]
  name_confidence FLOAT,
  stage_1_completed_at TIMESTAMP,
  stage_1_error TEXT,
  
  -- Stage 2: Goal & Task Extraction
  stage_2_status VARCHAR(50),  -- 'pending', 'complete', 'failed'
  extracted_goals JSONB,
  extracted_tasks JSONB,
  goal_confidence FLOAT,
  stage_2_completed_at TIMESTAMP,
  stage_2_error TEXT,
  
  -- Coordinator review
  review_status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
  reviewed_by UUID,
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  
  -- Final metadata
  meeting_date DATE,
  meeting_type VARCHAR(50),  -- 'check_in', 'plan_review', 'crisis', etc.
  attendees JSONB DEFAULT '[]',
  conversation_context JSONB,  -- participant_priorities, coordinator_observations, agreed_outcomes
  
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (coordinator_id) REFERENCES profiles(id),
  FOREIGN KEY (participant_id) REFERENCES participants(id),
  FOREIGN KEY (reviewed_by) REFERENCES profiles(id)
);
```

---

## API Endpoints

### 1. Create Recording Session (Minimal)

**Endpoint:** `POST /coordinator/plan-meetings/sessions`

**Request:**
```json
{
  "meeting_date": "2026-07-02",
  "meeting_type": "check_in",
  "conversation_context": {
    "participant_priorities": "Work experience, community connection",
    "coordinator_observations": "Client seems motivated today",
    "agreed_outcomes": null
  }
}
```

**Response:**
```json
{
  "session_id": "sess_abc123",
  "created_at": "2026-07-02T14:30:00Z"
}
```

**Changes:**
- ❌ Remove `participant_id` requirement
- ✅ Only require `organization_id` (from JWT), `coordinator_id` (from JWT), timestamp
- ✅ Optional: meeting_date, meeting_type, conversation_context (hints for Stage 1)

---

### 2. Transcribe & Stage 1 (Name Resolution)

**Endpoint:** `POST /coordinator/plan-meetings/{session_id}/transcribe-and-resolve`

**Request:**
```json
{
  "audio_file": <binary>,
  "pre_filled_names": {
    "coordinator_name": "John Smith",
    "participant_name": "Sarah Jones",
    "others": ["Support Worker Mike"]
  }
}
```

**Process:**
1. Transcribe audio (ASR with diarization: "Speaker A: ...", "Speaker B: ...")
2. Run **Stage 1 Prompt** to resolve names
3. Update session with clean_transcript, resolved_names, segment_ids
4. Try to match participant_id using resolved names
5. Return results

**Response:**
```json
{
  "session_id": "sess_abc123",
  "raw_transcript": "Speaker A: Hello Sarah, how are you today?\nSpeaker B: I'm good, thanks John...",
  "clean_transcript": "Coordinator John: Hello Sarah...\nParticipant Sarah: I'm good...",
  "resolved_names": {
    "Speaker A": {
      "name": "John Smith",
      "role": "coordinator",
      "confidence": 0.95,
      "sources": ["self_introduction", "name_match"]
    },
    "Speaker B": {
      "name": "Sarah Jones",
      "role": "participant",
      "confidence": 0.92,
      "sources": ["context", "pre_filled_match"]
    }
  },
  "segment_ids": [
    { "id": "seg_001", "speaker": "Coordinator", "timestamp": "00:00", "duration": 3 },
    { "id": "seg_002", "speaker": "Participant", "timestamp": "00:03", "duration": 5 }
  ],
  "participant_id": "part_xyz789",  -- matched if possible
  "stage_1_status": "complete"
}
```

---

### 3. Extract Goals & Tasks (Stage 2)

**Endpoint:** `POST /coordinator/plan-meetings/{session_id}/extract-goals-tasks`

**Prerequisites:**
- Session must have `stage_1_status = 'complete'`
- Must have clean_transcript and segment_ids

**Request:**
```json
{
  "include_context_fields": ["participant_priorities", "coordinator_observations"]
}
```

**Process:**
1. Run **Stage 2 Prompt** with clean_transcript + segment_ids + context
2. Extract goals and tasks with segment citations
3. Store results
4. Return for coordinator review

**Response:**
```json
{
  "session_id": "sess_abc123",
  "goals": [
    {
      "id": "goal_001",
      "title": "Develop work readiness skills",
      "description": "Build job interview and workplace communication skills through supported work placement",
      "segment_refs": ["seg_015", "seg_023"],  -- segments discussing work goals
      "segment_quotes": [
        "I'd like to get back into work next month",
        "Maybe start with 2 days a week to build confidence"
      ],
      "priority": "high",
      "category": "employment",
      "confidence": 0.91
    }
  ],
  "tasks": [
    {
      "id": "task_001",
      "title": "Contact employment support provider",
      "description": "Reach out to John's employment network to discuss suitable placements",
      "segment_refs": ["seg_023"],
      "owner": "coordinator",
      "due_date": "2026-07-09",
      "status": "pending",
      "confidence": 0.88
    }
  ],
  "extraction_metadata": {
    "completed_at": "2026-07-02T14:45:00Z",
    "segment_coverage": 0.87,  -- % of transcript segments cited
    "avg_confidence": 0.89
  },
  "stage_2_status": "complete"
}
```

---

## Stage 1 Prompt: Name Resolution & Transcript Cleanup

```markdown
# Name Resolution & Transcript Cleanup

You are a hearing support assistant specializing in resolving speaker identities in conversations.

## Input Data
- **Raw transcript** (with diarization labels):
  {raw_transcript}

- **Pre-filled names** (optional, use as hints, NOT requirements):
  - Coordinator: {coordinator_name}
  - Participant: {participant_name}
  - Others: {others}

- **Context clues**:
  - Meeting type: {meeting_type}
  - Expected speakers: {expected_roles}
  - Participant priorities: {participant_priorities}

## Your Task

1. **Identify each speaker**:
   - Use self-introductions ("My name is...")
   - Use context (who initiates, typical conversation patterns)
   - Use pre-filled hints if they match context
   - Default to role-based labels if no name emerges

2. **Attribute each segment**:
   - Assign real name or role label (e.g., "Coordinator John", "Participant Sarah")
   - Assign role (coordinator/participant/support_worker/other)
   - Preserve original timestamps and speaker IDs

3. **Clean up transcript**:
   - Fix common speech-to-text errors (context-aware)
   - Normalize filler words (um, uh, like) unless significant
   - Keep medical/technical terms as-is
   - Preserve emotional tone and emphasis

4. **Create segment IDs**:
   - Number each utterance: seg_001, seg_002, ...
   - Include timestamp (mm:ss) and duration
   - Note speaker and role for each

## Output Format (JSON)

{
  "cleaned_transcript": "Coordinator John: Hi Sarah, how are you today?\nParticipant Sarah: ...",
  "speaker_resolutions": {
    "Speaker A": {
      "name": "John Smith",
      "role": "coordinator",
      "confidence": 0.95,
      "resolution_sources": ["self_introduction", "pre_filled_match"]
    },
    "Speaker B": {
      "name": "Sarah Jones",
      "role": "participant",
      "confidence": 0.92,
      "resolution_sources": ["context", "meeting_role"]
    }
  },
  "segments": [
    {
      "id": "seg_001",
      "speaker_name": "Coordinator John",
      "speaker_role": "coordinator",
      "timestamp_start": "00:00",
      "duration_seconds": 3,
      "text": "Hi Sarah, how are you today?"
    },
    {
      "id": "seg_002",
      "speaker_name": "Participant Sarah",
      "speaker_role": "participant",
      "timestamp_start": "00:03",
      "duration_seconds": 5,
      "text": "I'm good, thanks for asking..."
    }
  ],
  "resolution_confidence_avg": 0.935,
  "ambiguities": []  -- note any unresolved speakers or confusion
}
```

---

## Stage 2 Prompt: Goal & Task Extraction

```markdown
# Goal & Task Extraction from Plan Meeting Transcript

You are an NDIS plan coordinator assistant specializing in extracting actionable goals and tasks from participant conversations.

## Input Data
- **Clean transcript** (with speaker attribution):
  {clean_transcript}

- **Segment references** (for citation):
  {segment_refs}

- **Context** (optional):
  - Participant priorities: {participant_priorities}
  - Coordinator observations: {coordinator_observations}
  - Agreed outcomes: {agreed_outcomes}

- **Participant details**:
  - Name: {participant_name}
  - Current goals: {current_goals}

## Your Task

1. **Extract explicit goals**:
   - Listen for clear statements: "I want to...", "I'd like to...", "My goal is..."
   - Identify NDIS goal categories (employment, community, independence, health, etc.)
   - Cite transcript segments (seg_XXX) where goal was mentioned

2. **Extract actionable tasks**:
   - Who should do it (coordinator, participant, support worker, etc.)
   - What exactly (specific, measurable action)
   - When (timeline, due date, frequency)
   - Why (link to stated goal)

3. **Maintain lineage**:
   - Every goal/task must cite one or more transcript segments
   - Include direct quotes where participant speaks their goal
   - Note confidence based on clarity and specificity

4. **Categorize & prioritize**:
   - NDIS categories: Employment, Community, Independence, Health, Relationships, etc.
   - Priority: High (participant passionate), Medium, Low
   - Status: Pending (new), In Progress, Completed, Blocked

## Output Format (JSON)

{
  "goals": [
    {
      "id": "goal_001",
      "title": "Develop work readiness skills",
      "description": "Build job interview and workplace communication skills through supported work placement",
      "category": "employment",
      "priority": "high",
      "segment_refs": ["seg_015", "seg_023"],
      "participant_quotes": [
        "I'd like to get back into work next month",
        "Maybe start with 2 days a week to build confidence"
      ],
      "confidence": 0.91,
      "status": "pending"
    }
  ],
  "tasks": [
    {
      "id": "task_001",
      "title": "Contact employment support provider",
      "description": "Call employment network to discuss job placements suited to Sarah's experience and confidence level",
      "related_goal": "goal_001",
      "owner": "coordinator",
      "timeline": "This week",
      "due_date": "2026-07-09",
      "segment_refs": ["seg_023"],
      "confidence": 0.88,
      "status": "pending"
    }
  ],
  "coverage_analysis": {
    "total_segments": 47,
    "segments_cited": 41,
    "coverage_percent": 87,
    "uncited_segments_reason": "Small talk, administrative chat"
  },
  "extraction_confidence_avg": 0.89
}
```

---

## Implementation Roadmap

### Phase 1: Fix the 422 Error (Immediate)
1. Create `plan_meeting_sessions` table
2. Update `/coordinator/plan-meetings/sessions` POST to accept minimal fields
3. Remove `participant_id` requirement from session creation
4. Make endpoint return `session_id`

### Phase 2: Stage 1 Integration
1. Implement `POST /coordinator/plan-meetings/{session_id}/transcribe-and-resolve`
2. Call Whisper ASR (existing)
3. Call OpenAI with Stage 1 prompt
4. Parse resolution + store in session
5. Attempt participant matching via name resolution

### Phase 3: Stage 2 Integration
1. Implement `POST /coordinator/plan-meetings/{session_id}/extract-goals-tasks`
2. Call OpenAI with Stage 2 prompt
3. Store goals/tasks with segment citations
4. Prepare for coordinator review

### Phase 4: UI Integration
1. Update PlanMeetingCapture component to use new session flow
2. Create Stage 1 review UI (confirm/edit resolved names)
3. Create Stage 2 review UI (accept/reject goals/tasks)
4. Add confidence indicators and ambiguity flags

---

## Error Handling

| Status | Action |
|--------|--------|
| Stage 1 fails | Show error + raw transcript, let coordinator manually edit |
| Stage 2 fails | Show error + clean transcript, let coordinator draft goals manually |
| Name resolution ambiguous | Show confidence scores, ask coordinator to clarify |
| Participant not found | Ask coordinator to select/create participant |

---

## Security & Access Control

- ✅ Coordinator-only access to all endpoints
- ✅ Organization isolation (can only see own org sessions)
- ✅ Session audit trail (who reviewed, when, changes made)
- ✅ No auto-publication (manual review gate always required)

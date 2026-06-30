# AI Suggestions Integration Guide

## Overview

The AI suggestion system provides coordinators with real-time field recommendations based on participant history and context. This guide shows how to integrate suggestions into existing forms and text inputs.

## Architecture

### Backend Components

**File:** `backend/app/api/ai_suggestions.py`

Endpoints:
- `POST /api/ai/suggestions` - Get suggestions for a field
- `GET /api/ai/context/{participant_id}` - Get participant context

### Frontend Components

**Hook:** `artifacts/frontend/src/hooks/useAISuggestions.ts`
- Manages fetching and caching suggestions
- Handles debouncing (1 second)
- Returns suggestions, context, loading/error states

**Component:** `artifacts/frontend/src/components/ai/AISuggestionPanel.tsx`
- Displays 1-5 ranked suggestions
- Shows confidence scores
- Displays supporting context
- Accept/reject buttons

**Wrapper:** `artifacts/frontend/src/components/ai/AITextInputField.tsx`
- Complete text input with inline suggestions
- Ready to drop into forms
- Handles all state management

## Supported Field Types

```
task_completion_notes    - Summary of completed task
goal_description         - Goal definition with criteria
task_name               - Task title
shift_notes             - Shift briefing notes
evidence_notes          - Evidence documentation
incident_report         - Incident narrative
activities_performed    - Session activity summary
outcomes                - Expected vs actual outcomes
progress_toward_goals   - Goal progress update
```

## Integration Patterns

### Pattern 1: Using AITextInputField (Recommended)

**Best for:** New forms or components with no existing input field

```tsx
import { AITextInputField } from '@/components/ai/AITextInputField'

function TaskForm({ participant }) {
  const [taskName, setTaskName] = useState('')
  const [taskDescription, setTaskDescription] = useState('')

  return (
    <form>
      {/* Simple text input with AI suggestions */}
      <AITextInputField
        label="Task Name"
        fieldType="task_name"
        participantId={participant.id}
        value={taskName}
        onChange={setTaskName}
        placeholder="Enter task name..."
        required
      />

      {/* Multi-line textarea with suggestions */}
      <AITextInputField
        label="Task Description"
        fieldType="task_description"
        participantId={participant.id}
        value={taskDescription}
        onChange={setTaskDescription}
        placeholder="Describe what needs to be done..."
        rows={5}
        required
      />
    </form>
  )
}
```

### Pattern 2: Manual Integration (For Existing Inputs)

**Best for:** Modifying existing input components

```tsx
import { useAISuggestions } from '@/hooks/useAISuggestions'
import { AISuggestionPanel } from '@/components/ai/AISuggestionPanel'

function MyCustomForm({ participant }) {
  const [completionNotes, setCompletionNotes] = useState('')

  // Get suggestions
  const { suggestions, loading, context, hasContent } = useAISuggestions(
    'task_completion_notes',
    participant.id,
    completionNotes,
    true // enabled
  )

  const handleAcceptSuggestion = (suggestion) => {
    setCompletionNotes(suggestion.text)
  }

  return (
    <div>
      {/* Your existing textarea */}
      <textarea
        value={completionNotes}
        onChange={(e) => setCompletionNotes(e.target.value)}
        placeholder="What was accomplished?"
      />

      {/* Add suggestion panel below textarea */}
      {hasContent && (
        <div className="mt-4">
          <AISuggestionPanel
            suggestions={suggestions}
            context={context}
            loading={loading}
            error={null}
            fieldType="task_completion_notes"
            onAccept={handleAcceptSuggestion}
            onReject={() => {}} // Just close suggestions
          />
        </div>
      )}
    </div>
  )
}
```

## Integration Checklist

### Task Completion Form
- [ ] `completion_notes` field → `task_completion_notes`
- [ ] `evidence_notes` field → `evidence_notes`
- [ ] Show participant context at top of form

### Shift Task Creation
- [ ] `task_name` field → `task_name`
- [ ] `task_description` field → `task_description`
- [ ] Show goal context

### Session Notes
- [ ] `activities_performed` → `activities_performed`
- [ ] `outcomes` → `outcomes`
- [ ] `progress_toward_goals` → `progress_toward_goals`

### Goal Setting
- [ ] `goal_title` → `task_name` (reuse pattern)
- [ ] `goal_description` → `goal_description`
- [ ] Show success criteria

### Incident Reporting
- [ ] `incident_narrative` → `incident_report`
- [ ] Show risk history

## UX Guidelines

### Display Rules

1. **Show Suggestions When:**
   - User has typed at least 3 characters
   - Suggestions are fetched successfully
   - Participant has sufficient history (≥3 sessions)

2. **Hide Suggestions When:**
   - Field is empty
   - Loading (show spinner instead)
   - Error occurred
   - Participant has no history

3. **Show Context When:**
   - Suggestions panel is visible
   - Participant has goals, completions, or health flags
   - Always above suggestion list

### Interaction Patterns

1. **Accept Suggestion:**
   - User clicks "Accept" button on suggestion card
   - Field value is replaced with suggestion text
   - Suggestions panel remains visible
   - User can accept multiple times

2. **Reject Suggestion:**
   - User clicks "Decline" on individual suggestion
   - That suggestion is hidden
   - Other suggestions remain visible
   - OR click outside to close all

3. **Confidence Scores:**
   - Green badge (≥80%) = High confidence
   - Blue badge (60-80%) = Medium confidence
   - Yellow badge (<60%) = Lower confidence

## Example: TaskCompletionModal Integration

```tsx
import { AITextInputField } from '@/components/ai/AITextInputField'

export function TaskCompletionModal({
  task,
  participant,
  onComplete,
}) {
  const [completionNotes, setCompletionNotes] = useState('')
  const [evidenceNotes, setEvidenceNotes] = useState('')
  const [evidenceType, setEvidenceType] = useState('photo')

  const handleSubmit = async (e) => {
    e.preventDefault()
    await onComplete({
      task_id: task.id,
      completion_notes: completionNotes,
      evidence_notes: evidenceNotes,
      evidence_type: evidenceType,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Task Info */}
      <div className="bg-blue-50 p-4 rounded">
        <h3 className="font-bold">{task.task_name}</h3>
        <p className="text-sm text-gray-600">{participant.full_name}</p>
      </div>

      {/* AI-enabled fields */}
      <AITextInputField
        label="Completion Summary"
        fieldType="task_completion_notes"
        participantId={participant.id}
        value={completionNotes}
        onChange={setCompletionNotes}
        placeholder="What was accomplished?"
        rows={4}
        required
      />

      <AITextInputField
        label="Evidence Notes"
        fieldType="evidence_notes"
        participantId={participant.id}
        value={evidenceNotes}
        onChange={setEvidenceNotes}
        placeholder="Additional details or observations..."
        rows={3}
      />

      {/* Evidence Type (no AI suggestions) */}
      <div>
        <label className="block text-sm font-medium mb-2">Evidence Type</label>
        <select
          value={evidenceType}
          onChange={(e) => setEvidenceType(e.target.value)}
          className="w-full px-4 py-2 border rounded"
        >
          <option value="photo">Photo</option>
          <option value="video">Video</option>
          <option value="document">Document</option>
          <option value="signature">Signature</option>
        </select>
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <button type="button" className="px-4 py-2 border rounded">
          Cancel
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-blue-600 text-white rounded"
        >
          Complete Task
        </button>
      </div>
    </form>
  )
}
```

## API Response Examples

### Suggestion Response

```json
{
  "field_type": "task_completion_notes",
  "participant_id": "uuid-123",
  "suggestions": [
    {
      "text": "Supported James with morning routine. Toileting and shower assistance provided. James cooperative and engaged throughout. All hygiene tasks completed successfully.",
      "confidence": 0.92,
      "reasoning": "Highly similar to previous morning support sessions from past 2 weeks",
      "highlights": [
        {
          "source_type": "task_completion",
          "source_date": "2024-01-15",
          "source_content": "Supported James with morning routine...",
          "similarity_score": 0.94
        }
      ]
    }
  ],
  "user_message": "Generated 3 suggestions based on 8 similar past events"
}
```

### Context Response

```json
{
  "participant_id": "uuid-123",
  "name": "James Smith",
  "recent_goals": [
    {
      "id": "goal-1",
      "title": "Develop independent living skills",
      "category": "community",
      "created_at": "2024-01-01"
    }
  ],
  "recent_completions": [
    {
      "id": "comp-1",
      "date": "2024-01-18",
      "duration_minutes": 60,
      "status": "completed",
      "evidence_type": "photo"
    }
  ],
  "incident_summary": "1 incident reported in past 30 days",
  "support_category": "community",
  "compliance_score": 0.87,
  "health_flags": ["Allergies: Penicillin", "⚠️ Recent incident: Property damage"]
}
```

## Customization

### Change Debounce Delay

Edit `artifacts/frontend/src/hooks/useAISuggestions.ts`:

```tsx
const DEBOUNCE_DELAY = 1000 // ms - change this value
```

### Change Cache Expiry

```tsx
const CACHE_EXPIRY = 5 * 60 * 1000 // 5 minutes - change this
```

### Disable Suggestions for Field Type

```tsx
const { suggestions, loading } = useAISuggestions(
  fieldType,
  participantId,
  value,
  false // disabled
)
```

### Show More/Fewer Suggestions

Edit backend endpoint in `ai_suggestions.py`:

```python
raw_suggestions = await ai_svc.generate_suggestions(
    ...,
    num_suggestions=5,  # Change this
)
```

## Troubleshooting

### Suggestions Not Appearing

1. Check backend is running: `http://localhost:8000/docs`
2. Verify participant has history (at least 3 sessions)
3. Check browser console for API errors
4. Verify `participantId` is provided and valid

### Suggestions Are Generic

1. Ensure migrations M071, M072, M073 are applied to Supabase
2. Check RAG context is being retrieved (check browser network tab)
3. Verify session_embeddings table has data

### Slow Response

1. Increase debounce delay (defaults to 1s)
2. Check OpenAI API status (api.openai.com)
3. Verify participant context is in cache

## Security Notes

- All API calls require authentication (Bearer token)
- Org isolation enforced (can't access other org participants)
- Participant access verified before returning suggestions
- Compliance scores used only for context, not filtering

## Performance Optimization

1. **Caching:** Suggestions cached per field/participant/value (5 min TTL)
2. **Debouncing:** 1 second delay before API call on value change
3. **Lazy Loading:** Context fetched once per field, reused for all changes
4. **Memory:** AbortController cancels pending requests on unmount

## Next Steps

1. **Integration:** Add to TaskCompletionModal, TaskCreationForm, SessionNotesForm
2. **Testing:** Test with different participant histories
3. **Refinement:** Collect coordinator feedback on suggestion quality
4. **Expansion:** Add suggestion types (field validation hints, compliance warnings)
5. **Analytics:** Track which suggestions are accepted/rejected

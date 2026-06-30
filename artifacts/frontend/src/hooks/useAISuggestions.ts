/**
 * useAISuggestions Hook
 * 
 * Handles fetching AI suggestions for text input fields.
 * Features:
 * - Debounced fetching to avoid excessive API calls
 * - Error handling & retry logic
 * - Caching for same field/participant combo
 * - Loading states
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { jsonFetch } from '../services/http'

export interface ContextHighlight {
  source_type: 'session_note' | 'task_completion' | 'goal' | 'incident'
  source_date: string
  source_content: string
  similarity_score?: number
}

export interface Suggestion {
  text: string
  confidence: number
  reasoning: string
  highlights: ContextHighlight[]
}

export interface SuggestionResponse {
  field_type: string
  participant_id: string
  suggestions: Suggestion[]
  user_message: string
}

export interface ParticipantContext {
  participant_id: string
  name: string
  recent_goals: Array<{
    id: string
    title: string
    category?: string
    created_at: string
  }>
  recent_completions: Array<{
    id: string
    date: string
    duration_minutes?: number
    status: string
    evidence_type?: string
  }>
  incident_summary?: string
  support_category?: string
  compliance_score: number
  health_flags: string[]
}

export interface UseAISuggestionsState {
  suggestions: Suggestion[]
  loading: boolean
  error: string | null
  context: ParticipantContext | null
  hasContent: boolean
}

const DEBOUNCE_DELAY = 1000 // ms
const CACHE_EXPIRY = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  data: SuggestionResponse
  timestamp: number
}

const suggestionCache = new Map<string, CacheEntry>()

/**
 * Hook for fetching and managing AI suggestions
 * 
 * @param fieldType - Type of field (task_completion_notes, goal_description, etc)
 * @param participantId - UUID of participant
 * @param currentValue - Current text value in field (for context)
 * @param enabled - Whether to enable fetching (default: true)
 * @returns Suggestions, context, loading/error states
 */
export const useAISuggestions = (
  fieldType: string,
  participantId: string | null,
  currentValue: string = '',
  enabled: boolean = true
): UseAISuggestionsState => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<ParticipantContext | null>(null)

  const debounceTimer = useRef<NodeJS.Timeout | null>(null)

  // Generate cache key
  const cacheKey = `${participantId}:${fieldType}:${currentValue.slice(0, 50)}`

  // Fetch suggestions
  const fetchSuggestions = useCallback(async () => {
    if (!participantId || !enabled) {
      return
    }

    // Check cache
    const cached = suggestionCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY) {
      setSuggestions(cached.data.suggestions)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await jsonFetch<SuggestionResponse>(
        `/api/ai/suggestions?participant_id=${participantId}&field_type=${fieldType}&current_value=${encodeURIComponent(currentValue)}`
      )

      if (response) {
        setSuggestions(response.suggestions)
        suggestionCache.set(cacheKey, {
          data: response,
          timestamp: Date.now(),
        })
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch suggestions'
      )
    } finally {
      setLoading(false)
    }
  }, [participantId, fieldType, currentValue, enabled, cacheKey])

  // Fetch context
  const fetchContext = useCallback(async () => {
    if (!participantId || !enabled) {
      return
    }

    try {
      const response = await jsonFetch<ParticipantContext>(
        `/api/ai/context/${participantId}`
      )
      if (response) {
        setContext(response)
      }
    } catch (err) {
      console.error('Failed to fetch participant context:', err)
      // Don't set error for context - suggestions still work without it
    }
  }, [participantId, enabled])

  // Debounced fetch on value change
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    if (!enabled || !participantId) {
      setSuggestions([])
      return
    }

    debounceTimer.current = setTimeout(() => {
      fetchSuggestions()
    }, DEBOUNCE_DELAY)

    // Fetch context once on mount/change
    if (!context) {
      fetchContext()
    }

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [fieldType, participantId, currentValue, enabled, fetchSuggestions, fetchContext, context])

  return {
    suggestions,
    loading,
    error,
    context,
    hasContent: suggestions.length > 0,
  }
}

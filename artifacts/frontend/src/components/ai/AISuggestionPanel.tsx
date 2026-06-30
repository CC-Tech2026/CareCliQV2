/**
 * AISuggestionPanel Component
 * 
 * Displays AI-generated suggestions inline with participant context.
 * Features:
 * - Multiple suggestions with confidence scores
 * - Context highlighting from participant history
 * - Accept/reject actions
 * - Loading and error states
 * - Responsive design (no scrolling needed)
 */

import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Check,
  X,
  AlertCircle,
  Lightbulb,
  Calendar,
  Activity,
  AlertTriangle,
} from 'lucide-react'
import { type Suggestion, type ContextHighlight, type ParticipantContext } from '../../hooks/useAISuggestions'

export interface AISuggestionPanelProps {
  suggestions: Suggestion[]
  context: ParticipantContext | null
  loading: boolean
  error: string | null
  fieldType: string
  onAccept: (suggestion: Suggestion) => void
  onReject: () => void
  className?: string
}

/**
 * Helper to get icon for context source type
 */
const getSourceIcon = (sourceType: string) => {
  switch (sourceType) {
    case 'session_note':
      return <Activity className="w-4 h-4" />
    case 'task_completion':
      return <Check className="w-4 h-4" />
    case 'goal':
      return <Lightbulb className="w-4 h-4" />
    case 'incident':
      return <AlertTriangle className="w-4 h-4" />
    default:
      return <Calendar className="w-4 h-4" />
  }
}

/**
 * Helper to get badge color based on confidence
 */
const getConfidenceBadgeColor = (confidence: number): string => {
  if (confidence >= 0.8) return 'bg-green-100 text-green-800'
  if (confidence >= 0.6) return 'bg-blue-100 text-blue-800'
  return 'bg-yellow-100 text-yellow-800'
}

/**
 * ContextHighlightBadge Component
 */
const ContextHighlightBadge: React.FC<{ highlight: ContextHighlight }> = ({
  highlight,
}) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-gray-50 border border-gray-200 rounded p-2 text-sm">
      <div
        className="flex items-start gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="text-gray-500 mt-0.5">{getSourceIcon(highlight.source_type)}</div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-700 capitalize">
            {highlight.source_type.replace(/_/g, ' ')}
          </div>
          <div className="text-gray-500 text-xs">{highlight.source_date}</div>
          {highlight.similarity_score && (
            <div className="text-xs text-gray-600 mt-1">
              Match: {(highlight.similarity_score * 100).toFixed(0)}%
            </div>
          )}
        </div>
        <div className="text-gray-400">
          {expanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-gray-200 pl-6">
          <p className="text-gray-700 line-clamp-3">
            {highlight.source_content}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * SuggestionCard Component
 */
const SuggestionCard: React.FC<{
  suggestion: Suggestion
  index: number
  onAccept: (suggestion: Suggestion) => void
  onReject: () => void
}> = ({ suggestion, index, onAccept, onReject }) => {
  const [expanded, setExpanded] = useState(index === 0)

  return (
    <div className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        {/* Rank Badge */}
        <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">
          {index + 1}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Confidence Badge */}
          <div className="mb-2">
            <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getConfidenceBadgeColor(suggestion.confidence)}`}>
              {(suggestion.confidence * 100).toFixed(0)}% confident
            </span>
          </div>

          {/* Suggestion Text */}
          <p
            className="text-gray-900 font-medium cursor-pointer hover:text-blue-600 transition-colors line-clamp-2"
            onClick={() => setExpanded(!expanded)}
          >
            {suggestion.text}
          </p>

          {/* Reasoning */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <div className="mb-3">
                <p className="text-sm text-gray-600 mb-2">
                  <span className="font-medium">Why:</span> {suggestion.reasoning}
                </p>
              </div>

              {/* Context Highlights */}
              {suggestion.highlights.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Supporting Context:
                  </p>
                  <div className="space-y-2">
                    {suggestion.highlights.map((highlight, i) => (
                      <ContextHighlightBadge
                        key={i}
                        highlight={highlight}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => onAccept(suggestion)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 transition-colors text-sm font-medium"
                >
                  <Check className="w-4 h-4" />
                  Accept
                </button>
                <button
                  onClick={onReject}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-50 text-gray-700 border border-gray-200 rounded hover:bg-gray-100 transition-colors text-sm font-medium"
                >
                  <X className="w-4 h-4" />
                  Decline
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Expand Icon */}
        {!expanded && (
          <div className="flex-shrink-0 text-gray-400">
            <ChevronDown className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * ParticipantContextSummary Component
 */
const ParticipantContextSummary: React.FC<{ context: ParticipantContext }> = ({
  context,
}) => {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
      <div className="flex gap-4 flex-wrap text-sm">
        {/* Goals */}
        {context.recent_goals.length > 0 && (
          <div>
            <span className="font-medium text-blue-900">
              {context.recent_goals.length} active goals
            </span>
          </div>
        )}

        {/* Completions */}
        {context.recent_completions.length > 0 && (
          <div>
            <span className="font-medium text-blue-900">
              {context.recent_completions.length} recent completions
            </span>
          </div>
        )}

        {/* Compliance */}
        <div>
          <span className="font-medium text-blue-900">
            {(context.compliance_score * 100).toFixed(0)}% compliance
          </span>
        </div>

        {/* Health Flags */}
        {context.health_flags.length > 0 && (
          <div className="flex items-center gap-1 text-orange-700">
            <AlertCircle className="w-4 h-4" />
            <span className="font-medium">{context.health_flags.length} flags</span>
          </div>
        )}
      </div>

      {/* Health Flags Expanded */}
      {context.health_flags.length > 0 && (
        <div className="mt-2 pt-2 border-t border-blue-200">
          <div className="space-y-1">
            {context.health_flags.map((flag, i) => (
              <div key={i} className="text-xs text-blue-800 flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>{flag}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Main AISuggestionPanel Component
 */
export const AISuggestionPanel: React.FC<AISuggestionPanelProps> = ({
  suggestions,
  context,
  loading,
  error,
  fieldType,
  onAccept,
  onReject,
  className = '',
}) => {
  if (loading) {
    return (
      <div className={`bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-4 ${className}`}>
        <div className="flex items-center gap-3 text-indigo-700">
          <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-700 rounded-full animate-spin" />
          <span className="text-sm font-semibold">Analyzing participant history...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-xl p-4 ${className}`}>
        <div className="flex items-start gap-2 text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold">Could not generate suggestions</p>
            <p className="text-xs text-red-600 mt-1">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (suggestions.length === 0) {
    return (
      <div className={`bg-gradient-to-r from-indigo-50 to-blue-50 border border-dashed border-indigo-300 rounded-xl p-4 ${className}`}>
        <div className="flex items-center gap-3 text-indigo-600">
          <Lightbulb className="w-5 h-5 text-indigo-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold">Start typing to get AI suggestions</p>
            <p className="text-xs text-indigo-500 mt-1">Based on participant's goals and history</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 text-indigo-700">
        <Lightbulb className="w-5 h-5 text-indigo-500" />
        <span className="text-sm font-bold">
          AI Suggestions • {suggestions.length} option{suggestions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Context Summary */}
      {context && (
        <ParticipantContextSummary context={context} />
      )}

      {/* Suggestions List */}
      <div className="space-y-3">
        {suggestions.map((suggestion, index) => (
          <SuggestionCard
            key={index}
            suggestion={suggestion}
            index={index}
            onAccept={onAccept}
            onReject={onReject}
          />
        ))}
      </div>
    </div>
  )
}

export default AISuggestionPanel

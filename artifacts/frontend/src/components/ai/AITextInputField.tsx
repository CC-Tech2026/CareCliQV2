/**
 * AITextInputField Component
 * 
 * Text input with inline AI suggestions.
 * Handles:
 * - Debounced suggestion fetching
 * - Accepting/rejecting suggestions
 * - Participant context display
 * - Loading and error states
 * 
 * Usage Example:
 * <AITextInputField
 *   label="Task Description"
 *   fieldType="task_description"
 *   participantId={participant.id}
 *   value={taskDescription}
 *   onChange={setTaskDescription}
 *   placeholder="Describe the task..."
 *   required
 * />
 */

import React, { useCallback } from 'react'
import { useAISuggestions, type Suggestion } from '../../hooks/useAISuggestions'
import { AISuggestionPanel } from './AISuggestionPanel'

export interface AITextInputFieldProps {
  /** Field label for display */
  label: string
  /** Field type for suggestion generation */
  fieldType: string
  /** Participant ID for context */
  participantId: string | null
  /** Current field value */
  value: string
  /** Callback on value change */
  onChange: (value: string) => void
  /** Input placeholder */
  placeholder?: string
  /** Whether field is required */
  required?: boolean
  /** Whether to show suggestions */
  showSuggestions?: boolean
  /** Additional CSS classes */
  className?: string
  /** Error message to display */
  error?: string
  /** Disabled state */
  disabled?: boolean
  /** Min rows for textarea (if multi-line) */
  rows?: number
}

export const AITextInputField: React.FC<AITextInputFieldProps> = ({
  label,
  fieldType,
  participantId,
  value,
  onChange,
  placeholder = '',
  required = false,
  showSuggestions = true,
  className = '',
  error,
  disabled = false,
  rows = 3,
}) => {
  // Fetch suggestions
  const { suggestions, loading, context, hasContent } = useAISuggestions(
    fieldType,
    participantId,
    value,
    showSuggestions && !!participantId
  )

  // Handle accepting a suggestion
  const handleAcceptSuggestion = useCallback(
    (suggestion: Suggestion) => {
      onChange(suggestion.text)
    },
    [onChange]
  )

  // Handle rejecting all suggestions
  const handleRejectSuggestions = useCallback(() => {
    // Just hide them - user continues editing
  }, [])

  const isMultiline = rows > 1

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Label */}
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {/* Input Field */}
      {isMultiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          rows={rows}
          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 ${
            error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'
          }`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 ${
            error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'
          }`}
        />
      )}

      {/* Error Message */}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* AI Suggestions Panel - Always show */}
      {participantId && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <AISuggestionPanel
            suggestions={suggestions}
            context={context}
            loading={loading}
            error={null}
            fieldType={fieldType}
            onAccept={handleAcceptSuggestion}
            onReject={handleRejectSuggestions}
            className="mt-3"
          />
        </div>
      )}
    </div>
  )
}

export default AITextInputField

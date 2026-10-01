"""A finished shift's note: the session's legal record (English translation,
else the note as submitted), else the plain notes older sessions used.
sessions.legal_record_text is never stored, so reading it showed no note."""
from __future__ import annotations

from backend.app.services.shift_verification_service import session_note_text


def test_translation_wins_over_the_submitted_note():
    session = {"translated_english_note": "Went shopping.", "compliance_input_text": "Fuimos de compras."}
    assert session_note_text(session) == "Went shopping."


def test_submitted_note_when_no_translation_was_needed():
    session = {"translated_english_note": None, "compliance_input_text": "  Walked to the park.  ", "notes": "old"}
    assert session_note_text(session) == "Walked to the park."


def test_older_sessions_fall_back_to_notes():
    assert session_note_text({"compliance_input_text": "", "notes": "Cooked lunch together."}) == "Cooked lunch together."


def test_no_note_at_all():
    assert session_note_text({"legal_record_text": None, "notes": "   "}) is None
    assert session_note_text(None) is None

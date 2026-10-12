"""Byte sizes for the Documents & Audit Vault's folders.

Most vault documents are rendered to PDF on download rather than stored, so
the only true size is the size of what that download produces. Each
document is rendered once in the background and its size recorded (in
public.vault_document_sizes, migration 241, with an in-process copy so this
still works where the migration isn't applied yet), keyed by a fingerprint of
the record so a changed document is measured again.

`folder_sizes` never blocks on rendering: it returns what's known now, how
many documents are still being measured, and starts measuring the rest.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

from . import vault_service as vs
from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

TABLE = "vault_document_sizes"
_PERSIST_EVERY = 10
# A document that couldn't be rendered (a dropped connection, a stored file
# that's gone) counts as 0 bytes and is tried again after this long. Failures
# are never written to the table, so a passing network blip can't stick.
RETRY_FAILED_AFTER_SECONDS = 600.0
# A document whose stored file is missing won't fix itself in ten minutes;
# check it again daily rather than on every visit.
RETRY_MISSING_AFTER_SECONDS = 86400.0

# (org_id, category, document_id) -> (fingerprint, size_bytes)
_memory: dict[tuple[str, str, str], tuple[str, int]] = {}
_memory_lock = threading.Lock()
# (org_id, category, document_id) -> (monotonic time it failed, whether its file is missing)
_failed: dict[tuple[str, str, str], tuple[float, bool]] = {}
_measuring: set[str] = set()
_measuring_lock = threading.Lock()
# One background renderer per process: measuring is a one-off catch-up and
# must not compete with real downloads for CPU.
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vault-size")
_table_missing = False


def _fingerprint(doc: vs.VaultDocument) -> str:
    """Changes when anything that shapes the rendered file changes."""
    return "|".join(str(doc.get(k) or "") for k in ("status", "date", "title", "detail", "version"))


def _is_missing_table(exc: Exception) -> bool:
    text = str(exc)
    return TABLE in text and ("does not exist" in text or "PGRST205" in text or "schema cache" in text)


def _load_recorded(org_id: str) -> dict[tuple[str, str], tuple[str, int]]:
    global _table_missing
    recorded: dict[tuple[str, str], tuple[str, int]] = {}
    if not _table_missing:
        try:
            rows = (
                get_supabase_admin()
                .table(TABLE)
                .select("category, document_id, fingerprint, size_bytes")
                .eq("organization_id", org_id)
                .execute()
            ).data or []
            for row in rows:
                recorded[(row["category"], str(row["document_id"]))] = (row["fingerprint"], int(row["size_bytes"]))
        except Exception as exc:
            if _is_missing_table(exc):
                # Migration 241 not applied here yet: keep sizes in memory.
                _table_missing = True
                logger.info("vault_document_sizes not migrated, keeping sizes in memory")
            else:
                logger.warning("Couldn't read vault document sizes for %s: %s", org_id, exc)
    with _memory_lock:
        for (org, category, doc_id), value in _memory.items():
            if org == org_id:
                recorded[(category, doc_id)] = value
    return recorded


def _render_size(org_id: str, category: str, document_id: str) -> int:
    """Size of the file a download of this document produces."""
    if category.startswith(vs.CUSTOM_FOLDER_PREFIX):
        _, data = vs._render_custom_folder_file(org_id, vs._custom_folder_id(category), document_id)
    elif category in vs.GOVERNANCE_FOLDER_KEYS:
        _, data = vs._render_governance_file(org_id, category, document_id)
    else:
        renderer = vs._RECORD_RENDERERS.get(category)
        if renderer is None:
            raise LookupError(f"No renderer for {category}")
        _, data = renderer(org_id, document_id, None)
    return len(data)


def _persist(org_id: str, rows: list[dict[str, Any]]) -> None:
    if not rows or _table_missing:
        return
    try:
        get_supabase_admin().table(TABLE).upsert(rows, on_conflict="organization_id,category,document_id").execute()
    except Exception as exc:
        logger.warning("Couldn't record vault document sizes for %s: %s", org_id, exc)


def _measure(org_id: str, items: list[tuple[str, str, str]]) -> None:
    """Render each (category, document_id, fingerprint) once and record its size."""
    batch: list[dict[str, Any]] = []
    try:
        for category, document_id, fingerprint in items:
            key = (org_id, category, document_id)
            try:
                size = _render_size(org_id, category, document_id)
            except Exception as exc:
                missing = getattr(exc, "status_code", None) == 404
                logger.info("Vault size: couldn't render %s/%s, will retry: %s", category, document_id, exc)
                with _memory_lock:
                    _failed[key] = (time.monotonic(), missing)
                continue
            with _memory_lock:
                _memory[key] = (fingerprint, size)
                _failed.pop(key, None)
            batch.append({
                "organization_id": org_id,
                "category": category,
                "document_id": document_id,
                "fingerprint": fingerprint,
                "size_bytes": size,
                "measured_at": datetime.now(timezone.utc).isoformat(),
            })
            if len(batch) >= _PERSIST_EVERY:
                _persist(org_id, batch)
                batch = []
        _persist(org_id, batch)
    finally:
        with _measuring_lock:
            _measuring.discard(org_id)


def _start_measuring(org_id: str, items: list[tuple[str, str, str]]) -> None:
    with _measuring_lock:
        if org_id in _measuring:
            return
        _measuring.add(org_id)
    _executor.submit(_measure, org_id, items)


def _tally() -> dict[str, int]:
    # unavailable: listed in the vault but its stored file is gone, so it
    # can't be opened, downloaded or measured.
    return {"bytes": 0, "pending": 0, "files": 0, "unavailable": 0}


def _add(tally: dict[str, int], size: int | None, unavailable: bool = False) -> None:
    tally["files"] += 1
    if unavailable:
        tally["unavailable"] += 1
    if size is None:
        tally["pending"] += 1
    elif size > 0:
        tally["bytes"] += size


def folder_sizes(org_id: str) -> dict[str, Any]:
    """Total bytes per flat folder, per organised folder and subfolder, and
    per person folder, plus how many documents are still being measured."""
    all_docs = vs._load_all_category_docs(org_id)
    recorded = _load_recorded(org_id)
    now = time.monotonic()
    with _memory_lock:
        # (category, doc_id) -> whether its stored file is missing
        recently_failed = {
            (category, doc_id): missing
            for (org, category, doc_id), (failed_at, missing) in _failed.items()
            if org == org_id
            and now - failed_at < (RETRY_MISSING_AFTER_SECONDS if missing else RETRY_FAILED_AFTER_SECONDS)
        }

    folders: dict[str, dict[str, int]] = {}
    tree: dict[str, dict[str, Any]] = {}
    people: dict[str, dict[str, dict[str, Any]]] = {}
    to_measure: list[tuple[str, str, str]] = []
    total = _tally()

    for category, docs in all_docs.items():
        folder = folders.setdefault(category, _tally())
        for doc in docs:
            doc_id = str(doc["id"])
            fingerprint = _fingerprint(doc)
            known = recorded.get((category, doc_id))
            size = known[1] if known and known[0] == fingerprint else None
            unavailable = False
            if size is None and (category, doc_id) in recently_failed:
                size = 0  # couldn't be rendered just now; retried later
                unavailable = recently_failed[(category, doc_id)]
            elif size is None:
                to_measure.append((category, doc_id, fingerprint))
            _add(folder, size, unavailable)
            _add(total, size, unavailable)

            if category.startswith(vs.CUSTOM_FOLDER_PREFIX):
                continue
            placement = vs._tree_placement(doc)
            if not placement:
                continue
            top, sub = placement
            top_entry = tree.setdefault(top, {**_tally(), "subfolders": {}})
            _add(top_entry, size, unavailable)
            _add(top_entry["subfolders"].setdefault(sub, _tally()), size, unavailable)
            if top in vs.TREE_PERSON_TYPES:
                person = people.setdefault(top, {}).setdefault(vs._tree_person_key(doc), {**_tally(), "subfolders": {}})
                _add(person, size, unavailable)
                _add(person["subfolders"].setdefault(sub, _tally()), size, unavailable)

    if to_measure:
        _start_measuring(org_id, to_measure)

    return {
        "total": total,
        "pending": total["pending"],
        "folders": folders,
        "tree": tree,
        "people": people,
    }

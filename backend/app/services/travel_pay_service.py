"""Paying approved travel claims with wages.

A worker claims travel for a shift (travel_expense_service), the office
approves it, and it's paid in the worker's next pay:

- Kilometres are a vehicle allowance: the kilometres and the allowance at
  the organisation's rate per km.
- Fares (bus, train, tram, ferry, parking...) are a reimbursement of what
  the worker spent.

They reach the pay one of three ways, whichever the organisation uses:
- The Payroll page's export (Excel or CSV) has a column for each, and the
  office marks them paid once the pay run is done.
- Xero Payroll: the kilometres go on the draft timesheet under a per-km pay
  item, the fares onto the payslip in the draft pay run as a reimbursement
  (xero_payroll_service).
- Employment Hero: each claim becomes an expense request, paid in the next
  pay run (employment_hero_service).

Either way a claim ends up "paid", with how (paid_via) and the payroll
system's reference, and its submission is paid once all of it is.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)

# What the Payroll page reads per claim (only columns every database has).
COLUMNS = "id, shift_id, worker_id, status, expense_type, claimed_km, calculated_km, amount_cents, submission_batch_id"

PAID_VIA = ("payroll_export", "xero_payroll", "employment_hero", "manual")
KM = "km"
FARES = "fares"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _missing_column(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not exist" in msg or "schema cache" in msg or "pgrst204" in msg


def kind_of(expense: dict) -> str:
    """Kilometres (a vehicle allowance) or fares (a reimbursement)."""
    kind = expense.get("expense_type")
    if kind:
        return KM if kind == "mileage" else FARES
    return KM if (expense.get("claimed_km") is not None or expense.get("calculated_km") is not None) else FARES


def km_of(expense: dict) -> float:
    km = expense.get("claimed_km") if expense.get("claimed_km") is not None else expense.get("calculated_km")
    return float(km or 0)


def payable(expense: dict) -> bool:
    return expense.get("status") in ("approved", "paid")


def by_shift(expenses: Iterable[dict]) -> dict[str, dict]:
    """Approved and paid travel per shift: kilometres and their allowance,
    fares, the claim ids of each kind, and how many aren't paid yet."""
    out: dict[str, dict] = defaultdict(lambda: {
        "km": 0.0, "km_cents": 0, "fares_cents": 0, "km_ids": [], "fares_ids": [], "unpaid": 0,
    })
    for e in expenses:
        if not payable(e) or not e.get("shift_id"):
            continue
        row = out[str(e["shift_id"])]
        cents = int(e.get("amount_cents") or 0)
        if kind_of(e) == KM:
            row["km"] += km_of(e)
            row["km_cents"] += cents
            if e.get("id"):
                row["km_ids"].append(str(e["id"]))
        else:
            row["fares_cents"] += cents
            if e.get("id"):
                row["fares_ids"].append(str(e["id"]))
        if e.get("status") == "approved":
            row["unpaid"] += 1
    return dict(out)


def claims_in(shifts: Iterable[dict], kind: Optional[str] = None) -> list[str]:
    """Claim ids on Payroll page shifts (payroll_export_service.period), of
    one kind or both."""
    ids: list[str] = []
    for s in shifts:
        claims = s.get("travel_claims") or {}
        for k in ((kind,) if kind else (KM, FARES)):
            ids.extend(claims.get(k) or [])
    return ids


def mark_paid(org_id: str, expense_ids: Iterable[str], via: str, reference: Optional[str] = None) -> int:
    """Approved claims are paid. Returns how many changed; claims already
    paid (or not approved) are left alone."""
    ids = sorted({str(i) for i in expense_ids if i})
    if not ids or via not in PAID_VIA:
        return 0
    db = get_supabase_admin()
    now = _now_iso()
    body: dict[str, Any] = {"status": "paid", "paid_at": now, "updated_at": now,
                            "paid_via": via, "payroll_reference": (reference or None), "payroll_error": None}
    changed: list[dict] = []
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        query = lambda b: (db.table("shift_travel_expenses").update(b).eq("organization_id", org_id)  # noqa: E731
                           .eq("status", "approved").in_("id", chunk).execute())
        try:
            changed += query(body).data or []
        except Exception as exc:
            if not _missing_column(exc):
                raise
            # Migration 267 not applied yet: still mark them paid.
            changed += query({k: v for k, v in body.items() if k in ("status", "paid_at", "updated_at")}).data or []
    _settle_submissions(org_id, {str(r["submission_batch_id"]) for r in changed if r.get("submission_batch_id")})
    return len(changed)


def note_error(org_id: str, expense_ids: Iterable[str], message: str) -> None:
    """Why these claims couldn't be sent to payroll (shown to the office)."""
    ids = sorted({str(i) for i in expense_ids if i})
    if not ids:
        return
    try:
        (get_supabase_admin().table("shift_travel_expenses").update({"payroll_error": message[:500]})
         .eq("organization_id", org_id).in_("id", ids).execute())
    except Exception as exc:
        if not _missing_column(exc):
            logger.warning("travel payroll error not saved: %s", exc)


def _settle_submissions(org_id: str, batch_ids: set[str]) -> None:
    """A submission is paid once every claim in it is paid (or rejected)."""
    if not batch_ids:
        return
    db = get_supabase_admin()
    rows = (db.table("shift_travel_expenses").select("submission_batch_id, status")
            .eq("organization_id", org_id).in_("submission_batch_id", sorted(batch_ids)).execute()).data or []
    states: dict[str, set[str]] = defaultdict(set)
    for r in rows:
        states[str(r["submission_batch_id"])].add(str(r.get("status")))
    done = [b for b, s in states.items() if "paid" in s and s <= {"paid", "rejected"}]
    if done:
        (db.table("travel_expense_submissions").update({"status": "paid", "actioned_at": _now_iso()})
         .eq("organization_id", org_id).in_("id", done).execute())


def to_pay(org_id: str, limit: int = 200) -> list[dict]:
    """Approved claims not paid yet, newest first, with the worker's name:
    what the office still owes, for the Travel claims page."""
    db = get_supabase_admin()
    try:
        rows = (db.table("shift_travel_expenses").select("*").eq("organization_id", org_id)
                .eq("status", "approved").order("approved_at", desc=True).limit(limit).execute()).data or []
    except Exception as exc:
        if _missing_column(exc):
            return []
        raise
    return _with_names(org_id, rows)


def recently_paid(org_id: str, limit: int = 30) -> list[dict]:
    db = get_supabase_admin()
    try:
        rows = (db.table("shift_travel_expenses").select("*").eq("organization_id", org_id)
                .eq("status", "paid").order("paid_at", desc=True).limit(limit).execute()).data or []
    except Exception as exc:
        if _missing_column(exc):
            return []
        raise
    return _with_names(org_id, rows)


def _with_names(org_id: str, rows: list[dict]) -> list[dict]:
    ids = sorted({str(r["worker_id"]) for r in rows if r.get("worker_id")})
    names: dict[str, str] = {}
    if ids:
        users = (get_supabase_admin().table("users").select("id, full_name").in_("id", ids).execute()).data or []
        names = {str(u["id"]): u.get("full_name") or "Worker" for u in users}
    return [{
        "id": r["id"], "shift_id": r.get("shift_id"), "worker_id": r.get("worker_id"),
        "worker_name": names.get(str(r.get("worker_id")), "Worker"),
        "kind": kind_of(r), "km": km_of(r) if kind_of(r) == KM else None,
        "transit_type": r.get("transit_type"), "amount_cents": int(r.get("amount_cents") or 0),
        "approved_at": r.get("approved_at"), "paid_at": r.get("paid_at"),
        "paid_via": r.get("paid_via"), "payroll_error": r.get("payroll_error"),
    } for r in rows]


def worker_claims(worker_id: str, org_id: str, limit: int = 30) -> list[dict]:
    """A worker's sent claims, newest first, and where each one is: waiting
    for approval, approved (paid in the next pay), paid, or not approved."""
    try:
        rows = (get_supabase_admin().table("shift_travel_expenses").select("*")
                .eq("organization_id", org_id).eq("worker_id", worker_id).neq("status", "draft")
                .order("submitted_at", desc=True).limit(limit).execute()).data or []
    except Exception as exc:
        if _missing_column(exc):
            return []
        raise
    return [{
        "id": r["id"], "shift_id": r.get("shift_id"), "status": r.get("status"), "kind": kind_of(r),
        "km": km_of(r) if kind_of(r) == KM else None, "transit_type": r.get("transit_type"),
        "amount_cents": int(r.get("amount_cents") or 0), "submitted_at": r.get("submitted_at"),
        "approved_at": r.get("approved_at"), "paid_at": r.get("paid_at"),
        "rejection_reason": r.get("rejection_reason"),
    } for r in rows]

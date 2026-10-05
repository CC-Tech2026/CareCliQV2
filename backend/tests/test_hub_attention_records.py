from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.app.api import hub


@pytest.mark.asyncio
async def test_credentials_keep_each_affected_worker_and_record(monkeypatch):
    rows = [
        {"id": "credential-1", "user_id": "worker-1", "credential_type": "First aid", "expiry_date": "2026-10-01", "status": "valid"},
        {"id": "credential-2", "user_id": "worker-2", "credential_type": "First aid", "expiry_date": "2026-10-10", "status": "valid"},
    ]
    credentials = MagicMock()
    credentials.select.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=rows)
    users = MagicMock()
    users.select.return_value.in_.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[{"id": "worker-1", "full_name": "Worker One"}, {"id": "worker-2", "full_name": "Worker Two"}])
    client = MagicMock()
    client.table.side_effect = lambda table: credentials if table == "credentials" else users
    monkeypatch.setattr(hub, "get_supabase_admin", lambda: client)
    monkeypatch.setattr(hub, "_get_org_id", lambda _: "org-1")
    monkeypatch.setattr(hub, "has_org_wide_access", lambda _: True)
    monkeypatch.setattr(hub, "app_today", lambda: date(2026, 10, 5))
    monkeypatch.setattr(hub, "_incident_clock_alerts", AsyncMock(return_value=[]))
    monkeypatch.setattr(hub, "_invoice_aging_alerts", AsyncMock(return_value=[]))
    alerts = await hub.get_compliance_alerts({})
    assert len(alerts) == 2
    assert {(a["credential_id"], a["worker_id"]) for a in alerts} == {("credential-1", "worker-1"), ("credential-2", "worker-2")}
    assert "Expired on" in next(a for a in alerts if a["worker_id"] == "worker-1")["detail"]


@pytest.mark.asyncio
async def test_overdue_invoice_carries_record_id(monkeypatch):
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value = SimpleNamespace(data=[{"id": "invoice-1", "due_date": "2026-10-01", "total_cents": 10000, "recipient_name": "Test participant"}])
    monkeypatch.setattr(hub, "get_supabase_admin", lambda: client)
    monkeypatch.setattr(hub, "app_today", lambda: date(2026, 10, 5))
    alerts = await hub._invoice_aging_alerts("org-1")
    assert alerts[0]["invoice_id"] == "invoice-1"

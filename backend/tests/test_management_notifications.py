from unittest.mock import MagicMock, patch
import pytest
from fastapi import HTTPException
from backend.app.api import coordinator

@pytest.mark.asyncio
@pytest.mark.parametrize('role', ['support_coordinator', 'managing_director'])
async def test_management_notification_read_stays_in_organisation(role):
    db = MagicMock()
    query = db.table.return_value.select.return_value
    query.eq.return_value = query
    query.order.return_value = query
    query.limit.return_value = query
    query.execute.return_value.data = []
    with patch.object(coordinator, 'get_supabase_admin', return_value=db):
        result = await coordinator.get_coordinator_notifications(limit=80, unread_only=False, current_user={'role': role, 'organization_id': 'org-1'})
    assert result == []
    query.eq.assert_any_call('organization_id', 'org-1')

@pytest.mark.asyncio
async def test_worker_cannot_read_management_notifications():
    with patch.object(coordinator, 'get_supabase_admin') as db:
        with pytest.raises(HTTPException) as error:
            await coordinator.get_coordinator_notifications(limit=80, unread_only=False, current_user={'role': 'support_worker', 'organization_id': 'org-1'})
        assert error.value.status_code == 403
        db.assert_not_called()

@pytest.mark.asyncio
async def test_director_mark_read_stays_in_organisation():
    db = MagicMock()
    query = db.table.return_value.update.return_value
    query.eq.return_value = query
    with patch.object(coordinator, 'get_supabase_admin', return_value=db):
        await coordinator.mark_coordinator_notification_read('alert-1', {'role': 'managing_director', 'organization_id': 'org-1'})
    query.eq.assert_any_call('organization_id', 'org-1')
    query.eq.assert_any_call('id', 'alert-1')

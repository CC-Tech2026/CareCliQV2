from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from backend.app.api.billing import get_invoice_activity


@pytest.mark.asyncio
async def test_invoice_activity_checks_access_before_querying_audit():
    with patch('backend.app.api.billing.billing_service.get_invoice', new_callable=AsyncMock) as get_invoice, patch('backend.app.api.billing.audit_service.get_entity_audit_trail', new_callable=AsyncMock) as trail:
        get_invoice.side_effect = HTTPException(status_code=404, detail='Invoice not found.')
        with pytest.raises(HTTPException):
            await get_invoice_activity('other-org-invoice', {'organization_id': 'org-1'})
        trail.assert_not_awaited()


@pytest.mark.asyncio
async def test_invoice_activity_uses_verified_org_and_omits_snapshots():
    with patch('backend.app.api.billing.billing_service.get_invoice', new_callable=AsyncMock) as get_invoice, patch('backend.app.api.billing.audit_service.get_entity_audit_trail', new_callable=AsyncMock) as trail:
        get_invoice.return_value = {'id': 'inv-1', 'organization_id': 'org-1'}
        trail.return_value = [{'id': 'event-1', 'action_type': 'invoice.created', 'actor_name': 'Coordinator', 'created_at': '2026-09-01', 'before_state': {'private': True}}]
        result = await get_invoice_activity('inv-1', {'organization_id': 'org-1'})
        trail.assert_awaited_once_with('invoice', 'inv-1', organization_id='org-1')
        assert result[0]['actor_name'] == 'Coordinator'
        assert 'before_state' not in result[0]

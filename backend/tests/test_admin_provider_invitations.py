from unittest.mock import MagicMock, patch
import pytest
from fastapi import HTTPException
from backend.app.api import admin

@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['list', 'create', 'resend'])
async def test_provider_invitations_require_super_admin(action):
    with pytest.raises(HTTPException) as exc:
        if action == 'list':
            await admin.list_provider_invitations({'role': 'managing_director'})
        elif action == 'create':
            await admin.create_provider_account(admin.ProviderAccountCreate(organization_name='Example', email='owner@example.com'), {'role': 'support_coordinator'})
        else:
            await admin.resend_provider_invitation('invite-1', {'role': 'support_worker'})
    assert exc.value.status_code == 403

@pytest.mark.asyncio
async def test_existing_account_rejected_before_creating_org():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{'id': 'user-1'}]
    with patch.object(admin, 'get_supabase_admin', return_value=db):
        with pytest.raises(HTTPException) as exc:
            await admin.create_provider_account(admin.ProviderAccountCreate(organization_name='Example', email='owner@example.com'), {'role': 'super_admin'})
    assert exc.value.status_code == 409
    db.table.return_value.insert.assert_not_called()

@pytest.mark.asyncio
async def test_accepted_invitation_cannot_be_resent():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{'accepted_at': '2026-01-01'}]
    with patch.object(admin, 'get_supabase_admin', return_value=db):
        with pytest.raises(HTTPException) as exc:
            await admin.resend_provider_invitation('invite-1', {'role': 'super_admin'})
    assert exc.value.status_code == 409

@pytest.mark.asyncio
async def test_create_provider_links_existing_acceptance_flow():
    db = MagicMock()
    users = MagicMock()
    users.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    invites = MagicMock()
    invites.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value.data = []
    invites.insert.return_value.execute.return_value.data = [{'id': 'inv-1', 'token': 'secure-token', 'email': 'owner@example.com'}]
    orgs = MagicMock()
    orgs.insert.return_value.execute.return_value.data = [{'organization_id': 'org-1'}]
    db.table.side_effect = lambda name: {'users': users, 'invitations': invites, 'organizations': orgs}[name]
    with patch.object(admin, 'get_supabase_admin', return_value=db), patch('backend.app.api.invitations._generate_short_code', return_value='123456'), patch.object(admin, 'queue_email_job', return_value={'status': 'not_configured', 'message': 'Configure SMTP'}):
        result = await admin.create_provider_account(admin.ProviderAccountCreate(organization_name='Example', email='OWNER@example.com'), {'role': 'super_admin'})
    assert result['organization_id'] == 'org-1'
    assert result['invite_url'].endswith('/accept-invite?token=secure-token')
    assert result['email_delivery']['status'] == 'not_configured'
    payload = invites.insert.call_args.args[0]
    assert payload['role'] == 'managing_director'
    assert payload['email'] == 'owner@example.com'
    assert len(payload['token']) == 64


from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from backend.app.api import coordinator

MD = {"id": "md-1", "role": "managing_director", "organization_id": "org-1"}


@pytest.mark.asyncio
async def test_director_can_read_award_classifications():
    db = MagicMock()
    db.table.return_value.select.return_value.is_.return_value.order.return_value.execute.return_value.data = [{"id": "award-1"}]
    with patch.object(coordinator, "get_supabase_admin", return_value=db):
        assert await coordinator.list_award_classifications(MD) == [{"id": "award-1"}]


@pytest.mark.asyncio
async def test_director_classification_update_rejects_worker_outside_organisation():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value.data = None
    with patch.object(coordinator, "get_supabase_admin", return_value=db):
        with pytest.raises(HTTPException) as error:
            await coordinator.assign_classification("outside-worker", coordinator.AssignClassificationBody(classification_id="award-1"), MD)
    assert error.value.status_code == 404
    db.table.return_value.update.assert_not_called()


@pytest.mark.asyncio
async def test_director_pay_preview_rejects_shift_outside_organisation():
    with patch.object(coordinator.shift_service, "get_shift_by_id", return_value={"organization_id": "other-org"}):
        with pytest.raises(HTTPException) as error:
            await coordinator.shift_pay_preview("outside-shift", MD)
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_worker_cannot_read_award_administration():
    with pytest.raises(HTTPException) as error:
        await coordinator.list_award_classifications({**MD, "role": "support_worker"})
    assert error.value.status_code == 403

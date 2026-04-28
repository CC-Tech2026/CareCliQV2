from fastapi import APIRouter, HTTPException
from typing import List
from ..schemas.participant import ParticipantCreate, ParticipantUpdate
from ..services import participant_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/participants", tags=["participants"])


@router.get("")
async def list_participants():
    participants = await participant_service.get_all_participants()
    return participants


@router.post("", status_code=201)
async def create_participant(body: ParticipantCreate):
    try:
        participant = await participant_service.create_participant(body)
        return participant
    except Exception as e:
        logger.error(f"Error creating participant: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/dashboard-stats")
async def dashboard_stats():
    stats = await participant_service.get_dashboard_stats()
    return stats


@router.get("/{participant_id}")
async def get_participant(participant_id: str):
    participant = await participant_service.get_participant_by_id(participant_id)
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    return participant


@router.patch("/{participant_id}")
async def update_participant(participant_id: str, body: ParticipantUpdate):
    updated = await participant_service.update_participant(participant_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Participant not found")
    return updated


@router.delete("/{participant_id}", status_code=204)
async def delete_participant(participant_id: str):
    await participant_service.delete_participant(participant_id)

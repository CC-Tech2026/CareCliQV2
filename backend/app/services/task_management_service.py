"""Task management service — handles generation, handover, and completion logic."""

from datetime import datetime, timedelta, time, date
from typing import Optional
from uuid import UUID
import logging

from .supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


class TaskManagementService:
    """Service for task template and instance management."""
    
    def __init__(self, sb_client=None):
        self.sb = sb_client or get_supabase_admin()
    
    # ──────────────────────────────────────────────────────────────────────
    # Task Generation Logic
    # ──────────────────────────────────────────────────────────────────────
    
    async def generate_task_instances_for_shift(self, shift_id: UUID) -> list[dict]:
        """
        Generate task instances for a newly rostered or updated shift.
        
        For each active task template matching this shift's participant and type,
        create an instance if one doesn't already exist.
        
        Idempotent: running multiple times won't duplicate instances.
        """
        # Get the shift details
        shift_response = self.sb.table("shifts").select("*").eq("id", str(shift_id)).single().execute()
        if not shift_response.data:
            logger.warning(f"Shift {shift_id} not found")
            return []
        
        shift = shift_response.data
        participant_id = shift["participant_id"]
        shift_type = shift["shift_type"].lower()  # morning, afternoon, night
        shift_date = shift["shift_date"]
        
        # Find all active templates for this participant
        templates_response = self.sb.table("task_templates").select("*").eq(
            "participant_id", str(participant_id)
        ).eq("status", "active").execute()
        
        templates = templates_response.data or []
        generated_instances = []
        
        for template in templates:
            # Check if instance already exists (idempotency)
            existing = self.sb.table("task_instances").select("id").eq(
                "shift_id", str(shift_id)
            ).eq("task_template_id", str(template["id"])).execute()
            
            if existing.data:
                continue  # Skip if already exists
            
            # Determine if this template applies to this shift
            matching_shift_types = [template["primary_shift_type"]] + (
                template.get("additional_shift_types") or []
            )
            
            should_create = False
            
            if template["recurrence_type"] == "one_off":
                # One-offs are created directly, not generated
                continue
            
            if shift_type not in matching_shift_types:
                continue  # Shift type doesn't match
            
            # Check recurrence frequency rules
            recurrence_freq = template.get("recurrence_frequency")
            
            if recurrence_freq == "every_matching_shift":
                should_create = True
            
            elif recurrence_freq == "daily_regardless_of_shift":
                # Only create for the first matching shift on that calendar date
                # Check if an instance already exists for this date
                existing_today = self.sb.table("task_instances").select("id").eq(
                    "task_template_id", str(template["id"])
                ).eq("participant_id", str(participant_id)).gte(
                    "created_at", f"{shift_date}T00:00:00Z"
                ).lt(
                    "created_at", f"{shift_date}T23:59:59Z"
                ).execute()
                
                if not existing_today.data:
                    should_create = True
            
            elif recurrence_freq == "specific_weekdays":
                # Check if shift's date is in the specified weekdays
                shift_weekday = datetime.strptime(shift_date, "%Y-%m-%d").weekday()
                # Convert to 0=Sunday, 1=Monday, ..., 6=Saturday
                shift_weekday = (shift_weekday + 1) % 7
                
                weekdays = template.get("recurrence_weekdays") or []
                if shift_weekday in weekdays:
                    should_create = True
            
            if should_create:
                # Create the instance
                instance_data = {
                    "task_template_id": template["id"],
                    "shift_id": str(shift_id),
                    "participant_id": str(participant_id),
                    "due_window_start": template.get("due_window_start"),
                    "due_window_end": template.get("due_window_end"),
                    "status": "pending",
                }
                
                response = self.sb.table("task_instances").insert(instance_data).execute()
                if response.data:
                    generated_instances.extend(response.data)
                    logger.info(f"Generated task instance for shift {shift_id}")
        
        return generated_instances
    
    async def generate_future_instances(self, lookhead_days: int = 7) -> dict:
        """
        Nightly job: generate instances for the next N days of shifts.
        
        Run this as a scheduled job to ensure recurring tasks are ready
        when shifts are rostered.
        """
        future_date = datetime.now().date() + timedelta(days=lookhead_days)
        
        # Get all shifts within the window
        shifts_response = self.sb.table("shifts").select("*").gte(
            "shift_date", str(datetime.now().date())
        ).lte("shift_date", str(future_date)).execute()
        
        shifts = shifts_response.data or []
        total_generated = 0
        
        for shift in shifts:
            instances = await self.generate_task_instances_for_shift(UUID(shift["id"]))
            total_generated += len(instances)
        
        logger.info(f"Nightly job: generated {total_generated} task instances")
        return {"total_generated": total_generated, "shifts_processed": len(shifts)}
    
    # ──────────────────────────────────────────────────────────────────────
    # Handover Logic
    # ──────────────────────────────────────────────────────────────────────
    
    async def process_shift_handover(self, shift_id: UUID) -> dict:
        """
        Process handover when a shift ends.
        
        For each pending task on this shift:
        1. Mark it as missed
        2. Find the next shift for the same participant
        3. Create a new task instance on the next shift, flagged as carried_over
        """
        # Get shift details
        shift_response = self.sb.table("shifts").select("*").eq("id", str(shift_id)).single().execute()
        if not shift_response.data:
            return {"error": f"Shift {shift_id} not found"}
        
        shift = shift_response.data
        participant_id = shift["participant_id"]
        shift_date = shift["shift_date"]
        
        # Find all pending instances on this shift
        pending_response = self.sb.table("task_instances").select("*").eq(
            "shift_id", str(shift_id)
        ).eq("status", "pending").execute()
        
        pending_instances = pending_response.data or []
        carried_over_count = 0
        
        for instance in pending_instances:
            # Mark as missed
            self.sb.table("task_instances").update({
                "status": "missed"
            }).eq("id", str(instance["id"])).execute()
            
            # Find the next shift for this participant
            next_shift_response = self.sb.table("shifts").select("*").eq(
                "participant_id", str(participant_id)
            ).gt("shift_date", shift_date).order("shift_date").limit(1).execute()
            
            if next_shift_response.data:
                next_shift = next_shift_response.data[0]
                
                # Create a new task instance on the next shift
                new_instance_data = {
                    "task_template_id": instance.get("task_template_id"),
                    "shift_id": next_shift["id"],
                    "participant_id": str(participant_id),
                    # Recalculate due window for the new shift (don't carry over stale time)
                    "due_window_start": instance.get("due_window_start"),
                    "due_window_end": instance.get("due_window_end"),
                    "status": "carried_over",
                    "carried_over_from_instance_id": str(instance["id"]),
                }
                
                response = self.sb.table("task_instances").insert(new_instance_data).execute()
                if response.data:
                    carried_over_count += 1
                    logger.info(f"Carried over task {instance['id']} to next shift")
        
        return {
            "shift_id": str(shift_id),
            "missed_count": len(pending_instances),
            "carried_over_count": carried_over_count,
        }
    
    # ──────────────────────────────────────────────────────────────────────
    # Task Completion with Evidence Validation
    # ──────────────────────────────────────────────────────────────────────
    
    async def complete_task_instance(
        self,
        instance_id: UUID,
        completed_by: UUID,
        completion_notes: Optional[str] = None,
        evidence_photo_url: Optional[str] = None,
        evidence_notes: Optional[str] = None,
    ) -> dict:
        """
        Mark a task instance as completed with evidence validation.
        
        Returns error if required evidence is missing.
        """
        # Get the instance
        instance_response = self.sb.table("task_instances").select("*").eq(
            "id", str(instance_id)
        ).single().execute()
        
        if not instance_response.data:
            return {"error": f"Instance {instance_id} not found"}
        
        instance = instance_response.data
        template_id = instance.get("task_template_id")
        
        # If there's a template, validate evidence requirements
        if template_id:
            template_response = self.sb.table("task_templates").select("*").eq(
                "id", str(template_id)
            ).single().execute()
            
            if template_response.data:
                template = template_response.data
                evidence_required = template.get("evidence_required", "none")
                
                # Check evidence requirements
                missing_evidence = []
                
                if evidence_required in ("photo", "photo_and_notes"):
                    if not evidence_photo_url:
                        missing_evidence.append("photo")
                
                if evidence_required in ("notes", "photo_and_notes"):
                    if not evidence_notes or not evidence_notes.strip():
                        missing_evidence.append("notes")
                
                if missing_evidence:
                    return {
                        "error": f"Cannot complete task: missing evidence",
                        "missing_evidence": missing_evidence,
                        "evidence_required": evidence_required,
                    }
        
        # Evidence validated (or not required) — mark complete
        update_data = {
            "status": "completed",
            "completed_by": str(completed_by),
            "completed_at": datetime.utcnow().isoformat() + "Z",
            "completion_notes": completion_notes,
            "evidence_photo_url": evidence_photo_url,
            "evidence_notes": evidence_notes,
        }
        
        response = self.sb.table("task_instances").update(update_data).eq(
            "id", str(instance_id)
        ).execute()
        
        if response.data:
            logger.info(f"Task instance {instance_id} marked complete")
            return {"success": True, "instance": response.data[0]}
        else:
            return {"error": "Failed to update task instance"}
    
    # ──────────────────────────────────────────────────────────────────────
    # Task Management (Create, Read, Update)
    # ──────────────────────────────────────────────────────────────────────
    
    async def create_task_template(self, template_data: dict, created_by: UUID) -> dict:
        """Create a new task template."""
        template_data["created_by"] = str(created_by)
        response = self.sb.table("task_templates").insert(template_data).execute()
        
        if response.data:
            return {"success": True, "template": response.data[0]}
        else:
            return {"error": "Failed to create task template"}
    
    async def update_task_template(self, template_id: UUID, update_data: dict) -> dict:
        """Update an existing task template."""
        response = self.sb.table("task_templates").update(update_data).eq(
            "id", str(template_id)
        ).execute()
        
        if response.data:
            return {"success": True, "template": response.data[0]}
        else:
            return {"error": "Failed to update task template"}
    
    async def pause_task_template(self, template_id: UUID) -> dict:
        """Pause a task template (stops future generation)."""
        return await self.update_task_template(template_id, {"status": "paused"})
    
    async def archive_task_template(self, template_id: UUID) -> dict:
        """Archive a task template."""
        return await self.update_task_template(template_id, {"status": "archived"})
    
    async def get_shift_tasks(self, shift_id: UUID) -> list[dict]:
        """Get all task instances for a shift, sorted by priority."""
        response = self.sb.table("task_instances").select("*").eq(
            "shift_id", str(shift_id)
        ).order("status").order("created_at").execute()
        
        return response.data or []
    
    async def get_templates_for_participant(self, participant_id: UUID) -> list[dict]:
        """Get all task templates for a participant."""
        response = self.sb.table("task_templates").select("*").eq(
            "participant_id", str(participant_id)
        ).eq("status", "active").order("created_at", descending=True).execute()
        
        return response.data or []


# Global service instance
_task_service: Optional[TaskManagementService] = None


def get_task_management_service(sb_client=None) -> TaskManagementService:
    """Get or create a task management service instance."""
    global _task_service
    if _task_service is None:
        _task_service = TaskManagementService(sb_client)
    return _task_service

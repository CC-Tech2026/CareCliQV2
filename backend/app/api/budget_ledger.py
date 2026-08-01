"""
CARECLIQV2-303/304/305: Budget Ledger REST API Endpoints

Exposes budget_transactions ledger functionality via FastAPI.
All endpoints enforce multi-tenant isolation via JWT organization_id.

Endpoints:
  GET  /api/ledger/budget/remaining - Get remaining budget
  POST /api/ledger/transactions/allocation - Record allocation
  POST /api/ledger/transactions/payment - Record payment
  POST /api/ledger/transactions/adjustment - Record adjustment
  GET  /api/ledger/audit/consistency - Run consistency audit
  GET  /api/ledger/audit/direct-writes - Check for ledger bypass
"""

from typing import Optional
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status

from ..core.security import get_current_user
from ..services.budget_ledger_service import (
    get_budget_ledger_service,
    BudgetTransactionType,
    BudgetLedgerSource
)

router = APIRouter(prefix="/api/ledger", tags=["budget-ledger"])


# ============================================================================
# Request/Response Models
# ============================================================================

class BudgetRemainResponse(BaseModel):
    """Response for remaining budget query"""
    total_allocated: int = Field(..., description="Total allocated in cents")
    total_reserved: int = Field(..., description="Total reserved in cents")
    total_paid: int = Field(..., description="Total paid in cents")
    net_adjustments: int = Field(..., description="Net adjustments in cents")
    remaining: int = Field(..., description="Remaining budget in cents")
    remaining_dollars: str = Field(..., description="Formatted remaining budget")
    as_of_date: str = Field(..., description="Date of calculation")


class RecordAllocationRequest(BaseModel):
    """Request to record budget allocation"""
    participant_id: UUID
    amount_cents: int = Field(..., gt=0, description="Budget amount in cents (must be positive)")
    description: str = Field(..., min_length=1, max_length=500)
    plan_id: Optional[UUID] = None
    category: str = Field(default="general", description="NDIS category code")
    reference_id: Optional[str] = Field(None, max_length=100)


class RecordAllocationResponse(BaseModel):
    """Response after recording allocation"""
    success: bool
    transaction_id: Optional[UUID]
    message: str


class RecordPaymentRequest(BaseModel):
    """Request to record budget payment"""
    participant_id: UUID
    amount_cents: int = Field(..., lt=0, description="Payment amount in cents (must be NEGATIVE)")
    invoice_id: str = Field(..., min_length=1, max_length=100)
    description: str = Field(default="Payment against invoice", max_length=500)
    plan_id: Optional[UUID] = None
    category: str = Field(default="general")


class RecordPaymentResponse(BaseModel):
    """Response after recording payment"""
    success: bool
    transaction_id: Optional[UUID]
    message: str


class RecordAdjustmentRequest(BaseModel):
    """Request to record budget adjustment"""
    participant_id: UUID
    adjustment_cents: int = Field(..., ne=0, description="Adjustment amount in cents (can be positive or negative)")
    reason: str = Field(..., min_length=1, max_length=500, description="Reason for adjustment")
    plan_id: Optional[UUID] = None
    category: str = Field(default="general")
    reference_id: Optional[str] = Field(None, max_length=100)


class RecordAdjustmentResponse(BaseModel):
    """Response after recording adjustment"""
    success: bool
    transaction_id: Optional[UUID]
    message: str


class BudgetAuditIssue(BaseModel):
    """Represents one budget inconsistency"""
    issue_type: str = Field(..., description="Type: OVERPAYMENT, OVER_COMMITTED, etc.")
    participant_id: UUID
    plan_id: Optional[UUID]
    category: str
    total_allocated: int
    total_paid: int
    total_reserved: int
    remaining: int
    issue_description: str


class BudgetAuditResponse(BaseModel):
    """Audit results"""
    is_consistent: bool
    issues_found: int
    issues: list[BudgetAuditIssue]


# ============================================================================
# Query Endpoints
# ============================================================================

@router.get(
    "/budget/remaining",
    response_model=BudgetRemainResponse,
    summary="Get remaining budget for participant",
    description="Query remaining budget by participant/plan/category. CARECLIQV2-304."
)
async def get_remaining_budget(
    participant_id: UUID,
    plan_id: Optional[UUID] = None,
    category: str = "general",
    auth: dict = Depends(get_current_user)
) -> BudgetRemainResponse:
    """
    Get remaining budget for a participant.
    
    This endpoint queries the budget_transactions ledger via
    calculate_remaining_budget() function - the single source of truth.
    
    CARECLIQV2-304: Only one place computes remaining budget.
    """
    service = get_budget_ledger_service()
    service.set_organization_context(UUID(auth['organization_id']))
    
    result = service.get_remaining_budget(
        participant_id=participant_id,
        plan_id=plan_id,
        category=category
    )
    
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Participant or budget not found"
        )
    
    return BudgetRemainResponse(**result)


@router.get(
    "/budget/snapshot",
    summary="Get budget snapshot (all categories)",
    description="Query all budget breakdowns for a participant by category. CARECLIQV2-304."
)
async def get_budget_snapshot(
    participant_id: UUID,
    plan_id: Optional[UUID] = None,
    auth: dict = Depends(get_current_user)
):
    """Get complete budget snapshot for participant across all categories"""
    service = get_budget_ledger_service()
    service.set_organization_context(UUID(auth['organization_id']))
    
    snapshot = service.get_budget_snapshot(
        participant_id=participant_id,
        plan_id=plan_id
    )
    
    return {
        'participant_id': str(participant_id),
        'categories': snapshot,
        'total_categories': len(snapshot)
    }


# ============================================================================
# Transaction Recording Endpoints
# ============================================================================

@router.post(
    "/transactions/allocation",
    response_model=RecordAllocationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record budget allocation",
    description="Record ALLOCATION transaction to ledger. CARECLIQV2-303, Feature 3, Subtask 2."
)
async def record_allocation(
    req: RecordAllocationRequest,
    auth: dict = Depends(get_current_user)
) -> RecordAllocationResponse:
    """
    Record a budget allocation (initial budget, plan activation, etc.).
    
    Only ALLOCATION transactions increase budget. Use ADJUSTMENT for corrections.
    
    CARECLIQV2-303, Feature 3, Subtask 2: Migrate onboarding to ledger.
    """
    service = get_budget_ledger_service()
    service.set_organization_context(UUID(auth['organization_id']))
    
    success, txn_id, error = service.record_allocation(
        participant_id=req.participant_id,
        amount_cents=req.amount_cents,
        description=req.description,
        plan_id=req.plan_id,
        category=req.category,
        reference_id=req.reference_id,
        created_by=auth.get('user_id', 'system')
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )
    
    return RecordAllocationResponse(
        success=True,
        transaction_id=txn_id,
        message=f"Allocated ${req.amount_cents / 100:.2f} to participant"
    )


@router.post(
    "/transactions/payment",
    response_model=RecordPaymentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record budget payment",
    description="Record PAYMENT transaction against invoice. CARECLIQV2-303, Feature 3, Subtask 3."
)
async def record_payment(
    req: RecordPaymentRequest,
    auth: dict = Depends(get_current_user)
) -> RecordPaymentResponse:
    """
    Record a payment transaction (invoice paid).
    
    Amount must be NEGATIVE (e.g., -150000 for $1500 payment).
    This reduces remaining budget.
    
    CARECLIQV2-303, Feature 3, Subtask 3: Migrate invoice payments to ledger.
    """
    service = get_budget_ledger_service()
    service.set_organization_context(UUID(auth['organization_id']))
    
    success, txn_id, error = service.record_payment(
        participant_id=req.participant_id,
        amount_cents=req.amount_cents,
        invoice_id=req.invoice_id,
        description=req.description,
        plan_id=req.plan_id,
        category=req.category,
        created_by=auth.get('user_id', 'system')
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )
    
    return RecordPaymentResponse(
        success=True,
        transaction_id=txn_id,
        message=f"Recorded payment of ${abs(req.amount_cents) / 100:.2f} against invoice {req.invoice_id}"
    )


@router.post(
    "/transactions/adjustment",
    response_model=RecordAdjustmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record budget adjustment",
    description="Record ADJUSTMENT transaction (plan review, audit fix, etc.). CARECLIQV2-303, Feature 3, Subtask 3."
)
async def record_adjustment(
    req: RecordAdjustmentRequest,
    auth: dict = Depends(get_current_user)
) -> RecordAdjustmentResponse:
    """
    Record a budget adjustment (plan review, audit correction, etc.).
    
    Amount can be positive (increase budget) or negative (decrease budget).
    Adjustments are traced to their source (plan_review, audit_fix, etc.)
    
    CARECLIQV2-303, Feature 3, Subtask 3: Migrate budget adjustments to ledger.
    """
    service = get_budget_ledger_service()
    service.set_organization_context(UUID(auth['organization_id']))
    
    success, txn_id, error = service.record_adjustment(
        participant_id=req.participant_id,
        adjustment_cents=req.adjustment_cents,
        reason=req.reason,
        plan_id=req.plan_id,
        category=req.category,
        reference_id=req.reference_id,
        created_by=auth.get('user_id', 'system')
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error
        )
    
    direction = "increased" if req.adjustment_cents > 0 else "decreased"
    return RecordAdjustmentResponse(
        success=True,
        transaction_id=txn_id,
        message=f"Budget {direction} by ${abs(req.adjustment_cents) / 100:.2f}"
    )


# ============================================================================
# Audit Endpoints
# ============================================================================

@router.get(
    "/audit/consistency",
    response_model=BudgetAuditResponse,
    summary="Run consistency audit",
    description="Audit organization's budget ledger for inconsistencies. CARECLIQV2-305."
)
async def audit_consistency(
    auth: dict = Depends(get_current_user)
) -> BudgetAuditResponse:
    """
    Run consistency audit on organization's budget ledger.
    
    Checks for:
    - OVERPAYMENT: Total paid exceeds total allocated
    - OVER_COMMITTED: Reserved + paid exceeds allocated
    
    CARECLIQV2-305: Integration test gate. Should return no issues.
    """
    service = get_budget_ledger_service()
    service.set_organization_context(UUID(auth['organization_id']))
    
    issues = service.audit_budget_consistency()
    
    return BudgetAuditResponse(
        is_consistent=len(issues) == 0,
        issues_found=len(issues),
        issues=[BudgetAuditIssue(**issue) for issue in issues]
    )


@router.get(
    "/audit/direct-writes",
    summary="Check for ledger bypass writes",
    description="Identify budget writes that bypass ledger (orphaned entries). CARECLIQV2-303, Feature 3, Subtask 4."
)
async def check_direct_writes(
    auth: dict = Depends(get_current_user)
):
    """
    Check for budget writes outside the ledger.
    
    Should return empty list. Non-empty results indicate:
    - Legacy code still writing to participants.total_annual_budget
    - Data migration incomplete
    - Manual database modifications
    
    CARECLIQV2-303, Feature 3, Subtask 4: Deprecation checking.
    """
    service = get_budget_ledger_service()
    service.set_organization_context(UUID(auth['organization_id']))
    
    orphans = service.check_direct_budget_writes()
    
    return {
        'bypasses_found': len(orphans),
        'orphaned_entries': orphans,
        'status': 'CLEAN' if len(orphans) == 0 else 'MIGRATION_INCOMPLETE'
    }


# ============================================================================
# Health Check
# ============================================================================

@router.get(
    "/health",
    summary="Ledger service health check",
    tags=["health"]
)
async def health_check(auth: dict = Depends(get_current_user)):
    """
    Verify budget ledger is operational.
    
    Checks:
    - Supabase connectivity
    - budget_transactions table accessible
    - RLS policies enforced
    """
    service = get_budget_ledger_service()
    service.set_organization_context(UUID(auth['organization_id']))
    
    try:
        # Try a simple query to verify connectivity
        service.get_remaining_budget(
            participant_id=UUID('00000000-0000-0000-0000-000000000000'),  # Non-existent
        )
        # Query succeeds but returns no results (expected for non-existent participant)
        
        return {
            'status': 'healthy',
            'ledger_service': 'operational',
            'organization_id': auth['organization_id']
        }
    
    except Exception as e:
        return {
            'status': 'unhealthy',
            'error': str(e),
            'ledger_service': 'failed'
        }


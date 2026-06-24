"""
CARECLIQV2-303/304/305: Budget Ledger Service Layer

This module provides the application-level interface to the budget_transactions ledger.
It handles:
  - Recording budget transactions
  - Querying remaining budget
  - Audit operations
  - Integration with FastAPI endpoints

All budget operations flow through this service, ensuring:
  1. Consistent business logic
  2. Proper audit trails
  3. Multi-tenant isolation
  4. RLS policy enforcement
"""

from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime
from decimal import Decimal
from uuid import UUID
import logging

from backend.app.core.database import supabase_client
from backend.app.core.config import settings

logger = logging.getLogger(__name__)


class BudgetTransactionType:
    """Valid transaction types for budget ledger"""
    ALLOCATION = "ALLOCATION"
    RESERVATION = "RESERVATION"
    PAYMENT = "PAYMENT"
    ADJUSTMENT = "ADJUSTMENT"
    REVERSAL = "REVERSAL"
    CORRECTION = "CORRECTION"
    
    ALL = [ALLOCATION, RESERVATION, PAYMENT, ADJUSTMENT, REVERSAL, CORRECTION]


class BudgetLedgerSource:
    """Valid sources for budget transactions"""
    ONBOARDING = "onboarding"
    INVOICE_PAYMENT = "invoice_payment"
    ADJUSTMENT_FORM = "adjustment_form"
    SYSTEM_CORRECTION = "system_correction"
    PLAN_REVIEW = "plan_review"
    AUDIT_FIX = "audit_fix"
    
    ALL = [ONBOARDING, INVOICE_PAYMENT, ADJUSTMENT_FORM, SYSTEM_CORRECTION, PLAN_REVIEW, AUDIT_FIX]


class BudgetLedgerService:
    """
    Service for interacting with budget_transactions ledger.
    
    CRITICAL DESIGN PRINCIPLES:
    1. All budget writes go through this service (no direct SQL)
    2. Amounts are in CENTS (integers), never floats
    3. Multi-tenant isolation is automatic via RLS
    4. The ledger is append-only - corrections use REVERSAL/CORRECTION types
    """
    
    def __init__(self, supabase_client=None):
        """Initialize with Supabase client (defaults to singleton)"""
        self.client = supabase_client or supabase_client
        self.organization_id = None  # Set by API layer from auth context
    
    def set_organization_context(self, organization_id: UUID):
        """Set the current organization for RLS"""
        self.organization_id = organization_id
    
    # ========================================================================
    # Core Ledger Operations
    # ========================================================================
    
    def record_allocation(
        self,
        participant_id: UUID,
        amount_cents: int,
        description: str,
        plan_id: Optional[UUID] = None,
        category: str = "general",
        reference_id: Optional[str] = None,
        metadata: Optional[Dict] = None,
        created_by: str = "system"
    ) -> Tuple[bool, UUID, str]:
        """
        Record a budget ALLOCATION (initial budget, plan activation, etc.)
        
        Args:
            participant_id: UUID of participant
            amount_cents: Budget amount in cents (must be positive)
            description: Human-readable reason
            plan_id: NDIS plan UUID (optional)
            category: NDIS category code (default: 'general')
            reference_id: Link to source (e.g., plan ID)
            metadata: Additional extensibility data
            created_by: Service/user creating transaction
        
        Returns:
            (success: bool, transaction_id: UUID, error_msg: str)
        
        Raises:
            ValueError: If amount_cents <= 0 or organization_id not set
        """
        if not self.organization_id:
            return False, None, "Organization context not set"
        
        if amount_cents <= 0:
            return False, None, f"Allocation amount must be positive: {amount_cents}"
        
        try:
            result = self.client.rpc(
                'onboarding_create_budget_ledger_entry',
                {
                    'p_organization_id': str(self.organization_id),
                    'p_participant_id': str(participant_id),
                    'p_plan_id': str(plan_id) if plan_id else None,
                    'p_total_budget_cents': amount_cents,
                    'p_category': category
                }
            ).execute()
            
            if result.data:
                logger.info(
                    f"Recorded allocation: org={self.organization_id}, "
                    f"participant={participant_id}, amount={amount_cents} cents"
                )
                return True, UUID(result.data[0]) if isinstance(result.data, list) else UUID(result.data), ""
            else:
                return False, None, "No transaction ID returned"
        
        except Exception as e:
            logger.error(f"Failed to record allocation: {str(e)}")
            return False, None, str(e)
    
    def record_payment(
        self,
        participant_id: UUID,
        amount_cents: int,
        invoice_id: str,
        description: str = "Payment against invoice",
        plan_id: Optional[UUID] = None,
        category: str = "general",
        metadata: Optional[Dict] = None,
        created_by: str = "invoicing_service"
    ) -> Tuple[bool, UUID, str]:
        """
        Record a PAYMENT transaction (invoice paid).
        
        Args:
            participant_id: UUID of participant
            amount_cents: Payment amount in cents (MUST BE NEGATIVE, e.g., -150000 for $1500 payment)
            invoice_id: Reference to the invoice
            description: Payment description
            plan_id: NDIS plan UUID (optional)
            category: NDIS category code
            metadata: Additional data
            created_by: Service creating transaction
        
        Returns:
            (success: bool, transaction_id: UUID, error_msg: str)
        """
        if not self.organization_id:
            return False, None, "Organization context not set"
        
        if amount_cents >= 0:
            return False, None, f"Payment amount must be negative (use REVERSAL/ADJUSTMENT for corrections): {amount_cents}"
        
        try:
            response = self.client.table('budget_transactions').insert({
                'organization_id': str(self.organization_id),
                'participant_id': str(participant_id),
                'plan_id': str(plan_id) if plan_id else None,
                'category': category,
                'transaction_type': BudgetTransactionType.PAYMENT,
                'amount_cents': amount_cents,
                'description': description,
                'ledger_source': BudgetLedgerSource.INVOICE_PAYMENT,
                'reference_id': invoice_id,
                'metadata': metadata or {},
                'created_by': created_by
            }).execute()
            
            if response.data:
                txn_id = UUID(response.data[0]['id'])
                logger.info(
                    f"Recorded payment: org={self.organization_id}, "
                    f"participant={participant_id}, amount={amount_cents} cents, invoice={invoice_id}"
                )
                return True, txn_id, ""
            else:
                return False, None, "No transaction ID returned"
        
        except Exception as e:
            logger.error(f"Failed to record payment: {str(e)}")
            return False, None, str(e)
    
    def record_adjustment(
        self,
        participant_id: UUID,
        adjustment_cents: int,
        reason: str,
        plan_id: Optional[UUID] = None,
        category: str = "general",
        reference_id: Optional[str] = None,
        created_by: str = "manual_adjustment"
    ) -> Tuple[bool, UUID, str]:
        """
        Record a budget ADJUSTMENT (plan review, audit correction, etc.).
        
        Args:
            participant_id: UUID of participant
            adjustment_cents: Amount to adjust (positive or negative)
            reason: Reason for adjustment
            plan_id: NDIS plan UUID (optional)
            category: NDIS category code
            reference_id: Link to adjustment form/ticket
            created_by: Who made the adjustment
        
        Returns:
            (success: bool, transaction_id: UUID, error_msg: str)
        """
        if not self.organization_id:
            return False, None, "Organization context not set"
        
        if adjustment_cents == 0:
            return False, None, "Adjustment amount cannot be zero"
        
        try:
            result = self.client.rpc(
                'record_budget_adjustment',
                {
                    'p_organization_id': str(self.organization_id),
                    'p_participant_id': str(participant_id),
                    'p_plan_id': str(plan_id) if plan_id else None,
                    'p_adjustment_cents': adjustment_cents,
                    'p_reason': reason,
                    'p_category': category,
                    'p_reference_id': reference_id,
                    'p_created_by': created_by
                }
            ).execute()
            
            if result.data:
                txn_id = UUID(result.data[0]) if isinstance(result.data, list) else UUID(result.data)
                logger.info(
                    f"Recorded adjustment: org={self.organization_id}, "
                    f"participant={participant_id}, amount={adjustment_cents} cents"
                )
                return True, txn_id, ""
            else:
                return False, None, "No transaction ID returned"
        
        except Exception as e:
            logger.error(f"Failed to record adjustment: {str(e)}")
            return False, None, str(e)
    
    # ========================================================================
    # Budget Query Operations
    # ========================================================================
    
    def get_remaining_budget(
        self,
        participant_id: UUID,
        plan_id: Optional[UUID] = None,
        category: str = "general",
        as_of_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Get remaining budget for a participant/plan/category.
        
        This is THE function for checking budget availability.
        All invoicing and visibility features must use this.
        
        Args:
            participant_id: UUID of participant
            plan_id: UUID of plan (optional, NULL = organization-level)
            category: NDIS category code
            as_of_date: Calculate as of this date (default: NOW)
        
        Returns:
            {
                'total_allocated': 5000000,  # in cents
                'total_reserved': 0,
                'total_paid': 1500000,
                'net_adjustments': 0,
                'remaining': 3500000,  # $35,000
                'as_of_date': '2026-06-24T...'
            }
        """
        if not self.organization_id:
            logger.warning("Organization context not set - RLS will block query")
            return {}
        
        try:
            as_of = as_of_date.isoformat() if as_of_date else datetime.now().isoformat()
            
            result = self.client.rpc(
                'calculate_remaining_budget',
                {
                    'p_organization_id': str(self.organization_id),
                    'p_participant_id': str(participant_id),
                    'p_plan_id': str(plan_id) if plan_id else None,
                    'p_category': category,
                    'p_as_of_date': as_of
                }
            ).execute()
            
            if result.data and len(result.data) > 0:
                row = result.data[0]
                return {
                    'total_allocated': row['total_allocated'],
                    'total_reserved': row['total_reserved'],
                    'total_paid': row['total_paid'],
                    'net_adjustments': row['net_adjustments'],
                    'remaining': row['remaining'],
                    'remaining_dollars': f"${row['remaining'] / 100:.2f}",
                    'as_of_date': row['as_of_date']
                }
            else:
                logger.warning(f"No budget found for participant {participant_id}")
                return {
                    'total_allocated': 0,
                    'total_reserved': 0,
                    'total_paid': 0,
                    'net_adjustments': 0,
                    'remaining': 0,
                    'remaining_dollars': '$0.00',
                    'as_of_date': as_of
                }
        
        except Exception as e:
            logger.error(f"Failed to get remaining budget: {str(e)}")
            raise
    
    def get_budget_snapshot(
        self,
        participant_id: UUID,
        plan_id: Optional[UUID] = None,
        as_of_date: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """
        Get complete budget snapshot (all categories) for a participant.
        
        Args:
            participant_id: UUID of participant
            plan_id: UUID of plan (optional)
            as_of_date: Calculate as of this date
        
        Returns:
            List of budget breakdowns by category
        """
        if not self.organization_id:
            return []
        
        try:
            as_of = as_of_date.isoformat() if as_of_date else datetime.now().isoformat()
            
            result = self.client.rpc(
                'get_budget_snapshot',
                {
                    'p_organization_id': str(self.organization_id),
                    'p_participant_id': str(participant_id),
                    'p_plan_id': str(plan_id) if plan_id else None,
                    'p_as_of_date': as_of
                }
            ).execute()
            
            return result.data or []
        
        except Exception as e:
            logger.error(f"Failed to get budget snapshot: {str(e)}")
            return []
    
    # ========================================================================
    # Audit Operations
    # ========================================================================
    
    def audit_budget_consistency(self) -> List[Dict[str, Any]]:
        """
        Run consistency audit on organization's budget ledger.
        
        Returns list of any inconsistencies found (overpayments, overcommits, etc.)
        Empty list = ledger is consistent.
        
        CARECLIQV2-305: Integration test gate
        """
        if not self.organization_id:
            return []
        
        try:
            result = self.client.rpc(
                'audit_budget_consistency',
                {'p_organization_id': str(self.organization_id)}
            ).execute()
            
            issues = result.data or []
            if issues:
                logger.warning(
                    f"Audit found {len(issues)} budget inconsistencies in org {self.organization_id}"
                )
            
            return issues
        
        except Exception as e:
            logger.error(f"Failed to run consistency audit: {str(e)}")
            return []
    
    def check_direct_budget_writes(self) -> List[Dict[str, Any]]:
        """
        Check for budget writes that bypass the ledger.
        
        Should return zero rows. If non-empty, indicates:
        - Legacy code still writing to participants.total_annual_budget
        - Data migration not completed
        - Someone manually updated database
        """
        try:
            result = self.client.rpc(
                'check_direct_budget_writes',
                {}
            ).execute()
            
            orphans = result.data or []
            if orphans:
                logger.warning(
                    f"Found {len(orphans)} orphaned budget entries outside ledger"
                )
            
            return orphans
        
        except Exception as e:
            logger.error(f"Failed to check direct writes: {str(e)}")
            return []
    
    # ========================================================================
    # Migration Operations
    # ========================================================================
    
    def backfill_existing_budgets(self, limit_org_id: Optional[UUID] = None) -> int:
        """
        Backfill existing participant budgets to ledger.
        
        One-time operation run after ledger deployment.
        Only creates ledger entries for participants with budgets
        but no ledger transactions.
        
        Args:
            limit_org_id: Limit backfill to specific org (for testing)
        
        Returns:
            Number of participants backfilled
        """
        try:
            result = self.client.rpc(
                'backfill_existing_budgets_to_ledger',
                {
                    'p_backfill_date': datetime.now().isoformat(),
                    'p_limit_org_id': str(limit_org_id) if limit_org_id else None
                }
            ).execute()
            
            backfilled_count = len(result.data) if result.data else 0
            logger.info(f"Backfilled {backfilled_count} participants to ledger")
            
            return backfilled_count
        
        except Exception as e:
            logger.error(f"Failed to backfill budgets: {str(e)}")
            return 0


# Singleton instance
_ledger_service = None


def get_budget_ledger_service() -> BudgetLedgerService:
    """Get or create singleton BudgetLedgerService instance"""
    global _ledger_service
    if _ledger_service is None:
        _ledger_service = BudgetLedgerService()
    return _ledger_service

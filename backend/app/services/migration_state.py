"""Lightweight module that tracks runtime schema migration flags.

Keeping state here (rather than in main.py) avoids the circular/brittle
pattern of services importing globals from the application entry point.
All flags are False by default (column assumed present); the startup
migration check in main.py updates them after probing the live schema.
"""

biological_sex_column_missing: bool = False
users_onboarding_columns_missing: bool = False   # account_type, onboarding_complete, organization_id
organizations_table_missing: bool = False
organization_members_table_missing: bool = False
invitations_table_missing: bool = False
session_messages_table_missing: bool = False
patient_goals_table_missing: bool = False
practitioner_allocations_table_missing: bool = False
upcoming_review_date_column_missing: bool = False

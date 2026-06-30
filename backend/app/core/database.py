"""
Supabase Database Client Initialization

Provides a singleton Supabase client configured from environment variables.
"""

from supabase import create_client
from .config import settings

# Initialize Supabase client with credentials from environment
supabase_client = create_client(
    supabase_url=settings.supabase_url,
    supabase_key=settings.supabase_service_role_key  # Use service_role for backend operations
)

__all__ = ["supabase_client"]

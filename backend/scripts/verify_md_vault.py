"""Live-DB-safe smoke test for the MD Documents & Audit Vault.

Read-only against real org data (exercises all 17 category adapters), and
only ever writes/deletes fixture rows it creates itself — never touches real
participant/worker records. Run from the backend/ directory:

    python -m scripts.verify_md_vault
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import vault_service  # noqa: E402
from app.services.supabase_client import get_supabase_admin  # noqa: E402


def main() -> None:
    supabase = get_supabase_admin()

    org_resp = supabase.table("organizations").select("organization_id").limit(1).execute()
    if not org_resp.data:
        print("No organizations found in this database — nothing to test against.")
        return
    org_id = org_resp.data[0]["organization_id"]
    print(f"Using organization_id={org_id}")

    user_resp = (
        supabase.table("users")
        .select("id")
        .eq("organization_id", org_id)
        .limit(1)
        .execute()
    )
    if not user_resp.data:
        print("No users found for this org — skipping user-scoped checks.")
        user_id = None
    else:
        user_id = user_resp.data[0]["id"]
        print(f"Using user_id={user_id}")

    print("\n--- 1. Exercising all 17 category adapters (read-only) ---")
    for category in vault_service.CATEGORY_META:
        try:
            docs = vault_service.list_folder_documents(org_id, category)
            print(f"  {category:32s} -> {len(docs)} document(s)  OK")
        except Exception as exc:
            print(f"  {category:32s} -> FAILED: {exc}")

    print("\n--- 2. list_folders() / list_vault_stats() ---")
    folders = vault_service.list_folders(org_id)
    print(f"  {len(folders)} folders returned (expected 17)")
    stats = vault_service.list_vault_stats(org_id)
    print(f"  stats: {stats}")

    if user_id:
        print("\n--- 3. Governance document upload + soft delete (fixture only) ---")
        import asyncio

        doc = asyncio.run(
            vault_service.upload_governance_document(
                org_id,
                "risk_management",
                "Vault verification fixture — safe to ignore",
                "Created by verify_md_vault.py, will be deleted immediately.",
                user_id,
                b"%PDF-1.4\n%%EOF\n",
                "application/pdf",
            )
        )
        doc_id = doc["id"]
        file_path = doc["file_path"]
        print(f"  created governance_documents row {doc_id}")

        vault_service.delete_governance_document(org_id, doc_id)
        check = (
            supabase.table("governance_documents")
            .select("id, deleted_at")
            .eq("id", doc_id)
            .limit(1)
            .execute()
        )
        soft_deleted = bool(check.data and check.data[0].get("deleted_at"))
        print(f"  soft-deleted (deleted_at set): {soft_deleted}")

        # Real cleanup: hard-delete this fixture row and its storage object —
        # this is the script's own throwaway fixture, not user data.
        try:
            supabase.storage.from_(vault_service.GOVERNANCE_BUCKET).remove([file_path])
        except Exception:
            pass
        supabase.table("governance_documents").delete().eq("id", doc_id).execute()
        print("  fixture row + storage object removed")

        print("\n--- 4. vault_share_events insert + 30-day stat pickup (fixture only) ---")
        before = vault_service.list_vault_stats(org_id)["shared_last_30_days"]
        vault_service.log_share_event(
            org_id,
            user_id,
            method="download_zip",
            folder_keys=["session_notes"],
            document_refs=[{"category": "session_notes", "id": "verification-fixture"}],
            recipient_hint=None,
            ip_address=None,
            user_agent="verify_md_vault.py",
        )
        after = vault_service.list_vault_stats(org_id)["shared_last_30_days"]
        print(f"  shared_last_30_days: {before} -> {after} (expected +1)")

        # Cleanup: delete only the fixture event this script just inserted.
        supabase.table("vault_share_events").delete().eq("user_agent", "verify_md_vault.py").execute()
        print("  fixture share event removed")
    else:
        print("\n--- Skipping steps 3-4 (no user in this org to attribute fixtures to) ---")

    print("\nDone.")


if __name__ == "__main__":
    main()

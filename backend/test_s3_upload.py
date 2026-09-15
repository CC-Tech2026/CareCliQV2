"""
Quick standalone test - bypasses the app's UI/API entirely and directly
calls the same storage function real uploads use, to confirm S3 config works.

Run from the backend/ folder with: uv run python test_s3_upload.py
"""
from app.services.object_storage import upload_evidence_bytes, resolve_evidence_storage_provider

print("Resolved storage provider:", resolve_evidence_storage_provider())

# A minimal valid 1x1 pixel PNG (real image bytes, not just text)
test_png_bytes = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de000000017352474200aece1ce90000000467414d410000b18f0bfc6105"
    "0000000970485973000016250000162501495224f0000000174944415408d7"
    "6360606060bc4c8100010f6f01a1cfcfa0870000000049454e44ae426082"
)

result = upload_evidence_bytes(
    "test-uploads/connectivity-check.png",
    test_png_bytes,
    "image/png",
)

print("Upload succeeded!")
print("Provider:", result.provider)
print("Storage path:", result.storage_path)
print("File URL:", result.file_url)

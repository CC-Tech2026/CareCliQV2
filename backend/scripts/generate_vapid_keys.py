"""Print a new VAPID key pair for browser push.

    python -m backend.scripts.generate_vapid_keys

Set the output as WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY
(e.g. `flyctl secrets set ...`). Generate once per environment: replacing the
keys later silently breaks every existing browser subscription until each
person turns notifications on again.
"""

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
import base64


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def generate_vapid_keys() -> tuple[str, str]:
    """(public, private) as base64url, the format `npx web-push generate-vapid-keys` uses."""
    key = ec.generate_private_key(ec.SECP256R1())
    public = key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    private = key.private_numbers().private_value.to_bytes(32, "big")
    return _b64url(public), _b64url(private)


def main() -> None:
    public, private = generate_vapid_keys()
    print(f"WEB_PUSH_VAPID_PUBLIC_KEY={public}")
    print(f"WEB_PUSH_VAPID_PRIVATE_KEY={private}")


if __name__ == "__main__":
    main()

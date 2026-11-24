"""Check where translation runs on this server.

Run on a server:
    flyctl ssh console -a carecliq-api -C "python -m backend.scripts.check_translation_setup"

Prints, without showing any keys:
  - whether Gemini on Vertex AI in Australia is set up, its region, the exact
    host it calls, and a test translation of a made-up sentence
  - where LibreTranslate is (its host and IP address) and a test translation
  - whether translation may fall back to services outside Australia
No real notes are sent: only the sample sentence below.
"""

from __future__ import annotations

import socket
import time
import urllib.parse

from backend.app.services import ai_service, onshore_translation

SAMPLE = "Le participant a terminé l'activité et a pris ses médicaments à 9 h."


def _section(title: str) -> None:
    print(f"\n== {title}")


def check_gemini() -> None:
    _section("Gemini on Vertex AI (primary)")
    problem = onshore_translation.configuration_problem()
    region = onshore_translation.location()
    print(f"region:  {region}")
    print(f"model:   {onshore_translation.model()}")
    print(f"host:    {region}-aiplatform.googleapis.com (regional, not the global endpoint)")
    if problem:
        print(f"status:  NOT SET UP ({problem})")
        return
    started = time.monotonic()
    try:
        result = onshore_translation.translate_sync(SAMPLE, "English")
        print(f"status:  OK in {time.monotonic() - started:.1f}s")
        print(f"result:  {result['translated']!r} (detected {result['detected_language']})")
    except Exception as exc:
        print(f"status:  FAILED ({exc})")


def check_libretranslate() -> None:
    _section("LibreTranslate (backup)")
    url = ai_service._LIBRETRANSLATE_URL
    if not url:
        print("status:  NOT SET (LIBRETRANSLATE_URL is empty)")
        return
    host = urllib.parse.urlparse(url).hostname or ""
    print(f"host:    {host}")
    try:
        print(f"ip:      {socket.gethostbyname(host)}")
    except OSError as exc:
        print(f"ip:      could not resolve ({exc})")
    if host in ("localhost", "127.0.0.1") or host.endswith(".internal") or host.endswith(".flycast"):
        print("where:   on this server or Fly's private network. For a Fly app, `flyctl status -a <app>` shows its region (syd = Sydney).")
    elif host.endswith(".fly.dev"):
        print(f"where:   a Fly app. Run `flyctl status -a {host.split('.')[0]}` and check the REGION column (syd = Sydney).")
    else:
        print("where:   an outside host. Ask whoever runs it, or check the IP's owner and region with the hosting provider.")
    started = time.monotonic()
    try:
        result = ai_service._libretranslate_sync(SAMPLE)
        print(f"status:  OK in {time.monotonic() - started:.1f}s")
        print(f"result:  {result['translated']!r}")
    except Exception as exc:
        print(f"status:  NOT WORKING ({exc})")


def main() -> None:
    check_gemini()
    check_libretranslate()
    _section("Outside Australia")
    allowed = onshore_translation.offshore_allowed()
    print(
        "offshore backups (Google global endpoint, OpenAI): "
        + ("ALLOWED" if allowed else "OFF, translation never leaves Australia")
    )
    if allowed:
        print("To turn them off: set TRANSLATION_ALLOW_OFFSHORE=false, or set up Gemini in Australia (they turn off by themselves).")


if __name__ == "__main__":
    main()

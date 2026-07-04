#!/usr/bin/env python3
"""Show or change the persistent Reddit integration setting."""

import json
import sys
from pathlib import Path


SETTINGS_PATH = Path(__file__).resolve().parent / ".finance-video" / "settings.json"


def load_settings():
    if not SETTINGS_PATH.exists():
        return {}
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not read {SETTINGS_PATH}: {error}")


def main():
    settings = load_settings()
    enabled = settings.get("redditEnabled") is True
    command = sys.argv[1].lower() if len(sys.argv) == 2 else "status"

    if len(sys.argv) > 2 or command not in {"status", "enable", "disable", "toggle"}:
        raise SystemExit("Usage: python redditswitch.py [status|enable|disable|toggle]")

    if command != "status":
        if command == "enable":
            enabled = True
        elif command == "disable":
            enabled = False
        else:
            enabled = not enabled
        settings["redditEnabled"] = enabled
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_PATH.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")

    print(f"Reddit {'enabled' if enabled else 'disabled'}")


if __name__ == "__main__":
    main()

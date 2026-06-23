#!/usr/bin/env python3
"""Extract icon names from css.json into icon_list.txt (one name per line)."""

import json
from pathlib import Path

DIR = Path(__file__).resolve().parent
CSS_JSON = DIR / "css.json"
ICON_LIST = DIR / "icon_list.txt"


def main() -> None:
    data = json.loads(CSS_JSON.read_text(encoding="utf-8"))
    icons = data.get("icons", {})
    names = sorted(icons.keys())
    ICON_LIST.write_text("\n".join(names) + "\n", encoding="utf-8")
    print(f"Wrote {len(names)} icon names to {ICON_LIST.name}")


if __name__ == "__main__":
    main()

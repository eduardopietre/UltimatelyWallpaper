#!/usr/bin/env python3
from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "dist"
ZIP_PATH = OUT_DIR / "icloud-calendar-wallpaper-lively.zip"

INCLUDE = (
    "index.html",
    "LivelyInfo.json",
    "LivelyProperties.json",
    "css",
    "js",
    "line-md-svg",
)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    temp_dir = Path(tempfile.gettempdir()) / f"lively-pack-{uuid.uuid4()}"
    temp_dir.mkdir(parents=True, exist_ok=True)

    try:
        for item in INCLUDE:
            source = ROOT / item
            if not source.exists():
                raise FileNotFoundError(f"Missing required path: {item}")

            dest = temp_dir / item
            if source.is_dir():
                shutil.copytree(source, dest)
            else:
                shutil.copy2(source, dest)

        if ZIP_PATH.exists():
            ZIP_PATH.unlink()

        shutil.make_archive(str(ZIP_PATH.with_suffix("")), "zip", temp_dir)
        print(f"Created {ZIP_PATH}")
    finally:
        if temp_dir.exists():
            shutil.rmtree(temp_dir)


if __name__ == "__main__":
    main()

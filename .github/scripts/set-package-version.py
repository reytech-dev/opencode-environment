#!/usr/bin/env python3

import re
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("Usage: set-package-version.py <version>")

version = sys.argv[1]
manifest = Path("package.json")

text = manifest.read_text(encoding="utf-8")

new_text, count = re.subn(
    r'("version"\s*:\s*")([0-9]+\.[0-9]+\.[0-9]+(?:-[^"\s,]*)?)(")',
    rf'\g<1>{version}\3',
    text,
    count=1,
)

if count != 1:
    raise SystemExit("Could not find a semantic version in package.json")

manifest.write_text(new_text, encoding="utf-8")
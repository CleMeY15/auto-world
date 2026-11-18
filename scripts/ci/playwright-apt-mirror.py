"""Select the official archive for the slow us-east-2 mirror on Noble CI runners."""

import re
import sys
from pathlib import Path

EC2 = rb"https?://us-east-2\.ec2\.archive\.ubuntu\.com/ubuntu"
OFFICIAL = b"https://archive.ubuntu.com/ubuntu"
URI = re.compile(rb"(?<!\S)" + EC2 + rb"(?=/?(?:\s|$))")
# A deb822 URIs field can have several values and indented continuation lines.
URI_FIELD = re.compile(rb"^URIs:[^\n]*(?:\n[ \t][^\n]*)*", re.I | re.M)
LIST_ENTRY = re.compile(
    rb"^([ \t]*deb(?:-src)?[ \t]+(?:\[[^\]\n]+\][ \t]+)?)"
    + EC2 + rb"(?=/?[ \t])", re.M
)


def configure(directory):
    parts = directory / "sources.list.d"
    changed = 0
    for path in [directory / "sources.list", *sorted(parts.glob("*.list")),
                 *sorted(parts.glob("*.sources"))]:
        if not path.is_file():
            continue
        original = path.read_bytes()
        if path.suffix == ".sources":
            updated = URI_FIELD.sub(lambda field: URI.sub(OFFICIAL, field[0]), original)
        else:
            updated = LIST_ENTRY.sub(lambda entry: entry[1] + OFFICIAL, original)
        if updated != original:
            path.write_bytes(updated)
            changed += 1
    print(f"Playwright apt: switched {changed} source files from us-east-2 EC2 to archive.ubuntu.com")


if __name__ == "__main__":
    configure(Path(sys.argv[1]))

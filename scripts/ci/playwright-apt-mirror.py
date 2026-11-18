"""Prefer the hosted Noble runner's official archive fallback over slow EC2."""

import sys
from pathlib import Path

EC2 = b"http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1"
ARCHIVE = b"https://archive.ubuntu.com/ubuntu/\tpriority:2"


def configure(path):
    if path.is_file():
        lines = path.read_bytes().splitlines(keepends=True)
        entries = [line.rstrip(b"\r\n") for line in lines]
        if EC2 in entries and ARCHIVE in entries:
            # Leave the official archive and all other entries in their original order.
            path.write_bytes(b"".join(line for line in lines if line.rstrip(b"\r\n") != EC2))
            print("Playwright apt: removed slow EC2 priority:1; official HTTPS archive available at priority:2")
            return
    print("Playwright apt: runner mirror selection unchanged")


if __name__ == "__main__":
    configure(Path(sys.argv[1]))

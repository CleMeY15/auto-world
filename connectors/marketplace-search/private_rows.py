"""Publish a local batch atomically as a new, owner-only JSON file."""
import json
import os
from pathlib import Path
import tempfile


def write_rows(destination, source, mode, rows):
    path = Path(destination)
    if os.name != "posix":
        raise OSError("Private output requires a POSIX filesystem with owner-only file permissions")
    fd, temporary = tempfile.mkstemp(prefix=".autofindex-rows-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            os.fchmod(stream.fileno(), 0o600)
            document = {"source": source, "mode": mode, "count": len(rows), "rows": rows}
            json.dump(document, stream, ensure_ascii=False, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        # Hard linking within the same directory is atomic and cannot overwrite a
        # concurrent writer, an existing file, or a symlink at the destination.
        os.link(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)

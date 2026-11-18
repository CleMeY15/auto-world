"""Offline TASK-0005 experiment. All names, sizes and bytes are synthetic."""
import ctypes
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import Timer

LIMIT = 2**31
FULL = 2_429_026_304
BLOCK = 512
CHUNK = 1024**2
ZEROS = bytes(CHUNK)
MANIFEST = "m3/restore-manifest.json"
PREFIX = b"synthetic M3 probe\n"
SUFFIX = bytes(range(16))
# Independently measured by sha256sum on regular seed files in the Linux probe.
# The first column is the payload size, the second the exact closed TAR size.
CASES = (
    (LIMIT - 3072, LIMIT - 512, "0bdafbb2f5ea0e3d8b481ae12a15a748315e1d30f18c1a1c90e045b11eb50ee9"),
    (LIMIT - 2560, LIMIT, "5ef9337bf4116f0454f472ca25431b5707cb4e8b9e6d278349f1be57b6d84474"),
    (LIMIT - 2048, LIMIT + 512, "c44e53bb07e91a159d63d5151abe2c49c7e05245b1d5819ba2ae3e9c17642923"),
    (LIMIT - 1, LIMIT + 2560, "cf9b002508e2c414dd1ff5f3e353703267adaa1d0b08f801023e050f94949ab0"),
    (LIMIT, LIMIT + 2560, "39a88fb412e9ed3049251fd514132e02de74d515c5a3c2b315a486224c64ed97"),
    (LIMIT + 1, LIMIT + 3072, "73c994cc0cafaffcd442f5eaa321c716868daeea79847fd8435b221fa7c6bb2e"),
    (FULL, FULL + 2560, "e6243969d37281fd8db479bf855e87cde32d77894e86fa3af2e2961df9249bce"),
)


class Refused(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def remaining():
    seconds = DEADLINE - time.monotonic()
    if seconds <= 0:
        raise TimeoutError("25-minute fixture deadline exceeded")
    return seconds


def header(name, size):
    info = tarfile.TarInfo(name)
    info.size = size
    return info.tobuf(format=tarfile.USTAR_FORMAT)


def write_fixture(stream, manifest, name, size):
    stream.seek(0)
    stream.truncate()
    stream.write(header(MANIFEST, len(manifest)))
    stream.write(manifest.ljust(BLOCK, b"\0"))
    stream.write(header(name, size))
    stream.write(PREFIX)
    left = size - len(PREFIX) - len(SUFFIX)
    while left:
        remaining()
        count = min(CHUNK, left)
        stream.write(ZEROS[:count])
        left -= count
    stream.write(SUFFIX)
    stream.write(bytes((-size) % BLOCK + 2 * BLOCK))
    stream.flush()


def hash_payload(stream, size, digest):
    sha = hashlib.sha256()
    count = 0
    while count < size:
        remaining()
        chunk = stream.read(min(CHUNK, size - count))
        require(chunk, "truncated payload")
        count += len(chunk)
        sha.update(chunk)
    require(sha.hexdigest() == digest, "payload SHA-256 mismatch")
    return sha.hexdigest()


def verify(stream, manifest, name, size, digest, tar_size):
    stream.seek(0)
    require(stream.read(BLOCK) == header(MANIFEST, len(manifest)), "manifest header")
    require(stream.read(BLOCK) == manifest.ljust(BLOCK, b"\0"), "manifest or padding")
    require(stream.read(BLOCK) == header(name, size), "payload header")
    measured = hash_payload(stream, size, digest)
    padding = (-size) % BLOCK
    require(stream.read(padding) == bytes(padding), "payload padding")
    end = stream.read(2 * BLOCK)
    require(len(end) == 2 * BLOCK, "truncated end blocks")
    require(end == bytes(2 * BLOCK), "unexpected member or invalid end blocks")
    require(stream.tell() == tar_size and not stream.read(1), "archive length or EOF")
    return measured


def refusals(stream, check, tar_size):
    observed = []

    def refused(label, expected):
        try:
            check()
        except Refused as exc:
            require(str(exc) == expected, f"{label}: unexpected refusal {exc}")
            observed.append({"case": label, "reason": str(exc)})
        else:
            raise AssertionError(f"{label}: invalid fixture accepted")

    # This byte lies in the zero-filled middle of the full-size payload.
    late = 3 * BLOCK + LIMIT + 1
    stream.seek(late)
    require(stream.read(1) == b"\0", "late mutation precondition")
    stream.seek(late)
    stream.write(b"\1")
    refused("one changed byte at member offset 2147483649", "payload SHA-256 mismatch")
    stream.seek(late)
    stream.write(b"\0")
    stream.truncate(tar_size - 1)
    refused("partial final block", "truncated end blocks")
    stream.truncate(tar_size - 2 * BLOCK)
    refused("both end blocks absent", "truncated end blocks")
    stream.seek(0, os.SEEK_END)
    stream.write(header("unknown", 0) + bytes(2 * BLOCK))
    refused("third regular member", "unexpected member or invalid end blocks")
    return observed


def ntfs_volume(stream):
    import msvcrt
    from ctypes import wintypes

    get_info = ctypes.WinDLL("kernel32", use_last_error=True).GetVolumeInformationByHandleW
    dword_ptr = ctypes.POINTER(wintypes.DWORD)
    get_info.argtypes = (wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, dword_ptr,
                         dword_ptr, dword_ptr, wintypes.LPWSTR, wintypes.DWORD)
    get_info.restype = wintypes.BOOL
    fs = ctypes.create_unicode_buffer(32)
    serial = wintypes.DWORD()
    if not get_info(msvcrt.get_osfhandle(stream.fileno()), None, 0, ctypes.byref(serial),
                    None, None, fs, len(fs)):
        raise ctypes.WinError(ctypes.get_last_error())
    require(fs.value == "NTFS", f"fixture handle is on {fs.value}, NTFS required")
    return {"filesystem": fs.value, "serial": serial.value}


@contextmanager
def owned_file(parent, report):
    root = parent.resolve(strict=True) / "auto-world-m3-ustar-fixture"
    root.mkdir(mode=0o700)  # Fail on collision, including an interrupted earlier run.
    identity = root.lstat()
    path = root / "fixture.tar"
    file_id = None
    report["scratchRemoved"] = False
    try:
        with path.open("x+b") as stream:
            file_id = os.fstat(stream.fileno())
            yield stream, path
    finally:
        require(os.path.samestat(identity, root.lstat()), "scratch identity changed")
        if file_id is not None:
            require(os.path.samestat(file_id, path.lstat()), "fixture identity changed")
            path.unlink()
        root.rmdir()  # Refuse unknown contents. Never recursively delete.
        require(not os.path.lexists(root), "scratch still exists")
        report["scratchRemoved"] = True


def native_read(tar, stream, manifest, name, size, digest):
    stream.seek(0)
    listing = subprocess.check_output([tar, "-tf", "-"], stdin=stream, timeout=remaining())
    require(listing.decode("ascii").splitlines() == [MANIFEST, name], "native TAR listing")
    # -O reads both listed members in archive order. No filesystem extraction.
    stream.seek(0)
    with subprocess.Popen([tar, "-xOf", "-"], stdin=stream, stdout=subprocess.PIPE) as proc:
        try:
            watchdog = Timer(remaining(), proc.kill)
            watchdog.start()
            try:
                with proc.stdout as out:
                    require(out.read(len(manifest)) == manifest, "native manifest mismatch")
                    measured = hash_payload(out, size, digest)
                    require(not out.read(1), "native reader returned excess bytes")
                proc_exit = proc.wait(timeout=remaining())
                require(proc_exit == 0, f"native TAR exited {proc_exit}")
            finally:
                watchdog.cancel()
                watchdog.join()
        finally:
            if proc.poll() is None:
                proc.kill()
            code = proc.wait()
            if code:
                print(f"native TAR exit code {code}", file=sys.stderr)
    return {"listing": [MANIFEST, name], "payloadBytes": size, "sha256": measured}


def exercise(tar, stream, path, case):
    size, tar_size, digest = case
    name = "objects/" + digest
    member = {"name": name, "bytes": size, "sha256": digest}
    manifest = (json.dumps({"version": 1, "synthetic": True, "members": [member]},
                           separators=(",", ":")) + "\n").encode("ascii")
    require(len(manifest) <= BLOCK, "manifest exceeds one block")
    write_fixture(stream, manifest, name, size)
    before = os.fstat(stream.fileno())
    require(before.st_size == tar_size, "unexpected written length")

    def check():
        return verify(stream, manifest, name, size, digest, tar_size)

    measured = check()
    native = native_read(tar, stream, manifest, name, size, digest)
    after = os.fstat(stream.fileno())
    require(os.path.samestat(before, path.lstat()) and before.st_size == after.st_size
            and before.st_mtime_ns == after.st_mtime_ns, "fixture changed during reading")
    row = {"memberBytes": size, "memberSha256": measured, "tarBytes": before.st_size,
           "native": native}
    if size == FULL:
        row["refusals"] = refusals(stream, check, tar_size)
    return row


def run(report):
    os_name = platform.system()
    require(os_name in ("Windows", "Linux"), "native Windows or Linux required")
    require("microsoft" not in platform.release().lower(), "WSL is outside fixture scope")
    windows = os_name == "Windows"
    tar = Path(os.environ["SystemRoot"]) / "System32" / "tar.exe" if windows else Path("/usr/bin/tar")
    parent = os.environ.get("RUNNER_TEMP") or (os.environ["TEMP"] if windows else os.getenv("TMPDIR", "/tmp"))
    report.update(platform=platform.platform(), python=sys.version, tar=str(tar),
                  tarVersion=subprocess.check_output([tar, "--version"], text=True, timeout=min(30, remaining())).splitlines()[0])
    with owned_file(Path(parent), report) as (stream, path):
        if windows:
            report["volume"] = ntfs_volume(stream)
        elif os.getenv("RUNNER_OS") == "Windows":
            raise Refused("Windows job must use a native Windows interpreter")
        free = shutil.disk_usage(path.parent).free
        report["scratchFreeBytesBefore"] = free
        require(free >= 3 * 1024**3, "fixture requires 3 GiB free on scratch volume")
        for case in CASES:
            print(f"Testing member={case[0]} tar={case[1]}", file=sys.stderr, flush=True)
            report["currentMemberBytes"] = case[0]
            started = time.monotonic()
            row = exercise(tar, stream, path, case)
            row["elapsedSeconds"] = round(time.monotonic() - started, 3)
            report["cases"].append(row)


if __name__ == "__main__":
    DEADLINE = time.monotonic() + 25 * 60
    report = {"scope": "synthetic USTAR", "cases": [], "status": "FAILED",
              "startedUtc": datetime.now(timezone.utc).isoformat(),
              "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "runId": os.getenv("GITHUB_RUN_ID"), "attempt": os.getenv("GITHUB_RUN_ATTEMPT")}
    try:
        report["source"] = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True, timeout=min(30, remaining())
        ).strip()
        if os.getenv("EXPECTED_CHECKOUT"):
            require(report["source"] == os.environ["EXPECTED_CHECKOUT"], "checkout mismatch")
        run(report)
        report["status"] = "PASS"
    except Exception as error:
        report["error"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        report["finishedUtc"] = datetime.now(timezone.utc).isoformat()
        print(json.dumps(report, indent=2), flush=True)

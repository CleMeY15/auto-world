"""Fixed passive PostgreSQL source inspection through inherited readonly FDs.

The parent authenticates the reviewed code against Git before and after this
process. FD7 is resealed without a circular self-hash claim; FD8 additionally
has a fixed byte pin before its SourceFileLoader import. Root-owned Python,
stdlib and dynamic libraries remain a disclosed OS trust boundary, not a
complete independently authenticated runtime closure. No archive is extracted
or executed. Pure reader functions support only harmless unit fixtures.
"""

import _bz2
import base64
import bz2
import hashlib
import importlib.machinery
import importlib.util
import json
import os
import re
import stat
import sys

try:
    import fcntl
except ImportError:
    fcntl = None

PREFIX = "postgres_upstream_source_inspect_"
CHUNK = 64 * 1024
MAX_TAR_BYTES = 192 * 1024 * 1024
MAX_OUTPUT_BYTES = 128 * 1024
OLD_HELPER_SIZE = 24671
OLD_HELPER_SHA256 = "f7b37bc47729c65653cf03fd6b93e8bd6dec7b48027b544469c559dde0c4724c"
COMMIT = "2603e26e245e558218728ee14e0a42dcb020dc7f"
# Observed archive PAX declaration; this is not Git object authentication.
PG_PAX_DECLARED_COMMIT = "083ac033419f690758508e08c1736089384bbee8"
PG_SHA256 = "dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979"
ENV = {"PATH": "/usr/bin:/bin", "HOME": "/home/autoworld", "LANG": "C.UTF-8",
       "LC_ALL": "C.UTF-8", "TZ": "UTC"}
REASONS = frozenset(("context_invalid", "descriptor_invalid", "source_changed",
                     "fingerprint_invalid", "archive_invalid", "binding_invalid",
                     "cleanup_uncertain", "output_failed", "failed"))
RUNTIME_PINS = (
    {"path": "/usr/lib/python3.12/bz2.py", "size": 11847,
     "sha256": "76ab3252924e71e859d7d90e8d3db13b6554975cfcac0fdadced4de7f8779330"},
    {"path": "/usr/lib/python3.12/lib-dynload/_bz2.cpython-312-x86_64-linux-gnu.so",
     "size": 32112,
     "sha256": "eff8df23cdc54d38ce9ca600d07c21ccfd7f22bd52a0720e599e6828d3e2eb76"},
)
PINS = (
    {"role": "POSTGRES_UPSTREAM_SOURCE", "name": "postgresql-17.11.tar.bz2",
     "size": 21787224, "sha256": PG_SHA256, "root": "postgresql-17.11",
     "entries": 7718, "raw": 135730425, "decoded": 141578240,
     "selected": ("COPYRIGHT", "LICENSE", "NOTICE")},
    {"role": "DOCKER_LIBRARY_POSTGRES_SOURCE",
     "name": "docker-library-postgres-2603e26e245e558218728ee14e0a42dcb020dc7f.tar.gz",
     "size": 56252, "sha256": "c452a880f58c62bc0738a266ff67e3c9656f33547da9d757563874daf5ab9200",
     "root": "postgres-" + COMMIT, "entries": 122, "raw": 680576,
     "decoded": 768000,
     "selected": ("17/alpine3.24/Dockerfile", "COPYRIGHT", "LICENSE", "NOTICE",
                  "17/alpine3.24/docker-ensure-initdb.sh", "17/alpine3.24/docker-entrypoint.sh")},
)
SELECTED_PINS = (
    {"COPYRIGHT": (1198, "3d6af92ff8a4c2cdf69afb1cf44edea727922f5cd0cf8b5f72b11cdecac8fdfd")},
    {"LICENSE": (1084, "87ffd2c45e3f90cfa3407b5c40ef8333e87c3e875e4895f8b64df758198deafc"),
     "17/alpine3.24/Dockerfile": (8145, "03484c8058b53c342cf407d476e45539dc44ffe468e66241bbd7c9e369166e81"),
     "17/alpine3.24/docker-entrypoint.sh": (14577, "9c440299ae04a0a79d55b8bf03307036d890a40979d2fb698073c9050d4b20a5"),
     "17/alpine3.24/docker-ensure-initdb.sh": (2317, "922ade6b23a312e65023349b36e873752b15ff38ae4c0ae461d74451e104f312")},
)


class InspectionError(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _require(condition, reason="archive_invalid"):
    if not condition:
        raise InspectionError(reason)


def _identity(value):
    return {"dev": str(value.st_dev), "ino": str(value.st_ino),
            "uid": value.st_uid, "gid": value.st_gid,
            "mode": stat.S_IMODE(value.st_mode), "nlink": value.st_nlink,
            "size": value.st_size, "mtimeNs": str(value.st_mtime_ns),
            "ctimeNs": str(value.st_ctime_ns)}


def _proc_bytes(path, cap):
    with open(path, "rb", buffering=0) as opened:
        value = opened.read(cap + 1)
    _require(len(value) <= cap, "descriptor_invalid")
    return value


def _native_actor():
    _require(sys.platform == "linux" and fcntl is not None
             and sys.version_info[:3] == (3, 12, 3)
             and sys.flags.isolated == 1 and sys.flags.no_site == 1
             and sys.flags.dont_write_bytecode == 1 and len(sys.argv) == 1
             and sys.argv[0] == "/proc/self/fd/7" and __file__ == "/proc/self/fd/7"
             and sys.executable == "/usr/bin/python3.12" and dict(os.environ) == ENV,
             "context_invalid")
    _require(bz2.__spec__.origin == RUNTIME_PINS[0]["path"]
             and _bz2.__spec__.origin == RUNTIME_PINS[1]["path"]
             and json.__spec__.origin == "/usr/lib/python3.12/json/__init__.py"
             and base64.__spec__.origin == "/usr/lib/python3.12/base64.py",
             "context_invalid")
    _require(os.getresuid() == (1000, 1000, 1000)
             and os.getresgid() == (1000, 1000, 1000) and os.getgroups() == [],
             "context_invalid")
    status = _proc_bytes("/proc/self/status", 16384)
    for label in (b"Uid", b"Gid"):
        _require(re.search(rb"^" + label + rb":\s+1000\s+1000\s+1000\s+1000$", status, re.M), "context_invalid")
    _require(re.search(rb"^Groups:[ \t]*$", status, re.M)
             and re.search(rb"^NoNewPrivs:[ \t]+1$", status, re.M), "context_invalid")
    for label in (b"CapInh", b"CapPrm", b"CapEff", b"CapAmb"):
        _require(re.search(rb"^" + label + rb":[ \t]+0{16}$", status, re.M), "context_invalid")


def _fd_ext4(fd, value):
    fdinfo = _proc_bytes("/proc/self/fdinfo/" + str(fd), 4096)
    match = re.search(rb"^mnt_id:[ \t]+([0-9]+)$", fdinfo, re.M)
    _require(match is not None, "descriptor_invalid")
    mounts = _proc_bytes("/proc/self/mountinfo", 1024 * 1024)
    found = [line.split(b" - ", 1) for line in mounts.splitlines()
             if line.split(b" ", 1)[0] == match.group(1)]
    _require(len(found) == 1 and len(found[0]) == 2, "descriptor_invalid")
    left, right = found[0][0].split(), found[0][1].split()
    device = str(os.major(value.st_dev)) + ":" + str(os.minor(value.st_dev))
    _require(len(left) >= 6 and left[2] == device.encode("ascii")
             and len(right) >= 3 and right[0] == b"ext4", "descriptor_invalid")


class HeldDescriptor:
    """Only the six fixed production roles reach the command entry point."""

    def __init__(self, fd, size, sha256, uid, modes):
        self.fd, self.size, self.sha256 = fd, size, sha256
        self.uid, self.modes = uid, modes
        self.digest = None
        self.before = self.seal()

    def seal(self):
        value = os.fstat(self.fd)
        flags = fcntl.fcntl(self.fd, fcntl.F_GETFL)
        _require(stat.S_ISREG(value.st_mode) and value.st_uid == self.uid
                 and value.st_gid == self.uid and stat.S_IMODE(value.st_mode) in self.modes
                 and value.st_nlink == 1 and value.st_size == self.size
                 and flags & os.O_ACCMODE == os.O_RDONLY
                 and not flags & getattr(os, "O_PATH", 0), "descriptor_invalid")
        _fd_ext4(self.fd, value)
        result = _identity(value)
        _require(not hasattr(self, "before") or result == self.before, "source_changed")
        return result

    def read_at(self, position, length):
        _require(type(position) is int and type(length) is int and position >= 0
                 and 0 <= length <= CHUNK and position + length <= self.size,
                 "descriptor_invalid")
        chunks, at = [], position
        while at < position + length:
            value = os.pread(self.fd, position + length - at, at)
            _require(value, "source_changed")
            chunks.append(value)
            at += len(value)
        return b"".join(chunks)

    def fingerprint(self):
        self.seal()
        digest = hashlib.sha256()
        for at in range(0, self.size, CHUNK):
            digest.update(self.read_at(at, min(CHUNK, self.size - at)))
        _require(os.pread(self.fd, 1, self.size) == b"", "source_changed")
        actual = digest.hexdigest()
        _require(self.sha256 is None or actual == self.sha256, "fingerprint_invalid")
        _require(self.digest is None or actual == self.digest, "source_changed")
        self.digest = actual
        self.seal()
        return actual


class _BZ2Reader:
    """One bounded stream, with no extraction or concatenated-stream fallback."""

    def __init__(self, source, _max_bytes=MAX_TAR_BYTES):
        _require(type(_max_bytes) is int and 0 < _max_bytes <= MAX_TAR_BYTES)
        self.source, self.limit = source, _max_bytes
        self.decoder = bz2.BZ2Decompressor()
        self.position, self.total = 0, 0
        self.buffer, self.done = b"", False

    def read(self, length):
        _require(type(length) is int and 0 < length <= CHUNK)
        while len(self.buffer) < length and not self.done:
            if self.decoder.needs_input:
                _require(self.position < self.source.size)
                amount = min(CHUNK, self.source.size - self.position)
                compressed = self.source.read_at(self.position, amount)
                _require(type(compressed) is bytes and len(compressed) == amount)
                self.position += amount
            else:
                compressed = b""
            # At the exact limit, a one-byte probe must establish EOF or refuse.
            room = self.limit - self.total
            raw = self.decoder.decompress(compressed, max_length=min(CHUNK, room + 1))
            self.total += len(raw)
            _require(self.total <= self.limit)
            self.buffer += raw
            if self.decoder.eof:
                _require(not self.decoder.unused_data and self.position == self.source.size)
                self.done = True
            else:
                _require(raw or compressed or self.decoder.needs_input)
        value, self.buffer = self.buffer[:length], self.buffer[length:]
        return value

    def exact(self, length):
        value = self.read(length)
        _require(len(value) == length)
        return value


def _docker_binding(raw):
    raw.decode("utf-8", "strict")
    lines = raw.split(b"\n")
    for name, expected in ((b"PG_VERSION", b"17.11"), (b"PG_SHA256", PG_SHA256.encode("ascii"))):
        definitions = [line for line in lines if re.match(rb"^[ \t]*ENV[ \t]+" + name + rb"(?:[ \t=]|$)", line, re.I)]
        _require(definitions == [b"ENV " + name + b" " + expected], "binding_invalid")
    return {"commit": COMMIT, "root": "postgres-" + COMMIT, "pgVersion": "17.11",
            "pgSourceSha256": PG_SHA256, "symlinks": []}


def _load_old(code):
    code.fingerprint()
    loader = importlib.machinery.SourceFileLoader("auto_world_fixed_source_tar", "/proc/self/fd/8")
    spec = importlib.util.spec_from_loader(loader.name, loader)
    _require(spec is not None, "context_invalid")
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    code.fingerprint()
    return module


def _runtime_seals(runtime):
    for held, pin in zip(runtime, RUNTIME_PINS):
        _require(os.path.realpath(pin["path"]) == pin["path"], "descriptor_invalid")
        _require(_identity(os.stat(pin["path"], follow_symlinks=False)) == held.before, "source_changed")
        at = os.path.dirname(pin["path"])
        while True:
            value = os.stat(at, follow_symlinks=False)
            _require(stat.S_ISDIR(value.st_mode) and value.st_uid == 0 and value.st_gid == 0
                     and not stat.S_IMODE(value.st_mode) & 0o7022, "descriptor_invalid")
            if at == "/":
                break
            at = os.path.dirname(at)
        held.fingerprint()


def _inspect_sources(sources, old):
    archives = []
    for index, (source, pin) in enumerate(zip(sources, PINS)):
        source.fingerprint()
        reader = _BZ2Reader(source) if index == 0 else old._GzipReader(source)
        value = old._inspect_tar(source, pin["root"], pin["selected"],
                                 PG_PAX_DECLARED_COMMIT if index == 0 else COMMIT, _reader=reader)
        _require(value["entries"] == pin["entries"] and value["uncompressedBytes"] == pin["raw"]
                 and reader.total == pin["decoded"] and reader.done and not reader.buffer
                 and not value["symlinks"], "binding_invalid")
        selected = old._selected(value["files"], SELECTED_PINS[index])
        for raw in value["files"].values():
            raw.decode("utf-8", "strict")
        bindings = {"version": "17.11", "root": pin["root"], "symlinks": []} if index == 0 else _docker_binding(value["files"]["17/alpine3.24/Dockerfile"])
        source.fingerprint()
        archives.append({"role": pin["role"], "name": pin["name"], "size": pin["size"], "sha256": pin["sha256"],
                         "identity": source.before, "entries": value["entries"], "uncompressedBytes": value["uncompressedBytes"],
                         "decodedTarBytes": reader.total, "selectedFiles": selected,
                         "missingSelectedFiles": sorted(set(pin["selected"]) - value["files"].keys()), "bindings": bindings})
    return {"kind": "POSTGRES_UPSTREAM_SOURCE_INSPECTION_V1", "state": "VERIFIED",
            "scope": "FIXED_POSTGRES_UPSTREAM_SOURCE_ARCHIVES", "archives": archives}


def _diagnostic(reason):
    try:
        value = (PREFIX + (reason if reason in REASONS else "failed") + "\n").encode("ascii")
        at = 0
        while at < len(value):
            written = os.write(2, value[at:])
            if written <= 0:
                break
            at += written
    except BaseException:
        pass


def _close_descriptors(failure):
    for fd in range(3, 9):
        try:
            os.close(fd)
        except OSError:
            failure = "cleanup_uncertain"
    return failure


def _main():
    result, failure, old = None, None, None
    try:
        _native_actor()
        sources = [HeldDescriptor(fd, pin["size"], pin["sha256"], 1000, (0o600,)) for fd, pin in zip((3, 4), PINS)]
        runtime = [HeldDescriptor(fd, pin["size"], pin["sha256"], 0, (0o644,)) for fd, pin in zip((5, 6), RUNTIME_PINS)]
        self_size = os.fstat(7).st_size
        _require(0 < self_size <= MAX_OUTPUT_BYTES, "descriptor_invalid")
        own = HeldDescriptor(7, self_size, None, 1000, (0o600, 0o644))
        code = HeldDescriptor(8, OLD_HELPER_SIZE, OLD_HELPER_SHA256, 1000, (0o600, 0o644))
        held = sources + runtime + [own, code]
        _require(len({(item.before["dev"], item.before["ino"]) for item in held}) == 6, "descriptor_invalid")
        _runtime_seals(runtime)
        own.fingerprint()
        old = _load_old(code)
        old._native_actor()
        result = _inspect_sources(sources, old)
        _runtime_seals(runtime)
        for item in held:
            item.fingerprint()
        for item in held:
            item.seal()
    except BaseException as error:
        if isinstance(error, InspectionError) or old is not None and isinstance(error, old.InspectionError):
            failure = error.reason if error.reason in REASONS else "failed"
        else:
            failure = "failed"
    failure = _close_descriptors(failure)
    if failure is not None:
        _diagnostic(failure)
        return 1
    try:
        result["descriptorsClosed"] = True
        output = (json.dumps(result, ensure_ascii=True, separators=(",", ":")) + "\n").encode("ascii")
        _require(len(output) <= MAX_OUTPUT_BYTES, "output_failed")
        at = 0
        while at < len(output):
            written = os.write(1, output[at:])
            _require(written > 0, "output_failed")
            at += written
    except BaseException:
        _diagnostic("output_failed")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(_main())

"""Passive inspection of four fixed, inherited source archive descriptors.

Run only with the separately authenticated Python executable and -I -S -B.
The launcher authenticates the executable and selected stdlib files; those
pins do not establish the complete transitive Python/stdlib/native closure.
Pure parsing functions below permit harmless in-memory unit fixtures. The
command entry point has no path, policy, actor, or checksum override.
"""

import base64
import _struct
import hashlib
import json
import os
import re
import stat
import struct
import sys
import zlib

try:
    import fcntl
except ImportError:
    # Only pure parsers are portable. The command still requires native Linux.
    fcntl = None

PREFIX = "postgres_gosu_source_inspect_"
CHUNK = 64 * 1024
MAX_TAR_BYTES = 192 * 1024 * 1024
MAX_MEMBERS = 20000
MAX_MEMBER_BYTES = 16 * 1024 * 1024
MAX_NOTICE_BYTES = 16 * 1024
MAX_ZIP_BYTES = 2 * 1024 * 1024
MAX_ZIP_MEMBERS = 20000
MAX_ZIP_MEMBER_BYTES = 8 * 1024 * 1024
MAX_ZIP_RAW_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 128 * 1024
PAX_COMMIT = "6456aaa0f3c854d199d0f037f068eb97515b7513"
GOSU_SHA512 = "00ef15d982eb58d62cf67c6517d9560bb92cff5d1347f16b03e03bb3a6da08f2b85e8c3e6c23ae644f174f8da8e9154dcfe4ee379f894882e92b3602d7d079ed"
PINS = (
    {"role": "GOSU_SOURCE", "name": "gosu-1.19.tar.gz", "size": 17622,
     "sha256": "cd9719b775dbfedae53923c9b0dc792b66d42c51e0b36652ed6f747fbadc0164",
     "root": "gosu-1.19", "entries": 27, "raw": 50265,
     "selected": ("LICENSE", "NOTICE", "go.mod", "go.sum")},
    {"role": "MOBY_USER_MODULE_SOURCE", "name": "moby-sys-user-v0.1.0.zip", "size": 13793,
     "sha256": "85178932dc13b1c404c32e1b9f68fe88bf0b43e57dda39f24c45113e0bcf00ee",
     "module": "github.com/moby/sys/user", "entries": 7, "raw": 42341,
     "h1": "h1:WmZ93f5Ux6het5iituh9x2zAG7NFY9Aqi49jjE1PaQg=",
     "goModH1": "h1:fKJhFOnsCN6xZ5gSfbM6zaHGgDJMrqt9/reuj4T7MmU=",
     "selected": ("LICENSE", "NOTICE", "PATENTS", "go.mod")},
    {"role": "X_SYS_MODULE_SOURCE", "name": "golang-x-sys-v0.1.0.zip", "size": 1861264,
     "sha256": "e7cbe58ed3745ba63d482fe82603119bd635f9a5dd914ed95a4c1826fdcf54a7",
     "module": "golang.org/x/sys", "entries": 506, "raw": 8794105,
     "h1": "h1:kunALQeHf1/185U1i0GOB/fy1IPRDDpuoOOqRReG57U=",
     "goModH1": "h1:oPkhp1MJrh7nUepCBck5+mAzfO9JrbApNNgaTdGDITg=",
     "selected": ("LICENSE", "NOTICE", "PATENTS", "go.mod")},
    {"role": "GO_STDLIB_SOURCE", "name": "go1.26.8.src.tar.gz", "size": 34150120,
     "sha256": "4e39b98e42f946fa05ac8bc5b71877df97dbdb7cbb1a777b541667ad7117fd2e",
     "root": "go", "entries": 16677, "raw": 145142081,
     "selected": ("LICENSE", "NOTICE", "PATENTS", "VERSION")},
)
SELECTED_PINS = (
    {"LICENSE": (11358, "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"),
     "go.mod": (110, "0475f1708db81d718b633faf2d9dd64695037eabdc8562125060607bcb01b2ba"),
     "go.sum": (318, "2a8f3fb6adb84839bbb9999f12f1416fb86c184135aaa1c2e489b35203c08346")},
    {"LICENSE": (11358, "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"),
     "go.mod": (74, "91a578705d847c83a40f0e3149724863961cef2b2d7ca4262b40cefe487eff03")},
    {"LICENSE": (1479, "2d36597f7117c38b006835ae7f537487207d8ec407aa9d9980794b2030cbc067"),
     "PATENTS": (1303, "96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc"),
     "go.mod": (33, "f033333096fe198f3151deed93f2deba74e50bbfe7739134045bc3b7ce4a5024")},
    {"LICENSE": (1453, "911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad"),
     "PATENTS": (1303, "96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc"),
     "VERSION": (35, "25b231b380ff42bb887b29e7c2eb176167820f3416665cd4fbc2d3b116bc417d")},
)


class InspectionError(Exception):
    """Only this closed reason crosses the command boundary."""

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
    _require(sys.platform == "linux" and fcntl is not None and sys.version_info[:2] == (3, 12)
             and sys.flags.isolated == 1 and sys.flags.no_site == 1
             and sys.flags.dont_write_bytecode == 1 and len(sys.argv) == 1,
             "context_invalid")
    _require(sys.executable == "/usr/bin/python3.12"
             and zlib.__spec__.origin == "built-in" and _struct.__spec__.origin == "built-in"
             and json.__spec__.origin == "/usr/lib/python3.12/json/__init__.py"
             and base64.__spec__.origin == "/usr/lib/python3.12/base64.py", "context_invalid")
    _require(os.getresuid() == (1000, 1000, 1000)
             and os.getresgid() == (1000, 1000, 1000)
             and os.getgroups() == [], "context_invalid")
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
    mount_id = match.group(1)
    mounts = _proc_bytes("/proc/self/mountinfo", 1024 * 1024)
    found = [line.split(b" - ", 1) for line in mounts.splitlines()
             if line.split(b" ", 1)[0] == mount_id]
    _require(len(found) == 1 and len(found[0]) == 2, "descriptor_invalid")
    left, right = found[0][0].split(), found[0][1].split()
    device = str(os.major(value.st_dev)) + ":" + str(os.minor(value.st_dev))
    _require(len(left) >= 6 and left[2] == device.encode("ascii")
             and len(right) >= 3 and right[0] == b"ext4", "descriptor_invalid")


class HeldSource:
    """Read-only inherited FD; production supplies only the fixed PINS."""

    def __init__(self, fd, pin):
        self.fd = fd
        self.pin = pin
        self.size = pin["size"]
        self.before = self.seal()

    def seal(self):
        value = os.fstat(self.fd)
        flags = fcntl.fcntl(self.fd, fcntl.F_GETFL)
        _require(stat.S_ISREG(value.st_mode) and value.st_uid == 1000
                 and value.st_gid == 1000 and stat.S_IMODE(value.st_mode) == 0o600
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
        chunks = []
        at = position
        while at < position + length:
            value = os.pread(self.fd, position + length - at, at)
            _require(value, "source_changed")
            chunks.append(value)
            at += len(value)
        return b"".join(chunks)

    def fingerprint(self):
        self.seal()
        digest, sha512 = hashlib.sha256(), hashlib.sha512()
        for at in range(0, self.size, CHUNK):
            value = self.read_at(at, min(CHUNK, self.size - at))
            digest.update(value)
            sha512.update(value)
        _require(os.pread(self.fd, 1, self.size) == b"", "source_changed")
        _require(digest.hexdigest() == self.pin["sha256"], "fingerprint_invalid")
        self.seal()
        return sha512.hexdigest()


def _read_at(reader, position, length):
    _require(0 <= position <= reader.size and 0 <= length <= reader.size - position)
    parts = []
    for at in range(position, position + length, CHUNK):
        size = min(CHUNK, position + length - at)
        part = reader.read_at(at, size)
        _require(type(part) is bytes and len(part) == size)
        parts.append(part)
    return b"".join(parts)


class _GzipReader:
    def __init__(self, source):
        self.source = source
        self.decoder = zlib.decompressobj(31)
        self.position = 0
        self.pending = b""
        self.buffer = b""
        self.total = 0
        self.done = False

    def read(self, length):
        _require(0 < length <= CHUNK)
        while len(self.buffer) < length and not self.done:
            if not self.pending:
                _require(self.position < self.source.size)
                amount = min(CHUNK, self.source.size - self.position)
                self.pending = _read_at(self.source, self.position, amount)
                self.position += amount
            raw = self.decoder.decompress(self.pending, CHUNK)
            self.pending = self.decoder.unconsumed_tail
            self.total += len(raw)
            _require(self.total <= MAX_TAR_BYTES)
            self.buffer += raw
            if self.decoder.eof:
                _require(not self.decoder.unused_data and not self.pending
                         and self.position == self.source.size)
                self.done = True
        value, self.buffer = self.buffer[:length], self.buffer[length:]
        return value

    def exact(self, length):
        result = self.read(length)
        _require(len(result) == length)
        return result


def _text(raw):
    head, separator, tail = raw.partition(b"\0")
    _require(not separator or not any(tail))
    return head.decode("utf-8", "strict")


def _octal(raw):
    value = raw.strip(b" \0")
    _require(value and re.fullmatch(rb"[0-7]+", value))
    return int(value, 8)


def _path(value, root, directory=False):
    _require(type(value) is str and value and len(value.encode("utf-8")) <= 512
             and "\\" not in value and not any(ord(c) < 32 or ord(c) == 127 for c in value))
    if directory and value.endswith("/"):
        value = value[:-1]
    parts = value.split("/")
    _require(parts[0] == root and all(part not in ("", ".", "..") for part in parts))
    return value


def _pax(raw):
    result = {}
    at = 0
    while at < len(raw):
        space = raw.find(b" ", at)
        _require(space > at and re.fullmatch(rb"[1-9][0-9]*", raw[at:space]))
        length = int(raw[at:space])
        end = at + length
        _require(space < end - 1 <= len(raw) - 1 and raw[end - 1:end] == b"\n")
        key, separator, value = raw[space + 1:end - 1].partition(b"=")
        _require(separator and key in (b"comment", b"path") and key not in result)
        result[key] = value.decode("utf-8", "strict")
        at = end
    _require(at == len(raw) and result)
    return result


def _inspect_tar(source, root, selected, expected_pax=None, allowed_symlink=None, _reader=None):
    stream = _GzipReader(source) if _reader is None else _reader
    found, seen, folded, symlinks = {}, set(), set(), []
    entries, raw_total, extensions = 0, 0, 0
    comment, pending = None, None
    root_seen = False
    while True:
        header = stream.exact(512)
        if header == bytes(512):
            _require(pending is None and stream.exact(512) == bytes(512))
            padding = 0
            while True:
                tail = stream.read(512)
                if not tail:
                    break
                _require(len(tail) == 512 and tail == bytes(512))
                padding += 1
                _require(padding <= 32)
            break
        _require(header[257:265] == b"ustar\00000" and not any(header[500:]))
        _require(_octal(header[148:156]) == sum(header[:148]) + 8 * 32 + sum(header[156:]))
        for field in (header[100:108], header[108:116], header[116:124], header[136:148]):
            _octal(field)
        size = _octal(header[124:136])
        _require(size <= MAX_MEMBER_BYTES)
        name, prefix = _text(header[:100]), _text(header[345:500])
        name = prefix + "/" + name if prefix else name
        kind = header[156:157]
        if kind in (b"g", b"x"):
            _require(pending is None and size <= 4096 and extensions < 16)
            extensions += 1
            body = stream.exact(size) if size else b""
            padding = (-size) % 512
            _require(not any(stream.exact(padding)) if padding else True)
            fields = _pax(body)
            if kind == b"g":
                _require(entries == 0 and extensions == 1 and expected_pax is not None
                         and name == "pax_global_header" and fields == {b"comment": expected_pax})
                comment = fields[b"comment"]
            else:
                _path(name, root)
                _require(expected_pax is None and fields.keys() == {b"path"})
                pending = fields[b"path"]
            continue
        _require(kind in (b"0", b"\0", b"5", b"2"))
        if pending is not None:
            _require(kind in (b"0", b"\0"))
            name, pending = pending, None
        name = _path(name, root, kind == b"5")
        _require(name not in seen and name.casefold() not in folded)
        seen.add(name)
        folded.add(name.casefold())
        entries += 1
        raw_total += size
        _require(entries <= MAX_MEMBERS and raw_total <= MAX_TAR_BYTES)
        relative = name[len(root):].lstrip("/")
        link = _text(header[157:257])
        if not relative:
            _require(entries == 1 and kind == b"5" and not root_seen)
            root_seen = True
        if kind in (b"5", b"2"):
            _require(size == 0)
        if kind == b"2":
            _require(allowed_symlink is not None and (relative, link) == allowed_symlink and not symlinks)
            symlinks.append({"path": relative, "target": link, "followed": False})
        else:
            _require(not link)
        capture = relative in selected
        _require(not capture or kind in (b"0", b"\0") and size <= MAX_NOTICE_BYTES)
        chunks = []
        remaining = size
        while remaining:
            value = stream.exact(min(CHUNK, remaining))
            if capture:
                chunks.append(value)
            remaining -= len(value)
        if capture:
            found[relative] = b"".join(chunks)
        padding = (-size) % 512
        _require(not any(stream.exact(padding)) if padding else True)
    _require(root_seen and stream.done and not stream.buffer
             and stream.total % 512 == 0 and comment == expected_pax)
    _require(allowed_symlink is None and not symlinks or
             allowed_symlink is not None and len(symlinks) == 1)
    return {"entries": entries, "uncompressedBytes": raw_total, "files": found,
            "symlinks": symlinks, "paxCommit": comment}


def _hash1(rows):
    summary = b"".join((digest + "  " + name + "\n").encode("utf-8")
                       for name, digest in sorted(rows))
    return "h1:" + base64.b64encode(hashlib.sha256(summary).digest()).decode("ascii")


def _zip_entry(source, item, capture):
    digest, crc, raw_size, saved = hashlib.sha256(), 0, 0, []
    decoder = zlib.decompressobj(-15) if item["method"] == 8 else None
    for at in range(item["data"], item["data"] + item["compressed"], CHUNK):
        value = _read_at(source, at, min(CHUNK, item["data"] + item["compressed"] - at))
        pending = value
        while pending:
            raw = decoder.decompress(pending, CHUNK) if decoder else pending
            pending = decoder.unconsumed_tail if decoder else b""
            raw_size += len(raw)
            _require(raw_size <= item["raw"] and raw_size <= MAX_ZIP_MEMBER_BYTES)
            digest.update(raw)
            crc = zlib.crc32(raw, crc)
            if capture:
                _require(raw_size <= MAX_NOTICE_BYTES)
                saved.append(raw)
            if decoder and decoder.eof:
                _require(not decoder.unused_data and not pending
                         and at + len(value) == item["data"] + item["compressed"])
    _require(raw_size == item["raw"] and crc & 0xffffffff == item["crc"]
             and (decoder is None or decoder.eof and not decoder.unused_data))
    return digest.hexdigest(), b"".join(saved)


def _inspect_zip(source, module, selected):
    _require(22 <= source.size <= MAX_ZIP_BYTES)
    end = _read_at(source, source.size - 22, 22)
    signature, disk, central_disk, disk_count, count, central_size, central_at, comment = struct.unpack("<4s4H2IH", end)
    _require(signature == b"PK\5\6" and disk == central_disk == 0 and disk_count == count
             and 0 < count <= MAX_ZIP_MEMBERS and count < 0xffff and comment == 0
             and central_size <= MAX_ZIP_BYTES and central_at + central_size + 22 == source.size)
    central = _read_at(source, central_at, central_size)
    cursor, local_at, raw_total = 0, 0, 0
    seen, folded, rows, found = set(), set(), [], {}
    prefix = module + "@v0.1.0/"
    for _ordinal in range(count):
        _require(cursor + 46 <= len(central))
        fields = struct.unpack_from("<4s6H3I5H2I", central, cursor)
        (sig, made, needed, flags, method, time, date, crc, compressed, raw,
         name_length, extra, note, disk, internal, external, offset) = fields
        _require(sig == b"PK\1\2" and made == needed == 20 and flags == 8
                 and method in (0, 8) and time == date == 0 and extra == note == disk == internal == external == 0
                 and 0 < name_length <= 512 and cursor + 46 + name_length <= len(central)
                 and compressed < 0xffffffff and raw <= MAX_ZIP_MEMBER_BYTES and offset == local_at
                 and (method != 0 or compressed == raw))
        encoded = central[cursor + 46:cursor + 46 + name_length]
        name = encoded.decode("ascii", "strict")
        _require(name.startswith(prefix) and name not in seen and name.casefold() not in folded
                 and "\\" not in name and not any(ord(c) < 32 or ord(c) == 127 for c in name)
                 and all(part not in ("", ".", "..") for part in name.split("/")))
        seen.add(name)
        folded.add(name.casefold())
        raw_total += raw
        _require(raw_total <= MAX_ZIP_RAW_BYTES)
        header = _read_at(source, offset, 30)
        local = struct.unpack("<4s5H3I2H", header)
        _require(local == (b"PK\3\4", needed, flags, method, time, date, 0, 0, 0, name_length, 0))
        _require(_read_at(source, offset + 30, name_length) == encoded)
        data_at = offset + 30 + name_length
        descriptor_at = data_at + compressed
        _require(descriptor_at + 16 <= central_at)
        _require(struct.unpack("<4s3I", _read_at(source, descriptor_at, 16)) == (b"PK\7\10", crc, compressed, raw))
        relative = name[len(prefix):]
        item = {"method": method, "compressed": compressed, "raw": raw, "crc": crc, "data": data_at}
        digest, value = _zip_entry(source, item, relative in selected)
        rows.append((name, digest))
        if relative in selected:
            found[relative] = value
        local_at = descriptor_at + 16
        cursor += 46 + name_length
    _require(cursor == len(central) and local_at == central_at and "go.mod" in found)
    return {"entries": count, "uncompressedBytes": raw_total, "files": found,
            "h1": _hash1(rows), "goModH1": _hash1([("go.mod", hashlib.sha256(found["go.mod"]).hexdigest())])}


def _selected(files, expected):
    _require(files.keys() == expected.keys(), "binding_invalid")
    result = []
    for name in sorted(files):
        value = files[name]
        digest = hashlib.sha256(value).hexdigest()
        _require((len(value), digest) == expected[name], "binding_invalid")
        result.append({"path": name, "size": len(value), "sha256": digest,
                       "base64": base64.b64encode(value).decode("ascii")})
    return result


def _inspect_sources(sources):
    archives, go_sum = [], None
    for index, (source, pin) in enumerate(zip(sources, PINS)):
        sha512 = source.fingerprint()
        if index == 0:
            _require(sha512 == GOSU_SHA512, "binding_invalid")
            value = _inspect_tar(source, pin["root"], pin["selected"], PAX_COMMIT, (".dockerignore", ".gitignore"))
            bindings = {"sha512": sha512, "root": pin["root"], "paxCommit": value["paxCommit"], "symlinks": value["symlinks"]}
            lines = value["files"].get("go.sum", b"").decode("ascii", "strict").splitlines()
            parts = [line.split(" ") for line in lines]
            _require(len(parts) == 4 and all(len(row) == 3 for row in parts), "binding_invalid")
            go_sum = {(row[0], row[1]): row[2] for row in parts}
            _require(len(go_sum) == 4, "binding_invalid")
        elif index in (1, 2):
            value = _inspect_zip(source, pin["module"], pin["selected"])
            _require(value["h1"] == pin["h1"] and value["goModH1"] == pin["goModH1"]
                     and go_sum.get((pin["module"], "v0.1.0")) == pin["h1"]
                     and go_sum.get((pin["module"], "v0.1.0/go.mod")) == pin["goModH1"], "binding_invalid")
            bindings = {"module": pin["module"], "version": "v0.1.0", "h1": value["h1"], "goModH1": value["goModH1"]}
        else:
            value = _inspect_tar(source, pin["root"], pin["selected"])
            _require(value["files"].get("VERSION") == b"go1.26.8\ntime 2026-08-28T16:20:06Z\n", "binding_invalid")
            bindings = {"version": "go1.26.8", "root": pin["root"], "symlinks": value["symlinks"]}
        _require(value["entries"] == pin["entries"] and value["uncompressedBytes"] == pin["raw"], "binding_invalid")
        selected = _selected(value["files"], SELECTED_PINS[index])
        source.fingerprint()
        archives.append({"role": pin["role"], "name": pin["name"], "size": pin["size"], "sha256": pin["sha256"],
                         "identity": source.before, "entries": value["entries"], "uncompressedBytes": value["uncompressedBytes"],
                         "selectedFiles": selected, "missingSelectedFiles": sorted(set(pin["selected"]) - value["files"].keys()),
                         "bindings": bindings})
    for source in sources:
        source.fingerprint()
    for source in sources:
        source.seal()
    return {"kind": "POSTGRES_GOSU_SOURCE_INSPECTION_V1", "state": "VERIFIED",
            "scope": "FIXED_GOSU_GO_DECLARED_SOURCE_ARCHIVES", "archives": archives}


def _diagnostic(reason):
    # A closed stderr pipe must not turn a fixed failure into a traceback.
    try:
        value = (PREFIX + reason + "\n").encode("ascii")
        at = 0
        while at < len(value):
            count = os.write(2, value[at:])
            if count <= 0:
                break
            at += count
    except BaseException:
        pass


def _main():
    result, failure = None, None
    try:
        _native_actor()
        sources = [HeldSource(fd, pin) for fd, pin in zip(range(3, 7), PINS)]
        _require(len({(item.before["dev"], item.before["ino"]) for item in sources}) == 4, "descriptor_invalid")
        result = _inspect_sources(sources)
    except InspectionError as error:
        failure = error.reason
    except BaseException:
        failure = "failed"
    for fd in range(3, 7):
        try:
            os.close(fd)
        except OSError:
            failure = "cleanup_uncertain"
    if failure is not None:
        _diagnostic(failure)
        return 1
    try:
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

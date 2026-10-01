"""Passive, bounded notice discovery in an authenticated inherited source FD.

No extraction, link following, archive code imports, recipes, or shell calls.
The caller authenticates this reviewed code and the managed Python runtime.
This reader establishes notice candidates, never source/legal/admission closure.
"""

import bz2
import hashlib
import io
import json
import lzma
import os
import re
try:
    import resource
except ImportError:
    resource = None
import stat
import struct
import sys
import tarfile
import zipfile
import zlib

try:
    import fcntl
except ImportError:
    fcntl = None

PREFIX = "postgres_source_archive_notice_"
CHUNK = 65536
LIMITS = {"archiveBytes": 1024 ** 3, "decodedBytes": 8 * 1024 ** 3,
          "members": 250000, "noticeBytes": 256 * 1024, "pathBytes": 4096,
          "outputBytes": 32 * 1024 ** 2, "candidates": 10000,
          "extensionBytes": 64 * 1024, "zipDirectoryBytes": 64 * 1024 ** 2,
          "indexBytes": 64 * 1024 ** 2}
GCC_15_2_0_PROFILE = {
    "name": "GCC_15_2_0_EXACT_SOURCE_V1",
    "source": {
        "size": 101056276,
        "sha256": "438fd996826b0c82485a29da03a72d71d6e3541a83ec702df4271f6fe025d24e",
    },
    "bounds": {**LIMITS, "members": 500000},
    "memoryLimit": {"resource": "RLIMIT_AS", "bytes": 512 * 1024 ** 2},
}
ENVIRONMENT = {"PATH": "/usr/bin:/bin", "HOME": "/home/autoworld", "LANG": "C.UTF-8",
               "LC_ALL": "C.UTF-8", "TZ": "UTC"}
NOTICE = re.compile(r"^(?:licen[cs]e|copying[23]?|copyright|notice|patents|legal)s?(?:[._-].*)?$", re.I)
REASONS = {"context_invalid", "input_invalid", "descriptor_invalid", "source_changed", "checksum_mismatch",
           "format_unsupported", "archive_invalid", "decoder_invalid", "decoder_trailing_data", "decoded_limit",
           "member_limit", "path_invalid", "duplicate_path", "notice_limit", "candidate_limit",
           "extension_limit", "sparse_unsupported", "zip_directory_limit", "index_limit", "output_limit", "cleanup_uncertain"}


class InspectionError(Exception):
    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def require(condition, reason):
    if not condition:
        raise InspectionError(reason)


def source_profile(expected, _anchor):
    pinned = GCC_15_2_0_PROFILE["source"]
    if expected["size"] != pinned["size"] or expected["sha256"] != pinned["sha256"]:
        return None
    return GCC_15_2_0_PROFILE


def activate_profile(profile):
    require(profile is GCC_15_2_0_PROFILE and resource is not None, "context_invalid")
    memory = profile["memoryLimit"]["bytes"]
    try:
        _, hard = resource.getrlimit(resource.RLIMIT_AS)
        require(hard == resource.RLIM_INFINITY or hard >= memory, "context_invalid")
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        require(resource.getrlimit(resource.RLIMIT_AS) == (memory, memory), "context_invalid")
    except (OSError, ValueError):
        raise InspectionError("context_invalid") from None
    LIMITS["members"] = profile["bounds"]["members"]
    return {"name": profile["name"], "bounds": dict(profile["bounds"]),
            "memoryLimit": dict(profile["memoryLimit"])}


def native(value):
    return {"dev": str(value.st_dev), "ino": str(value.st_ino), "uid": value.st_uid,
            "gid": value.st_gid, "mode": stat.S_IMODE(value.st_mode), "nlink": value.st_nlink,
            "size": value.st_size, "mtimeNs": str(value.st_mtime_ns), "ctimeNs": str(value.st_ctime_ns)}


def path_value(value, directory=False):
    require(isinstance(value, str) and value and len(value.encode("utf-8", "strict")) <= LIMITS["pathBytes"]
            and not any(ord(c) < 32 or ord(c) == 127 for c in value)
            and "\\" not in value and "//" not in value and not value.startswith("/")
            and re.match(r"^[A-Za-z]:", value) is None, "path_invalid")
    if value.startswith("./"):
        value = value[2:]
    if directory and value.endswith("/"):
        value = value[:-1]
    if directory and value in ("", "."):
        return ""
    require(value and all(part not in ("", ".", "..") for part in value.split("/")), "path_invalid")
    return value


def link_value(value):
    require(isinstance(value, str) and value and len(value.encode("utf-8", "strict")) <= LIMITS["pathBytes"]
            and not any(ord(c) < 32 or ord(c) == 127 for c in value), "path_invalid")
    return value


class PositionedReader(io.RawIOBase):
    """Borrowed FD; neither close nor seeking changes the inherited FD cursor."""

    def __init__(self, fd, size):
        self.fd, self.size, self.position = fd, size, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        position = offset if whence == io.SEEK_SET else self.position + offset if whence == io.SEEK_CUR else self.size + offset
        require(type(position) is int and 0 <= position <= self.size, "archive_invalid")
        self.position = position
        return position

    def read(self, size=-1):
        if size < 0:
            size = self.size - self.position
        value = os.pread(self.fd, min(size, self.size - self.position), self.position)
        self.position += len(value)
        return value

    def readinto(self, buffer):
        value = self.read(len(buffer))
        buffer[:len(value)] = value
        return len(value)


class DecodedReader:
    """One complete gzip/bzip2/xz stream, bounded incremental output."""

    def __init__(self, source, compression):
        self.source, self.compression = source, compression
        self.decoder = (zlib.decompressobj(16 + zlib.MAX_WBITS) if compression == "GZIP"
                        else bz2.BZ2Decompressor() if compression == "BZIP2"
                        else lzma.LZMADecompressor(format=lzma.FORMAT_XZ, memlimit=128 * 1024 ** 2)
                        if compression == "XZ" else None)
        self.pending, self.buffer, self.total, self.ended = b"", b"", 0, False

    def _chunk(self):
        if self.ended:
            return b""
        if self.decoder is None:
            value = self.source.read(CHUNK)
            self.ended = not value
        else:
            if self.compression == "GZIP":
                incoming = self.pending or self.source.read(CHUNK)
            else:
                incoming = self.source.read(CHUNK) if self.decoder.needs_input else b""
            value = self.decoder.decompress(incoming, CHUNK)
            self.pending = self.decoder.unconsumed_tail if self.compression == "GZIP" else b""
            if self.decoder.eof:
                require(not self.decoder.unused_data and not self.source.read(1), "decoder_trailing_data")
                self.ended = True
            elif not incoming and not value and (self.compression == "GZIP" or self.decoder.needs_input):
                raise InspectionError("decoder_invalid")
        self.total += len(value)
        require(self.total <= LIMITS["decodedBytes"], "decoded_limit")
        return value

    def read(self, size):
        require(type(size) is int and 0 <= size <= LIMITS["decodedBytes"], "archive_invalid")
        pieces, remaining = [], size
        while remaining:
            if not self.buffer:
                self.buffer = self._chunk()
                if not self.buffer:
                    if self.ended:
                        break
                    continue
            take = min(remaining, len(self.buffer))
            pieces.append(self.buffer[:take])
            self.buffer = self.buffer[take:]
            remaining -= take
        return b"".join(pieces)

    def close(self):
        self.decoder, self.buffer, self.pending = None, b"", b""


class BoundedTarInfo(tarfile.TarInfo):
    """Small guards around Python 3.12 extension handling, not a TAR parser."""

    def _proc_member(self, archive):
        archive._notice_header_count = getattr(archive, "_notice_header_count", 0) + 1
        require(archive._notice_header_count <= LIMITS["members"], "member_limit")
        self._pax_bound(archive.pax_headers)
        return super()._proc_member(archive)

    @staticmethod
    def _pax_bound(values):
        require(sum(len(key.encode("utf-8")) + len(value.encode("utf-8")) for key, value in values.items())
                <= LIMITS["extensionBytes"], "extension_limit")

    def _proc_pax(self, archive):
        require(self.size <= LIMITS["extensionBytes"], "extension_limit")
        value = super()._proc_pax(archive)
        self._pax_bound(archive.pax_headers)
        self._pax_bound(value.pax_headers)
        return value

    def _proc_gnulong(self, archive):
        require(self.size <= LIMITS["pathBytes"] + 1, "extension_limit")
        return super()._proc_gnulong(archive)

    def _proc_sparse(self, archive):
        raise InspectionError("sparse_unsupported")

    def _proc_gnusparse_00(self, next_info, raw_headers):
        raise InspectionError("sparse_unsupported")

    def _proc_gnusparse_01(self, next_info, pax_headers):
        raise InspectionError("sparse_unsupported")

    def _proc_gnusparse_10(self, next_info, pax_headers, archive):
        raise InspectionError("sparse_unsupported")


def member_hash(opened, size):
    value, total = hashlib.sha256(), 0
    while True:
        part = opened.read(CHUNK)
        if not part:
            break
        total += len(part)
        require(total <= size, "archive_invalid")
        value.update(part)
    require(total == size, "archive_invalid")
    return value.hexdigest()


def candidate(path):
    return bool(NOTICE.fullmatch(path.rsplit("/", 1)[-1]))


def append_candidate(values, path, kind, size, digest=None, link=None):
    if not candidate(path):
        return
    require(len(values) < LIMITS["candidates"], "candidate_limit")
    values.append({"path": path, "type": kind, "size": size, "sha256": digest,
                   "linkTarget": link, "resolution": "REGULAR_FILE_BYTES_OBSERVED" if kind == "REGULAR_FILE"
                   else "UNRESOLVED_NO_FOLLOW" if kind in ("SYMLINK", "HARDLINK") else "NON_REGULAR_NO_CONTENT"})


def tar_members(source, compression):
    reader = DecodedReader(source, compression)
    names, values, members, declared, index_bytes = set(), [], 0, 0, 0
    try:
        with tarfile.open(fileobj=reader, mode="r|", tarinfo=BoundedTarInfo, encoding="utf-8", errors="strict") as archive:
            for info in archive:
                members += 1
                require(members <= LIMITS["members"] and not info.issparse(), "member_limit" if members > LIMITS["members"] else "sparse_unsupported")
                require(type(info.size) is int and info.size >= 0, "archive_invalid")
                path = path_value(info.name, info.isdir())
                folded = path.casefold()
                require(folded not in names, "duplicate_path")
                names.add(folded)
                index_bytes += len(folded.encode("utf-8"))
                require(index_bytes <= LIMITS["indexBytes"], "index_limit")
                declared += info.size
                require(declared <= LIMITS["decodedBytes"], "decoded_limit")
                if info.isreg():
                    if candidate(path):
                        require(info.size <= LIMITS["noticeBytes"], "notice_limit")
                        with archive.extractfile(info) as opened:
                            append_candidate(values, path, "REGULAR_FILE", info.size, member_hash(opened, info.size))
                elif info.issym() or info.islnk():
                    require(info.size == 0, "archive_invalid")
                    append_candidate(values, path, "SYMLINK" if info.issym() else "HARDLINK", 0, link=link_value(info.linkname))
                else:
                    require(info.isdir() or info.ischr() or info.isblk() or info.isfifo(), "format_unsupported")
                    require(info.size == 0, "archive_invalid")
                    kind = "DIRECTORY" if info.isdir() else "CHARACTER_DEVICE" if info.ischr() else "BLOCK_DEVICE" if info.isblk() else "FIFO"
                    append_candidate(values, path, kind, 0)
                # Forward-only regular reads never need TarFile's growing cache
                # (in particular, no retained copies of global PAX dictionaries).
                archive.members.clear()
            # Python stopped at the first zero header. Demand another zero block
            # and only zero padding through complete decoder EOF, not another TAR.
            trailing = 0
            while True:
                part = archive.fileobj.read(CHUNK)
                if not part:
                    break
                trailing += len(part)
                require(not any(part), "archive_invalid")
            require(trailing >= 512 and reader.ended and reader.total % 512 == 0, "archive_invalid")
        return {"format": "TAR", "compression": compression,
                "counts": {"members": members, "noticeCandidates": len(values), "declaredDecodedBytes": declared,
                           "decodedStreamBytes": reader.total}, "candidates": values,
                "coverage": {"memberEnumeration": "STDLIB_MEMBERS_OBSERVED", "payloadValidation": "NOTICE_BYTES_HASHED",
                             "archiveEnvelopeValidation": "DECODER_EOF_AND_ZERO_TRAILER_CHECKED",
                             "gaps": ["TAR_MEMBER_PADDING_AND_EXTENSION_SEMANTICS_NOT_FULLY_VALIDATED"]}}
    finally:
        reader.close()


def zip_directory(source):
    size = source.size
    require(size >= 22, "archive_invalid")
    source.seek(max(0, size - 65557))
    tail = source.read(65557)
    index = tail.rfind(b"PK\x05\x06")
    require(index >= 0 and len(tail) - index >= 22, "archive_invalid")
    _, disk, start_disk, count_disk, count, length, offset, comment = struct.unpack("<4s4H2LH", tail[index:index + 22])
    require(disk == start_disk == 0 and count_disk == count, "format_unsupported")
    require(count != 65535 and length != 0xffffffff and offset != 0xffffffff, "format_unsupported")
    require(count <= LIMITS["members"] and length <= LIMITS["zipDirectoryBytes"], "zip_directory_limit")
    require(index + 22 + comment == len(tail) and offset + length == size - len(tail) + index, "archive_invalid")
    source.seek(0)


def zip_members(source):
    zip_directory(source)
    names, values, declared, total, index_bytes = set(), [], 0, 0, 0
    with zipfile.ZipFile(source, "r", allowZip64=False) as archive:
        infos = archive.infolist()
        require(len(infos) <= LIMITS["members"], "member_limit")
        for info in infos:
            require(info.orig_filename == info.filename and not info.flag_bits & 1
                    and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA), "format_unsupported")
            path = path_value(info.filename, info.is_dir())
            require(path.casefold() not in names, "duplicate_path")
            names.add(path.casefold())
            index_bytes += len(path.casefold().encode("utf-8"))
            require(index_bytes <= LIMITS["indexBytes"], "index_limit")
            declared += info.file_size
            require(declared <= LIMITS["decodedBytes"], "decoded_limit")
            mode = (info.external_attr >> 16) & 0xffff
            require(not stat.S_IFMT(mode) or stat.S_ISREG(mode) or stat.S_ISDIR(mode) or stat.S_ISLNK(mode), "format_unsupported")
            require(not stat.S_IFMT(mode) or info.is_dir() == stat.S_ISDIR(mode), "format_unsupported")
            if candidate(path) and not info.is_dir():
                require(info.file_size <= (LIMITS["pathBytes"] if stat.S_ISLNK(mode) else LIMITS["noticeBytes"]), "notice_limit")
        for info in infos:
            path = path_value(info.filename, info.is_dir())
            symlink = stat.S_ISLNK((info.external_attr >> 16) & 0xffff)
            digest, member_total, link_bytes = hashlib.sha256(), 0, []
            with archive.open(info, "r") as opened:
                while True:
                    part = opened.read(CHUNK)
                    if not part:
                        break
                    member_total += len(part)
                    total += len(part)
                    require(member_total <= info.file_size and total <= LIMITS["decodedBytes"], "decoded_limit")
                    digest.update(part)
                    if symlink and candidate(path):
                        link_bytes.append(part)
            require(member_total == info.file_size, "archive_invalid")
            if info.is_dir():
                require(info.file_size == 0, "archive_invalid")
                append_candidate(values, path, "DIRECTORY", 0)
            elif symlink:
                target = link_value(b"".join(link_bytes).decode("utf-8", "strict")) if candidate(path) else None
                append_candidate(values, path, "SYMLINK", info.file_size, link=target)
            else:
                append_candidate(values, path, "REGULAR_FILE", info.file_size, digest.hexdigest())
    return {"format": "ZIP", "compression": "PER_MEMBER",
            "counts": {"members": len(infos), "noticeCandidates": len(values), "declaredDecodedBytes": declared,
                       "decodedStreamBytes": total}, "candidates": values,
            "coverage": {"memberEnumeration": "STDLIB_MEMBERS_OBSERVED", "payloadValidation": "ALL_MEMBER_CRC_READS",
                         "archiveEnvelopeValidation": "CENTRAL_DIRECTORY_AND_EOCD_CHECKED",
                         "gaps": ["ZIP_LOCAL_PADDING_AND_EXTRA_FIELDS_NOT_FULLY_VALIDATED"]}}


def inspect_archive(source):
    require(0 < source.size <= LIMITS["archiveBytes"], "input_invalid")
    source.seek(0)
    prefix = source.read(512)
    source.seek(0)
    if prefix.startswith((b"PK\x03\x04", b"PK\x05\x06")):
        result = zip_members(source)
    elif prefix.startswith(b"\x1f\x8b"):
        result = tar_members(source, "GZIP")
    elif prefix.startswith(b"BZh"):
        result = tar_members(source, "BZIP2")
    elif prefix.startswith(b"\xfd7zXZ\x00"):
        result = tar_members(source, "XZ")
    elif len(prefix) == 512 and (prefix[257:265] in (b"ustar\x0000", b"ustar  \x00") or not any(prefix)):
        result = tar_members(source, "NONE")
    else:
        raise InspectionError("format_unsupported")
    result["candidates"].sort(key=lambda value: value["path"])
    require(len(json.dumps(result, ensure_ascii=True).encode()) <= LIMITS["outputBytes"], "output_limit")
    return result


def proc(path, maximum):
    with open(path, "rb", buffering=0) as opened:
        value = opened.read(maximum + 1)
    require(len(value) <= maximum, "context_invalid")
    return value


def context():
    require(sys.platform == "linux" and sys.version_info[:2] == (3, 12) and fcntl is not None and resource is not None
            and sys.executable == "/usr/bin/python3.12" and len(sys.argv) == 1
            and sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode
            and dict(os.environ) == ENVIRONMENT, "context_invalid")
    require(os.getresuid() == (1000, 1000, 1000) and os.getresgid() == (1000, 1000, 1000)
            and os.getgroups() == [], "context_invalid")
    status = proc("/proc/self/status", 16384)
    for label in (b"Uid", b"Gid"):
        require(re.search(rb"^" + label + rb":[ \t]+1000[ \t]+1000[ \t]+1000[ \t]+1000$", status, re.M), "context_invalid")
    require(re.search(rb"^Groups:[ \t]*$", status, re.M) and re.search(rb"^NoNewPrivs:[ \t]+1$", status, re.M), "context_invalid")
    for label in (b"CapInh", b"CapPrm", b"CapEff", b"CapAmb"):
        require(re.search(rb"^" + label + rb":[ \t]+0{16}$", status, re.M), "context_invalid")


def input_value():
    raw = sys.stdin.buffer.read(4097)
    require(len(raw) <= 4096, "input_invalid")
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, "input_invalid")
            result[key] = value
        return result
    value = json.loads(raw.decode("utf-8", "strict"), object_pairs_hook=pairs)
    require(type(value) is dict and set(value) == {"fd", "size", "sha256"}
            and type(value["fd"]) is int and value["fd"] == 3 and type(value["size"]) is int
            and 0 < value["size"] <= LIMITS["archiveBytes"] and type(value["sha256"]) is str
            and re.fullmatch(r"[0-9a-f]{64}", value["sha256"]), "input_invalid")
    return value


def descriptor(fd):
    value = os.fstat(fd)
    require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1 and value.st_uid == value.st_gid == 1000
            and stat.S_IMODE(value.st_mode) == 0o600
            and fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_ACCMODE == os.O_RDONLY, "descriptor_invalid")
    info = proc("/proc/self/fdinfo/" + str(fd), 4096)
    flags = re.search(rb"^flags:[ \t]+([0-7]+)$", info, re.M)
    mount = re.search(rb"^mnt_id:[ \t]+([0-9]+)$", info, re.M)
    require(flags and int(flags.group(1), 8) & os.O_ACCMODE == os.O_RDONLY and mount, "descriptor_invalid")
    mount_lines = proc("/proc/self/mountinfo", 1024 * 1024).splitlines()
    require(any(line.split(b" ", 1)[0] == mount.group(1) and b" - ext4 " in line for line in mount_lines), "descriptor_invalid")
    named = os.readlink("/proc/self/fd/" + str(fd))
    require(named.startswith("/") and not named.endswith(" (deleted)") and native(os.lstat(named)) == native(value), "descriptor_invalid")
    return native(value), named


def seal(fd, expected, anchor, named):
    require(native(os.fstat(fd)) == anchor and native(os.lstat(named)) == anchor, "source_changed")
    digest, at = hashlib.sha256(), 0
    while at < expected["size"]:
        part = os.pread(fd, min(CHUNK, expected["size"] - at), at)
        require(part, "source_changed")
        at += len(part)
        digest.update(part)
    require(not os.pread(fd, 1, at), "source_changed")
    require(digest.hexdigest() == expected["sha256"], "checksum_mismatch")
    require(native(os.fstat(fd)) == anchor and native(os.lstat(named)) == anchor, "source_changed")


def main():
    owned, result, failure, uncertain = False, None, None, False
    try:
        context()
        expected = input_value()
        anchor, named = descriptor(3)
        owned = True
        require(anchor["size"] == expected["size"], "source_changed")
        seal(3, expected, anchor, named)
        profile = source_profile(expected, anchor)
        profile_observation = activate_profile(profile) if profile is not None else None
        with PositionedReader(3, expected["size"]) as opened:
            parsed = inspect_archive(opened)
        if profile_observation is not None:
            parsed["inspectionProfile"] = profile_observation
        seal(3, expected, anchor, named)
        result = {"kind": "POSTGRES_SOURCE_ARCHIVE_NOTICE_INSPECTION_V1", "state": "NOTICE_CANDIDATES_OBSERVED",
                  "scope": "PASSIVE_SOURCE_ARCHIVE_NOTICE_CANDIDATES", "source": {"size": expected["size"],
                  "sha256": expected["sha256"], "identity": anchor}, **parsed, "noticeClosure": "NOT_ESTABLISHED",
                  "sourceClosure": "NOT_ESTABLISHED", "admission": "NONE", "descriptorsClosed": True}
    except BaseException as error:
        failure = error.reason if isinstance(error, InspectionError) and error.reason in REASONS else "archive_invalid"
    finally:
        if owned:
            try:
                os.close(3)
            except OSError:
                uncertain = True
        else:
            uncertain = True
    if failure is not None or uncertain:
        message = {"state": "INCOMPLETE", "code": PREFIX + ("cleanup_uncertain" if uncertain and owned else failure or "cleanup_uncertain"),
                   "cleanup": "UNVERIFIED" if uncertain else "CONFIRMED"}
        sys.stderr.write(json.dumps(message, sort_keys=True, separators=(",", ":")) + "\n")
        return 1
    output = json.dumps(result, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    require(len(output) <= LIMITS["outputBytes"], "output_limit")
    sys.stdout.buffer.write(output)
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except InspectionError:
        sys.stderr.write('{"cleanup":"CONFIRMED","code":"postgres_source_archive_notice_output_limit","state":"INCOMPLETE"}\n')
        raise SystemExit(1)
    except (BrokenPipeError, OSError):
        raise SystemExit(1)

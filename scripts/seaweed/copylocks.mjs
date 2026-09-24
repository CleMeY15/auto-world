import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

// Exact diagnostics from pristine c507336 source files, observed in native run35860660822.
// Ordering may vary with -p=2; content and multiplicity must not vary.
export const BASELINE_COPYLOCKS = Object.freeze([
  "admin/plugin/plugin_scheduler.go:599:18: assignment copies lock value to adminConfig: github.com/seaweedfs/seaweedfs/weed/pb/plugin_pb.AdminRuntimeConfig contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "admin/plugin/registry.go:480:9: assignment copies lock value to out: github.com/seaweedfs/seaweedfs/weed/pb/plugin_pb.JobTypeCapability contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "admin/plugin/registry.go:488:9: assignment copies lock value to out: github.com/seaweedfs/seaweedfs/weed/pb/plugin_pb.WorkerHeartbeat contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "admin/plugin/registry.go:495:13: assignment copies lock value to clone: github.com/seaweedfs/seaweedfs/weed/pb/plugin_pb.RunningWork contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "cluster/lock_ring_manager.go:96:8: assignment copies lock value to cp: github.com/seaweedfs/seaweedfs/weed/pb/master_pb.LockRingUpdate contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "credential/credential_manager.go:177:17: assignment copies lock value to configCopy: github.com/seaweedfs/seaweedfs/weed/pb/iam_pb.S3ApiConfiguration contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "mount/peer_registrar_test.go:27:44: call of append copies lock value: github.com/seaweedfs/seaweedfs/weed/pb/filer_pb.MountRegisterRequest contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "mount/peer_registrar_test.go:34:10: assignment copies lock value to resp: github.com/seaweedfs/seaweedfs/weed/pb/filer_pb.MountListResponse contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "plugin/worker/worker.go:654:13: assignment copies lock value to cloned: github.com/seaweedfs/seaweedfs/weed/pb/plugin_pb.RunningWork contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "replication/sink/filersink/fetch_write.go:216:13: assignment copies lock value to copied: github.com/seaweedfs/seaweedfs/weed/pb/filer_pb.FileChunk contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "s3api/auth_jwt_streaming_unsigned_test.go:59:17: call of runWithRequest copies lock value: github.com/seaweedfs/seaweedfs/weed/s3api.IdentityAccessManagement contains sync.RWMutex",
  "s3api/chunked_reader_v4_test.go:105:17: call of runWithRequest copies lock value: github.com/seaweedfs/seaweedfs/weed/s3api.IdentityAccessManagement contains sync.RWMutex",
  "s3api/chunked_reader_v4_test.go:111:17: call of runWithRequest copies lock value: github.com/seaweedfs/seaweedfs/weed/s3api.IdentityAccessManagement contains sync.RWMutex",
  "s3api/chunked_reader_v4_test.go:114:25: runWithRequest passes lock by value: github.com/seaweedfs/seaweedfs/weed/s3api.IdentityAccessManagement contains sync.RWMutex",
  "s3api/chunked_reader_v4_test.go:159:9: return copies lock value: github.com/seaweedfs/seaweedfs/weed/s3api.IdentityAccessManagement contains sync.RWMutex",
  "shell/command_volume_delete_empty_test.go:36:9: assignment copies lock value to v: github.com/seaweedfs/seaweedfs/weed/pb/master_pb.VolumeInformationMessage contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "stats/disk.go:500:21: assignment copies lock value to s.lastGoodStatus: github.com/seaweedfs/seaweedfs/weed/pb/volume_server_pb.DiskStatus contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex",
  "stats/disk.go:511:10: assignment copies lock value to *disk: github.com/seaweedfs/seaweedfs/weed/pb/volume_server_pb.DiskStatus contains google.golang.org/protobuf/runtime/protoimpl.MessageState contains sync.Mutex"
]);
const expected = new Set(BASELINE_COPYLOCKS);
const packages = new Set(BASELINE_COPYLOCKS.map((line) => {
  const file = line.split(":", 1)[0];
  return `github.com/seaweedfs/seaweedfs/weed/${file.slice(0, file.lastIndexOf("/"))}`;
}));
const headers = new Set([...packages].flatMap((name) => [`# ${name}`, `# [${name}]`]));

export function requireBaselineCopylocks(bytes, execution, pristineSum) {
  if (execution?.status !== 1 || execution.error != null || execution.monitorReason != null || execution.groupAbsent !== true ||
      !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 64 * 1024) throw new Error("seaweed_baseline_vet_invalid");
  if (!Buffer.isBuffer(pristineSum) || pristineSum.length !== 289547 ||
      createHash("sha256").update(pristineSum).digest("hex") !== "d0da511e41d4013cbcc31d959d7533edb8312cfefa8722919085d5cbc6eb8fe2") {
    throw new Error("seaweed_baseline_vet_sum_invalid");
  }
  const zipModules = new Set(pristineSum.toString("utf8").split("\n").flatMap((line) => {
    const match = /^(\S+) (\S+) h1:[A-Za-z0-9+/]{43}=$/u.exec(line);
    return match && !match[2].endsWith("/go.mod") ? [`${match[1]} ${match[2]}`] : [];
  }));
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("seaweed_baseline_vet_invalid"); }
  if (!text.endsWith("\n") || text.includes("\r")) throw new Error("seaweed_baseline_vet_invalid");
  const seen = new Set(); const seenHeaders = new Set(); const downloads = new Set();
  for (const line of text.slice(0, -1).split("\n")) {
    if (headers.has(line) && !seenHeaders.has(line)) { seenHeaders.add(line); continue; }
    const download = /^go: downloading (\S+ \S+)$/u.exec(line);
    if (download && zipModules.has(download[1]) && !downloads.has(download[1])) { downloads.add(download[1]); continue; }
    // Empty lines, unbound progress, arbitrary errors and duplicates all fail.
    if (!expected.has(line) || seen.has(line)) throw new Error("seaweed_baseline_vet_invalid");
    seen.add(line);
  }
  if (seen.size !== expected.size) throw new Error("seaweed_baseline_vet_invalid");
  return { result: "EXPECTED_FAILURE", exitStatus: 1, groupAbsent: true,
    log: { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length },
    diagnostics: [...seen].sort(), downloads: [...downloads].sort() };
}

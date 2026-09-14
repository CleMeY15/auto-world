# SeaweedFS original source bytes

These seven public files come from Git blobs in SeaweedFS commit `c5073360007d28385a33426a42ac3e4ec504c5a3`, tree `bce9e3f66721208f35888124183f80bd76d64f90`. They are unmodified LF bytes, captured with binary `spawnSync("git", ["show", "<commit>:<path>"], { encoding: null }).stdout` and written directly as buffers. Git attributes disable checkout conversion for the `upstream` directory. The upstream root and glog licenses are included.

The source diagnostic validates these files before applying its separately locked module patch. The regression test checks every original identity, rejects CRLF conversions, applies the unchanged patch to the original module files, and checks the resulting identities. It does not download or execute SeaweedFS, the copied upstream workflows or their dependencies. The full native source diagnostic remains a separate requirement.

FROM postgres@sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3

COPY --chown=0:0 APKINDEX.tar.gz gosu-1.19-r5.apk /tmp/auto-world-apk/

RUN set -eu; \
    test "$(cat /sys/fs/cgroup/memory.max)" = 1073741824; \
    test "$(cat /sys/fs/cgroup/memory.swap.max)" = 0; \
    test "$(cat /sys/fs/cgroup/cpu.max)" = '100000 100000'; \
    printf '%s\n' 'auto-world-build-resources:verified'; \
    test -x /usr/local/bin/gosu; \
    test "$(wc -c < /etc/apk/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub)" = 800; \
    test "$(sha256sum /etc/apk/keys/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub | cut -d ' ' -f 1)" = 207e4696d3c05f7cb05966aee557307151f1f00217af4143c1bcaf33b8df733f; \
    apk --no-network --keys-dir /etc/apk/keys verify /tmp/auto-world-apk/APKINDEX.tar.gz; \
    printf '%s\n' 'auto-world-apk-verify:index:passed'; \
    apk --no-network --keys-dir /etc/apk/keys verify /tmp/auto-world-apk/gosu-1.19-r5.apk; \
    printf '%s\n' 'auto-world-apk-verify:package:passed'; \
    printf '%s\n' 'ndx /tmp/auto-world-apk/APKINDEX.tar.gz' > /tmp/auto-world-repositories; \
    rm -f /usr/local/bin/gosu; \
    apk --no-logfile --no-cache --no-network --repositories-file /tmp/auto-world-repositories add 'gosu=1.19-r5'; \
    rm -rf /tmp/auto-world-apk /tmp/auto-world-repositories; \
    test ! -e /usr/local/bin/gosu; \
    test "$(command -v gosu)" = /usr/bin/gosu; \
    test -x /usr/bin/gosu; \
    test "$(stat -c '%a:%s' /usr/bin/gosu)" = 755:1977120; \
    test "$(sha256sum /usr/bin/gosu | cut -d ' ' -f 1)" = 6d3214ab9d2f1e9ffda75ea2f6bb1f454a13a78dd70318e09eee814ce32cce03; \
    test "$(gosu --version 2>&1)" = '1.19 (go1.26.8 on linux/amd64; gc)'

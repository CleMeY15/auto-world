# TASK-0005A — PostgreSQL package, source and notice coverage

Status: P1_CORE_EVIDENCE_ACCEPTED, 2026-10-01. This document is the coverage table for the consolidated [P1 source closure](TASK-0005A-POSTGRES-SOURCE-CLOSURE.md) and [admission exit plan](TASK-0005A-ADMISSION-EXIT-PLAN.md). It introduces no new admission gate or per-material milestone. The complete 323-material byte inventory, passive 12-layer inventory, 42-archive notice batch, 19 indicated non-recipes, 22 virtual dependencies and four old-gosu declarations are associated in [source-coverage.json](../../infra/postgres-image/source-coverage.json). Their 496-reference core retrieval passed and its independent native review returned APPROVE; final delivery checks remain pending.

The closed table is 437498 bytes/SHA256 `a6c5740d17ad12f492bed3a17a8c0778d578fd7c32d771eeb2b158e7c7f4e31b`, with recursive sorted-object/ordered-array canonical SHA256 `42d73c81a2b987a03aa19e0fb5f8edb51aff6e948b632737bcd97abf79325009`. Its seventeen provenance records include the exact layer and embedded-notice projections consumed by the table. The [loader](../../scripts/postgres-image/source-coverage-manifest.mjs) pins this reviewed canonical hash independently of caller data and returns bounded, detached, deeply frozen JSON records. Metadata, support dates and admission claims cannot be substituted. The twelve consistency groups and independent reference review passed without reopening source archives.

Subject: `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93`. Image/config SHA256 is `8453b2e3ea76734a5c5df6cd8bf17799880c4ed974e2e136dbf849254f96cdda`; Alpine 3.24.2, linux/amd64. Source/notice closure and binary reproduction remain NOT_ESTABLISHED; physical layer inventory is verified; legal compliance and currentness are NOT_EVALUATED; runtimePermission NOT_GRANTED, admission NOT_AUTHORIZED, authority NONE. Support start/end/archive dates remain null until reviewed activation under [ADR-0007](../decisions/ADR-0007-private-image-admission.md).

## Evidence and meaning of a row

The [accepted PR126 inventory](TASK-0005A-POSTGRES-DECLARED-SOURCE-INVENTORY.md) is 47,581 bytes/SHA256 `b59bc9b11247e420dbec46000e411ac033bd07d07cae36a6ae3bde01139bbdc1`. It binds the complete historical package report 103,337 bytes/SHA256 `9cb9a560ec4c86e00110ffb6a85849843f457f37f6e95c36f589158d20014cfd` and CycloneDX SBOM 76,609 bytes/SHA256 `ec611993dae03e0a3902f28a759ec0b209ad43ba952013b5c4ffd6575189a185`, audit run 36673766454/source 5186a241f9ab28add4098648aa4bc56d36b5e6dc. There are 50 library/package records: 46 APK (45 named packages from 35 origins plus one virtual record) and four Go records. PostgreSQL 17.11 is a separately recorded non-APK runtime; it is not an invented 51st scanner package.

For this table, the same pinned inventory was read as actual UID/GID 1000, through a readonly/O_NOFOLLOW/O_NONBLOCK descriptor, complete size/SHA256/EOF and stable before/after FD/path native9 checks; its descriptor was closed. Only package/type/name/version/origin/license/layer-reference metadata was reused. No archive, notice body, runtime, collector, historical currentness replay or new network acquisition ran.

The 34 prepared APKBUILD files were reread only as public text:171,827 bytes, each complete SHA256/size equal to its captured collection and compiled recipe expectation. Their raw license expressions, literal source declarations and explicit notice-copy references are facts about those texts. APKBUILD is never executed. The separate gosu recipe is the 825-byte retained material with SHA256 `e8ebdfafcedf25013b39055c83171936109c9ffb4c0262d8aef4139e0a481192`.

The [closed 323-material manifest](../../infra/postgres-image/source-closure-materials.json), loaded by [source-closure-manifest.mjs](../../scripts/postgres-image/source-closure-manifest.mjs), has canonical SHA256 `3ce9a629c3f9aa037a8ffa4d3ff60c7fe42272937b72cc82e59e04f7ba2358f3`. It contains 34 recipes, 35 source archives, 147 patches, 84 auxiliaries, 20 install hooks, 2 triggers and one older-Go archive. Aports paths/commits, recipe SHA256/size, all 266 declared source SHA512s and 22 hook blob identities remain separate provenance edges. Whole-file retention does not prove that an archive is source-equivalent, a license covers every subpackage, a declared commit is an authenticated Git object, or a binary was reproduced from it.

The first native batch is preserved as INCOMPLETE: 316/323 verified materials, seven transport/header failures, 478,987,428 verified bytes. Its receipt 253,809 bytes/SHA256 `3343930db2fc7a2ddbd040847c91700ee08da2f3b99962e7d083f10be9651423` and ACK 947 bytes/SHA256 `5dd2292fea730f2b890273ee5f1f8d10f9d12c50174175f7f98431405d1e0f59` are diagnostic observations, not complete independent 323-object acceptance. Exact recovery and final independent byte/inventory acceptance belong to the source-closure document. This table does not infer per-object completion from an aggregate count.

The independently verified recovery on recipe `6719d06682f72c18d4c66093e2636e4923b07192` establishes all 323 complete materials, 496,389,328 bytes. Its receipt is 214,971 bytes/SHA256 `8e65857b87885999e32cf699b9cd44be9e8776c8526cb7aa3c7b29a58b72dbc4`; paired ACK 987 bytes/SHA256 `55130dfcd2f19d27619a49a593fdd6b5622ec78e45da176fc42f3a37e1bc49cc`. Existing objects were rehashed and preserved. BYTES_VERIFIED_UNADMITTED authenticates declared whole bytes, without notice attribution, legal compliance or admission.

## All 50 current report records

License cells preserve the historical JSON array exactly; a list is not interpreted here as an AND/OR expression or a legal conclusion. NO_DECLARATION is an observation of missing report text, not evidence that no notice applies. J0/J4/J11 are zero-based **scanner report annotations** into the 12 ordered DiffIDs below; they are not independently observed physical origin, final survival, or lower-layer coverage.

| Package/component | Version | Report type | APK origin | Raw report license values | Report annotation |
| --- | --- | --- | --- | --- | --- |
| `.postgresql-rundeps` | `20260917.213131` | APK | SYNTHETIC_NO_ORIGIN | NO_DECLARATION | J4 |
| `alpine-baselayout` | `3.7.2-r1` | APK | `alpine-baselayout` | `["GPL-2.0-only"]` | J0 |
| `alpine-baselayout-data` | `3.7.2-r1` | APK | `alpine-baselayout` | `["GPL-2.0-only"]` | J0 |
| `alpine-keys` | `2.6-r0` | APK | `alpine-keys` | `["MIT"]` | J0 |
| `alpine-release` | `3.24.2-r0` | APK | `alpine-base` | `["MIT"]` | J0 |
| `apk-tools` | `3.0.8-r0` | APK | `apk-tools` | `["GPL-2.0-only"]` | J0 |
| `bash` | `5.3.9-r1` | APK | `bash` | `["GPL-3.0-or-later"]` | J4 |
| `busybox` | `1.37.0-r31` | APK | `busybox` | `["GPL-2.0-only"]` | J0 |
| `busybox-binsh` | `1.37.0-r31` | APK | `busybox` | `["GPL-2.0-only"]` | J0 |
| `ca-certificates-bundle` | `20260909-r0` | APK | `ca-certificates` | `["MPL-2.0","MIT"]` | J0 |
| `gdbm` | `1.26-r0` | APK | `gdbm` | `["GPL-3.0-or-later"]` | J4 |
| `gosu` | `1.19-r5` | APK | `gosu` | `["Apache-2.0"]` | J11 |
| `icu-data-full` | `78.1-r0` | APK | `icu` | `["ICU"]` | J4 |
| `icu-libs` | `78.1-r0` | APK | `icu` | `["ICU"]` | J4 |
| `keyutils-libs` | `1.6.3-r4` | APK | `keyutils` | `["GPL-2.0-or-later","LGPL-2.0-or-later"]` | J4 |
| `krb5-conf` | `1.0-r2` | APK | `krb5-conf` | `["MIT"]` | J4 |
| `krb5-libs` | `1.22.2-r1` | APK | `krb5` | `["MIT"]` | J4 |
| `libapk` | `3.0.8-r0` | APK | `apk-tools` | `["GPL-2.0-only"]` | J0 |
| `libcom_err` | `1.47.4-r0` | APK | `e2fsprogs` | `["GPL-2.0-or-later","LGPL-2.0-or-later","BSD-3-Clause","MIT"]` | J4 |
| `libcrypto3` | `3.5.8-r0` | APK | `openssl` | `["Apache-2.0"]` | J0 |
| `libedit` | `20260508.3.1-r1` | APK | `libedit` | `["BSD-3-Clause"]` | J4 |
| `libffi` | `3.5.2-r1` | APK | `libffi` | `["MIT"]` | J4 |
| `libgcc` | `15.2.0-r5` | APK | `gcc` | `["GPL-2.0-or-later","LGPL-2.1-or-later"]` | J4 |
| `libldap` | `2.6.14-r0` | APK | `openldap` | `["OLDAP-2.8"]` | J4 |
| `libncursesw` | `6.6_p20260516-r0` | APK | `ncurses` | `["X-11"]` | J4 |
| `libsasl` | `2.1.28-r9` | APK | `cyrus-sasl` | `["BSD-3-Clause-Attribution","BSD-4-Clause"]` | J4 |
| `libssl3` | `3.5.8-r0` | APK | `openssl` | `["Apache-2.0"]` | J0 |
| `libstdc++` | `15.2.0-r5` | APK | `gcc` | `["GPL-2.0-or-later","LGPL-2.1-or-later"]` | J4 |
| `libuuid` | `2.42.3-r1` | APK | `util-linux` | `["BSD-3-Clause"]` | J4 |
| `libverto` | `0.3.2-r2` | APK | `libverto` | `["MIT"]` | J4 |
| `libxml2` | `2.13.9-r2` | APK | `libxml2` | `["MIT"]` | J4 |
| `libxslt` | `1.1.43-r3` | APK | `libxslt` | `["X-11"]` | J4 |
| `llvm21-libs` | `21.1.8-r1` | APK | `llvm21` | `["Apache-2.0"]` | J4 |
| `lz4-libs` | `1.10.0-r1` | APK | `lz4` | `["BSD-2-Clause","GPL-2.0-or-later"]` | J4 |
| `musl` | `1.2.6-r2` | APK | `musl` | `["MIT"]` | J0 |
| `musl-utils` | `1.2.6-r2` | APK | `musl` | `["MIT","BSD-2-Clause","GPL-2.0-or-later"]` | J0 |
| `ncurses-terminfo-base` | `6.6_p20260516-r0` | APK | `ncurses` | `["X-11"]` | J4 |
| `nss_wrapper` | `1.1.12-r1` | APK | `nss_wrapper` | `["BSD-3-Clause"]` | J4 |
| `readline` | `8.3.3-r1` | APK | `readline` | `["GPL-3.0-or-later"]` | J4 |
| `scanelf` | `1.3.9-r1` | APK | `pax-utils` | `["GPL-2.0-only"]` | J0 |
| `ssl_client` | `1.37.0-r31` | APK | `busybox` | `["GPL-2.0-only"]` | J0 |
| `tzdata` | `2026d-r0` | APK | `tzdata` | `["Public-Domain"]` | J4 |
| `xz-libs` | `5.8.4-r0` | APK | `xz` | `["GPL-2.0-or-later","0BSD","Public-Domain","LGPL-2.1-or-later"]` | J4 |
| `zlib` | `1.3.2-r0` | APK | `zlib` | `["Zlib"]` | J0 |
| `zstd` | `1.5.7-r2` | APK | `zstd` | `["BSD-3-Clause","GPL-2.0-or-later"]` | J4 |
| `zstd-libs` | `1.5.7-r2` | APK | `zstd` | `["BSD-3-Clause","GPL-2.0-or-later"]` | J4 |
| `github.com/moby/sys/user` | `v0.1.0` | Go binary | NO_APK_ORIGIN | NO_DECLARATION | J11 |
| `github.com/tianon/gosu` | NOT_DECLARED | Go binary | NO_APK_ORIGIN | NO_DECLARATION | J11 |
| `golang.org/x/sys` | `v0.1.0` | Go binary | NO_APK_ORIGIN | NO_DECLARATION | J11 |
| `stdlib` | `v1.26.8` | Go binary | NO_APK_ORIGIN | NO_DECLARATION | J11 |

## All 35 named APK origins and declared material associations

Each installed name above joins by exact APK origin to this table. Recipe links retain the complete declared aports commit and category/path. The compiled manifest owns exact recipe SHA256/size and source/hook expectations; a GitHub URL or commit label alone is not authentication. The license column shows the top-level expression from the pinned text; whitespace is collapsed only for display. Function-specific declarations relevant to installed subpackages are preserved separately below.

A/P/X/H means compiled counts of source archives / functional patches / auxiliary files / install hooks and triggers. The independently authenticated byte, notice-reference and historical-layer associations for these rows are recorded below. The gosu row reuses accepted PR127 rather than adding duplicate materials to 323.

| Origin | Installed subpackages in the report | Exact declared recipe commit | Top-level recipe license and line | Declared whole-archive inputs / generator scope | A/P/X/H |
| --- | --- | --- | --- | --- | --- |
| `alpine-base` | `alpine-release` | [`d9d560d5de74ff9a7a73f3c903d6f126a0bf3142`](https://github.com/alpinelinux/aports/blob/d9d560d5de74ff9a7a73f3c903d6f126a0bf3142/main/alpine-base/APKBUILD#L8) | `MIT` L8 | INLINE_GENERATOR_NO_SOURCE_LIST | 0/0/0/0 |
| `alpine-baselayout` | `alpine-baselayout`, `alpine-baselayout-data` | [`60a7585bbab2fa0f762504eb617dbca90216e31f`](https://github.com/alpinelinux/aports/blob/60a7585bbab2fa0f762504eb617dbca90216e31f/main/alpine-baselayout/APKBUILD#L9) | `GPL-2.0-only` L9 | APORTS_LOCAL_FILES_ONLY | 0/0/14/4 |
| `alpine-keys` | `alpine-keys` | [`b9f23becced4d7b3ccc0fa0f28530243ccd314a0`](https://github.com/alpinelinux/aports/blob/b9f23becced4d7b3ccc0fa0f28530243ccd314a0/main/alpine-keys/APKBUILD#L9) | `MIT` L9 | APORTS_LOCAL_FILES_ONLY | 0/0/18/0 |
| `apk-tools` | `apk-tools`, `libapk` | [`4588b452722bd4800efdc6cce4f6e980e02a997f`](https://github.com/alpinelinux/aports/blob/4588b452722bd4800efdc6cce4f6e980e02a997f/main/apk-tools/APKBUILD#L8) | `GPL-2.0-only` L8 | `apk-tools-v3.0.8.tar.gz` | 1/1/0/0 |
| `bash` | `bash` | [`1522c3193610902d8493f9790a2755c11f21f26d`](https://github.com/alpinelinux/aports/blob/1522c3193610902d8493f9790a2755c11f21f26d/main/bash/APKBUILD#L13) | `GPL-3.0-or-later` L13 | `bash-5.3-1.tar.gz` | 1/10/2/3 |
| `busybox` | `busybox`, `busybox-binsh`, `ssl_client` | [`c3ef5d10e6ef6528852c51f0564963e2f8c1be19`](https://github.com/alpinelinux/aports/blob/c3ef5d10e6ef6528852c51f0564963e2f8c1be19/main/busybox/APKBUILD#L11) | `GPL-2.0-only` L11 | `busybox-1.37.0.tar.bz2` | 1/44/30/5 |
| `ca-certificates` | `ca-certificates-bundle` | [`eb7078df3a16d666e8f7723f94bb92e00d4b9236`](https://github.com/alpinelinux/aports/blob/eb7078df3a16d666e8f7723f94bb92e00d4b9236/main/ca-certificates/APKBUILD#L10) | `MPL-2.0 AND MIT` L10 | `ca-certificates-20260909.tar.bz2` | 1/0/0/2 |
| `cyrus-sasl` | `libsasl` | [`fac808c0fddf93e8980ec1f55972e6f69b78ba6f`](https://github.com/alpinelinux/aports/blob/fac808c0fddf93e8980ec1f55972e6f69b78ba6f/main/cyrus-sasl/APKBUILD#L9) | `BSD-3-Clause-Attribution AND BSD-4-Clause` L9 | `cyrus-sasl-2.1.28.tar.gz` | 1/3/1/0 |
| `e2fsprogs` | `libcom_err` | [`8683a6972cb245fbbdb535dad6435a9930bb9374`](https://github.com/alpinelinux/aports/blob/8683a6972cb245fbbdb535dad6435a9930bb9374/main/e2fsprogs/APKBUILD#L9) | `GPL-2.0-or-later AND LGPL-2.0-or-later AND BSD-3-Clause AND MIT` L9 | `e2fsprogs-1.47.4.tar.gz` | 1/0/0/0 |
| `gcc` | `libgcc`, `libstdc++` | [`423a8ad043d07f2c7546c8ec3e2b0384cda360ae`](https://github.com/alpinelinux/aports/blob/423a8ad043d07f2c7546c8ec3e2b0384cda360ae/main/gcc/APKBUILD#L18) | `GPL-2.0-or-later AND LGPL-2.1-or-later` L18 | `gcc-15.2.0.tar.xz` | 1/44/0/0 |
| `gdbm` | `gdbm` | [`1ea03990396db618edfcc8a9a0bc6b72662bac8f`](https://github.com/alpinelinux/aports/blob/1ea03990396db618edfcc8a9a0bc6b72662bac8f/main/gdbm/APKBUILD#L9) | `GPL-3.0-or-later` L9 | `gdbm-1.26.tar.gz` | 1/0/0/0 |
| `gosu` | `gosu` | [`1e1aed58b7720fcb6b1859043d543b33019d8c4f`](https://github.com/alpinelinux/aports/blob/1e1aed58b7720fcb6b1859043d543b33019d8c4f/community/gosu/APKBUILD#L9) | `Apache-2.0` L9 | PR127: gosu plus two modules and Go 1.26.8 | Accepted PR127; outside the 323 batch |
| `icu` | `icu-data-full`, `icu-libs` | [`6755fdb21483ba250d374c3244f0f48bc63447e2`](https://github.com/alpinelinux/aports/blob/6755fdb21483ba250d374c3244f0f48bc63447e2/main/icu/APKBUILD#L10) | `ICU` L10 | `icu4c-78.1-data-bin-b.zip`, `icu4c-78.1-data-bin-l.zip`, `icu4c-78.1-data.zip`, `icu4c-78.1-sources.tgz` | 4/3/1/1 |
| `keyutils` | `keyutils-libs` | [`8bac74716d06c84627ab02d101fd9d2bafd0a34c`](https://github.com/alpinelinux/aports/blob/8bac74716d06c84627ab02d101fd9d2bafd0a34c/main/keyutils/APKBUILD#L9) | `GPL-2.0-or-later AND LGPL-2.0-or-later` L9 | `keyutils-1.6.3.tar.gz` | 1/1/0/0 |
| `krb5` | `krb5-libs` | [`92bc4f0d36aa5307e819fb57167fc19952cf515f`](https://github.com/alpinelinux/aports/blob/92bc4f0d36aa5307e819fb57167fc19952cf515f/main/krb5/APKBUILD#L8) | `MIT` L8 | `krb5-1.22.2.tar.gz` | 1/1/3/0 |
| `krb5-conf` | `krb5-conf` | [`4a46b2cb955e25fd6d6f913794d35bc6d876aea9`](https://github.com/alpinelinux/aports/blob/4a46b2cb955e25fd6d6f913794d35bc6d876aea9/main/krb5-conf/APKBUILD#L14) | `MIT` L14 | INLINE_GENERATOR_NO_SOURCE_LIST | 0/0/0/0 |
| `libedit` | `libedit` | [`7c805161e588c028cdee3f19f500849fb2c75d42`](https://github.com/alpinelinux/aports/blob/7c805161e588c028cdee3f19f500849fb2c75d42/main/libedit/APKBUILD#L10) | `BSD-3-Clause` L10 | `libedit-20260508-3.1.tar.gz` | 1/0/0/0 |
| `libffi` | `libffi` | [`2c2a7bb4a8b16066834e90402567b2c19403a790`](https://github.com/alpinelinux/aports/blob/2c2a7bb4a8b16066834e90402567b2c19403a790/main/libffi/APKBUILD#L8) | `MIT` L8 | `libffi-3.5.2.tar.gz` | 1/1/0/0 |
| `libverto` | `libverto` | [`84a227baf001b6e0208e3352b294e4d7a40e93de`](https://github.com/alpinelinux/aports/blob/84a227baf001b6e0208e3352b294e4d7a40e93de/main/libverto/APKBUILD#L9) | `MIT` L9 | `libverto-0.3.2.tar.gz` | 1/0/0/0 |
| `libxml2` | `libxml2` | [`f1bd5b6767a0e7fdda380c95138a1c938eb6e102`](https://github.com/alpinelinux/aports/blob/f1bd5b6767a0e7fdda380c95138a1c938eb6e102/main/libxml2/APKBUILD#L9) | `MIT` L9 | `libxml2-2.13.9.tar.xz` | 1/2/0/0 |
| `libxslt` | `libxslt` | [`730f2f5bdc97be98b2beee33f55134c622e6189c`](https://github.com/alpinelinux/aports/blob/730f2f5bdc97be98b2beee33f55134c622e6189c/main/libxslt/APKBUILD#L9) | `X11` L9 | `libxslt-1.1.43.tar.xz` | 1/0/0/0 |
| `llvm21` | `llvm21-libs` | [`4b9b094db09064adf09759b02ce63d23ab3d8cbb`](https://github.com/alpinelinux/aports/blob/4b9b094db09064adf09759b02ce63d23ab3d8cbb/main/llvm21/APKBUILD#L20) | `Apache-2.0` L20 | `llvm-project-21.1.8.src.tar.xz` | 1/5/0/0 |
| `lz4` | `lz4-libs` | [`1f16962f34234a77fab0f4651459c4381b4a0cd6`](https://github.com/alpinelinux/aports/blob/1f16962f34234a77fab0f4651459c4381b4a0cd6/main/lz4/APKBUILD#L9) | `BSD-2-Clause AND GPL-2.0-or-later` L9 | `lz4-1.10.0.tar.gz` | 1/0/0/0 |
| `musl` | `musl`, `musl-utils` | [`f5640d3a10f664c9119720c60515265d3d6f6d01`](https://github.com/alpinelinux/aports/blob/f5640d3a10f664c9119720c60515265d3d6f6d01/main/musl/APKBUILD#L10) | `MIT` L10 | `musl-1.2.6.tar.gz` | 1/5/5/0 |
| `ncurses` | `libncursesw`, `ncurses-terminfo-base` | [`2cee8a7328d061418336ad327b512d96bcd7bc5e`](https://github.com/alpinelinux/aports/blob/2cee8a7328d061418336ad327b512d96bcd7bc5e/main/ncurses/APKBUILD#L11) | `X11` L11 | `ncurses-6.6-20260516.tgz` | 1/1/0/0 |
| `nss_wrapper` | `nss_wrapper` | [`44ce39a091100c59a3bd90df6c0312d302be3171`](https://github.com/alpinelinux/aports/blob/44ce39a091100c59a3bd90df6c0312d302be3171/community/nss_wrapper/APKBUILD#L9) | `BSD-3-Clause` L9 | `nss_wrapper-1.1.12.tar.gz` | 1/1/0/0 |
| `openldap` | `libldap` | [`1f9cbd23a8be05afabdd96072263ba025e097c8f`](https://github.com/alpinelinux/aports/blob/1f9cbd23a8be05afabdd96072263ba025e097c8f/main/openldap/APKBUILD#L40) | `OLDAP-2.8` L40 | `openldap-2.6.14.tgz` | 1/11/5/5 |
| `openssl` | `libcrypto3`, `libssl3` | [`013edf8b29199933e8ea34dde460b5584b979042`](https://github.com/alpinelinux/aports/blob/013edf8b29199933e8ea34dde460b5584b979042/main/openssl/APKBUILD#L11) | `Apache-2.0` L11 | `openssl-3.5.8.tar.gz` | 1/1/0/1 |
| `pax-utils` | `scanelf` | [`c61801eeacb3ffcd9c2025b09e402153bb93fb39`](https://github.com/alpinelinux/aports/blob/c61801eeacb3ffcd9c2025b09e402153bb93fb39/main/pax-utils/APKBUILD#L10) | `GPL-2.0-only` L10 | `pax-utils-1.3.9.tar.xz` | 1/0/0/0 |
| `readline` | `readline` | [`a854c03acdac188901fb012f7acbee70a36e8041`](https://github.com/alpinelinux/aports/blob/a854c03acdac188901fb012f7acbee70a36e8041/main/readline/APKBUILD#L11) | `GPL-3.0-or-later` L11 | `readline-8.3.tar.gz` | 1/4/1/0 |
| `tzdata` | `tzdata` | [`a19caf9fe771707618d4d9e4fa2dd9db8155b461`](https://github.com/alpinelinux/aports/blob/a19caf9fe771707618d4d9e4fa2dd9db8155b461/main/tzdata/APKBUILD#L11) | `Public-Domain` L11 | `posixtz-0.5.tar.xz`, `tzcode2026d.tar.gz`, `tzdata2026d.tar.gz` | 3/2/0/0 |
| `util-linux` | `libuuid` | [`d98c55af59055e6ca60fbe36e171546918709965`](https://github.com/alpinelinux/aports/blob/d98c55af59055e6ca60fbe36e171546918709965/main/util-linux/APKBUILD#L10) | `GPL-3.0-or-later AND GPL-2.0-or-later AND GPL-2.0-only AND GPL-1.0-only AND LGPL-2.1-or-later AND BSD-1-Clause AND BSD-3-Clause AND BSD-4-Clause-UC AND MIT AND Public-Domain` L10 | `util-linux-2.42.3.tar.xz` | 1/7/4/1 |
| `xz` | `xz-libs` | [`0c088d609f9fe69eedd6b4c7f4b99cdad847c20a`](https://github.com/alpinelinux/aports/blob/0c088d609f9fe69eedd6b4c7f4b99cdad847c20a/main/xz/APKBUILD#L9) | `GPL-2.0-or-later AND 0BSD AND Public-Domain AND LGPL-2.1-or-later` L9 | `xz-5.8.4.tar.gz` | 1/0/0/0 |
| `zlib` | `zlib` | [`f248b33b5943c7dc69bf691031d7612ab2e8ed93`](https://github.com/alpinelinux/aports/blob/f248b33b5943c7dc69bf691031d7612ab2e8ed93/main/zlib/APKBUILD#L7) | `Zlib` L7 | `zlib-1.3.2.tar.gz` | 1/0/0/0 |
| `zstd` | `zstd`, `zstd-libs` | [`3c6e2ee2b16f403d53eab39c4426eb61f003c322`](https://github.com/alpinelinux/aports/blob/3c6e2ee2b16f403d53eab39c4426eb61f003c322/main/zstd/APKBUILD#L11) | `BSD-3-Clause OR GPL-2.0-or-later` L11 | `zstd-1.5.7.tar.gz` | 1/0/0/0 |

### Subpackage declarations and special source shapes

- `musl` declares MIT at L10; `utils()` changes the license to `MIT AND BSD-2-Clause AND GPL-2.0-or-later` at [L138–142](https://github.com/alpinelinux/aports/blob/f5640d3a10f664c9119720c60515265d3d6f6d01/main/musl/APKBUILD#L138). The observed `musl-utils` report keeps those three raw values. Do not apply the main-library MIT declaration to this subpackage by inference.
- `util-linux` has a broad top-level expression at L10; its `libuuid` case declares BSD-3-Clause at [L333–334](https://github.com/alpinelinux/aports/blob/d98c55af59055e6ca60fbe36e171546918709965/main/util-linux/APKBUILD#L333). The installed `libuuid` record is distinct from uninstalled util-linux subpackages and their other case declarations.
- `zstd` recipe L11 says `BSD-3-Clause OR GPL-2.0-or-later`; the report presents two separate values for both `zstd` and `zstd-libs`. Preserve both representations without converting the array to a chosen license. Likewise recipes use `X11` while the ncurses/libxslt reports use the raw name `X-11`.
- The ICU recipe declares four archives: sources.tgz, data.zip and the two data-bin ZIPs. SOURCE_ARCHIVE is a byte-retention role; it does not assert that the prebuilt data ZIPs are a substitute for source, or that every ICU subpackage has identical notices.
- `alpine-base` is a recipe generator with no source list: [L33–66](https://github.com/alpinelinux/aports/blob/d9d560d5de74ff9a7a73f3c903d6f126a0bf3142/main/alpine-base/APKBUILD#L33) write Alpine release/issue/os-release and related generated metadata. Preserve recipe bytes and relevant aports notices; do not invent an upstream tarball. `krb5-conf` similarly writes `/etc/krb5.conf` from a recipe heredoc at [L19](https://github.com/alpinelinux/aports/blob/4a46b2cb955e25fd6d6f913794d35bc6d876aea9/main/krb5-conf/APKBUILD#L19).
- `alpine-baselayout` and `alpine-keys` declare only local aports files (14 and 18 checksum-bound auxiliaries respectively), not an upstream archive. Their exact recipe/local-file/hook paths plus applicable repository notices form the source evidence to assess.
- `.postgresql-rundeps` is the synthetic dependency record `20260917.213131`. The report has no APK origin or license declaration; the actual APK record has absent origin and an empty license field, with 22 declared dependencies and SYNTHETIC_VIRTUAL_DEPENDENCIES_ONLY assessment. It occurs in layers 4 and 11. Map the dependencies below without creating a fictitious upstream source or license exemption.

## Existing accepted non-APK source corpora and older Go

[PR127](TASK-0005A-POSTGRES-GOSU-SOURCE-RETENTION.md) accepts four complete archives plus their selected references, genuine module/go.mod h1 bindings and paired receipt/ACK. Its receipt is 9,040 bytes/SHA256 `5c6634d3d680ad2920155c82fd76cf1d983711b652e21fcf2dba3241481d0d2a`; source recipe 8a062cdbc8c39089e20d4dfcde74fd56ff9931b8. [PR128](TASK-0005A-POSTGRES-UPSTREAM-SOURCE-RETENTION.md) accepts PostgreSQL and docker-library/postgres archives plus five selected references; receipt 7,392 bytes/SHA256 `c3ce0995cfc9a57fee17bc56a8292c2025a5d19e1a54a4382b31b9ee77347862`, source recipe b80e18b8ca53b6a9474d67d4ccdebcb2cc366263. Both are delivered historical evidence, with their original descriptors, privacy reviews and missing-selected-file observations retained. They are reused without collector, old bundle or archive replays.

| Association | Complete archive identity | Selected notice/binding references already accepted | Preserved association and interpretation scope |
| --- | --- | --- | --- |
| APK gosu 1.19-r5 and Go main `github.com/tianon/gosu` whose version is absent from the report | `gosu-1.19.tar.gz`,17,622B/SHA256 `cd9719b775dbfedae53923c9b0dc792b66d42c51e0b36652ed6f747fbadc0164`; full SHA512 from retained APKBUILD | `LICENSE`11,358B, `go.mod`110B, `go.sum`318B; top-level NOTICE absent from the fixed selected profile | The cumulative notice map below preserves observed nested references; actual binary/source reproduction is not inferred. PAX comment 6456aaa0f3c854d199d0f037f068eb97515b7513 is an authenticated archive declaration, not Git-object authentication. |
| Go `github.com/moby/sys/user@v0.1.0` | `moby-sys-user-v0.1.0.zip`,13,793B/SHA256 `85178932dc13b1c404c32e1b9f68fe88bf0b43e57dda39f24c45113e0bcf00ee` | `LICENSE`11,358B and `go.mod`74B; full module h1 and go.mod h1 match gosu go.sum; top-level NOTICE/PATENTS absent | The cumulative notice map below preserves observed references; absent report license text stays NO_DECLARATION. |
| Go `golang.org/x/sys@v0.1.0` | `golang-x-sys-v0.1.0.zip`,1,861,264B/SHA256 `e7cbe58ed3745ba63d482fe82603119bd635f9a5dd914ed95a4c1826fdcf54a7` | `LICENSE`1,479B, `PATENTS`1,303B and `go.mod`33B; module/go.mod h1 match; top-level NOTICE absent | Nested notice candidates are preserved below; no inferred SPDX expression or legal applicability is assigned to the report. |
| Current Go `stdlib@v1.26.8` in gosu | `go1.26.8.src.tar.gz`,34,150,120B/SHA256 `4e39b98e42f946fa05ac8bc5b71877df97dbdb7cbb1a777b541667ad7117fd2e` | `LICENSE`1,453B, `PATENTS`1,303B and `VERSION`35B; bound first-line `go1.26.8`; top-level NOTICE absent | Observed nested notices and historical-layer associations are preserved below, without blanket applicability claims. |
| Non-APK PostgreSQL 17.11 | `postgresql-17.11.tar.bz2`,21,787,224B/SHA256 `dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979` | `COPYRIGHT`1,198B/SHA256 `3d6af92ff8a4c2cdf69afb1cf44edea727922f5cd0cf8b5f72b11cdecac8fdfd`; top-level LICENSE/NOTICE absent | Observed nested/upstream notices and layer associations are preserved below. Archive declaration 083ac033419f690758508e08c1736089384bbee8 is not independent Git-object or binary reproduction proof. |
| PostgreSQL image recipe and entrypoint/initdb helpers | `docker-library-postgres-2603e26e245e558218728ee14e0a42dcb020dc7f.tar.gz`,56,252B/SHA256 `c452a880f58c62bc0738a266ff67e3c9656f33547da9d757563874daf5ab9200` | Root `LICENSE`1,084B; `17/alpine3.24/Dockerfile`, `docker-ensure-initdb.sh` and `docker-entrypoint.sh`, with exact PG_VERSION 17.11 and PG_SHA256 binding; top-level COPYRIGHT/NOTICE absent | Notice attribution to retained recipe/helpers and image layers; no generic replacement of upstream notices by this root LICENSE. |
| Older Go 1.24.6, historical source evidence outside the current 50 records | Manifest `go1.24.6.src.tar.gz`,30,794,139B/SHA256 `e1cb5582aab588668bc04c07de18688070f6b8c9b2aaf361f821e19bd47cfdbd` | Fixed prepared references: LICENSE 1,453B/SHA256 `911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad`; PATENTS 1,303B/SHA256 `96f408bfae65bf137fc2525d3ecb030271c50c1e90799f87abf8846d8dd505cc`; VERSION 35B/SHA256 `6d3d0e33f4e05bc6b53c46f0a719bee4e303c23bf54e9e2b7f673e6d2489dc08` | The consolidated batch's actual full-byte proof and passive notice results are recorded below. Prepared VERSION references are not a dedicated Go collector acceptance. Historical old-gosu/stdlib association is recorded below from the exact retained raw report; no dedicated Go collector or binary reproduction is inferred. |

The authoritative selected-member hashes, missing-selected arrays and module h1 values are in [gosu-source-policy.mjs](../../scripts/postgres-image/gosu-source-policy.mjs) and [postgres-upstream-source-policy.mjs](../../scripts/postgres-image/postgres-upstream-source-policy.mjs). A fixed selected-file absence is not a whole-tree absence proof. The 42-archive batch comprises 35 manifest source archives + one older-Go archive + four PR127 archives + two PR128 archives. Do not append an artificial archive for any source-less or virtual origin.

## Recipe-declared notices, hooks and aports provenance

These are literal paths referenced by recipes, not observations of retained notice bytes:

| Origin / exact recipe | Explicit reference | Declaration | Required mapping |
| --- | --- | --- | --- |
| cyrus-sasl / fac808c0fddf93e8980ec1f55972e6f69b78ba6f | `COPYING` | [APKBUILD L103](https://github.com/alpinelinux/aports/blob/fac808c0fddf93e8980ec1f55972e6f69b78ba6f/main/cyrus-sasl/APKBUILD#L103) copies to `usr/share/licenses/$pkgname/COPYING` | Authenticate source member bytes and map to installed libsasl and applicable historical subpackages/layers. |
| ICU / 6755fdb21483ba250d374c3244f0f48bc63447e2 | `$srcdir/icu/license.html` | [L96](https://github.com/alpinelinux/aports/blob/6755fdb21483ba250d374c3244f0f48bc63447e2/main/icu/APKBUILD#L96) copies under `usr/share/licenses/icu/` | Include this nonstandard HTML name, data archives and icu-data-full/icu-libs; determine path equivalence only from actual archive metadata. |
| libxslt / 730f2f5bdc97be98b2beee33f55134c622e6189c | `Copyright` | [L62](https://github.com/alpinelinux/aports/blob/730f2f5bdc97be98b2beee33f55134c622e6189c/main/libxslt/APKBUILD#L62) copies under `usr/share/licenses/$pkgname/` | Preserve exact case and relate source notice to libxslt. |
| lz4 / 1f16962f34234a77fab0f4651459c4381b4a0cd6 | `tests/COPYING` | [L35](https://github.com/alpinelinux/aports/blob/1f16962f34234a77fab0f4651459c4381b4a0cd6/main/lz4/APKBUILD#L35) removes this test file during packaging | Removal is not evidence that other source or installed notices are absent or inapplicable. |

Discovery must account for exact basename variants such as COPYRIGHT, Copyright, LICENSE, NOTICE, PATENTS, COPYING, COPYING2, COPYING3, COPYING3.LIB and ICU license.html, including nested locations. These are discovery requirements, not assertions that every archive contains each name. Unsupported formats, paths, links, enumeration limits or undiscovered applicable notices remain explicit failures/gaps.

The 22 install/trigger materials and all 147 patches/84 auxiliaries are attributed alongside the 34 recipes below. Their complete bytes are retained in the accepted opaque batch; the applicable notice assessment is not limited to the 42 whole archives. None of the 323 compiled material paths is a root LICENSE/NOTICE material. Applicable aports repository notice bytes are therefore not silently present in that manifest. The repository notice-name metadata at the 34 exact recipe commits above plus the separate gosu recipe commit `1e1aed58b7720fcb6b1859043d543b33019d8c4f` is recorded below without presuming a root LICENSE path. Preserve 35 provenance edges even if later authenticated bytes permit physical deduplication. A repository root license must not overwrite embedded upstream/patch/auxiliary notices or be assumed to relicense them.

Three hook Git blobs have mode 120000. Their regular private retained files contain pointer bytes only; no filesystem link is followed. Root's separate first-batch full-pointer read and SHA1/native checks, recorded in [source closure](TASK-0005A-POSTGRES-SOURCE-CLOSURE.md), establish these lexical same-commit associations; this table does not repeat those reads or promote them to complete-batch acceptance:

| Mode120000 declared hook | Expected pointer blob / size | Declared commit | Observed lexical target already in the 22-hook manifest |
| --- | --- | --- | --- |
| `main/alpine-baselayout/alpine-baselayout.post-upgrade` | `0e73fc07f3bfd966d5ed2e4be2a4838422dab0ed` / 30B | `60a7585bbab2fa0f762504eb617dbca90216e31f` | `main/alpine-baselayout/alpine-baselayout.post-install` |
| `main/bash/bash.post-upgrade` | `85d6a8aac6bcf550f4e66ae65dc9884588d05e24` / 17B | `1522c3193610902d8493f9790a2755c11f21f26d` | `main/bash/bash.post-install` |
| `main/openldap/openldap-lloadd.pre-install` | `d4fb5656dd90c476239c2b9c6fde1a0c85b544ab` / 20B | `1f9cbd23a8be05afabdd96072263ba025e097c8f` | `main/openldap/openldap.pre-install` |

### Aports notice-name metadata at all 35 commits

A bounded public Git-tree review queried each exact repository root and package subtree, including nested package paths. All 70 responses were complete (`truncated=false`); all 35 provenance edges are preserved in ignored `pr129-aports-notice-metadata-expectations.json`, 233,537 bytes/SHA256 `2025f700d7660609c94d6e7d2a6284f6f8c4230e7394906453738000d913e4a0`. No blobs or archive bodies were acquired.

No standalone LICENSE/LICENCE/COPYING/COPYRIGHT/NOTICE/PATENTS/UNLICENSE-named blob was found at those roots or package trees, and no package README. Root README.md occurs under three distinct Git identities. The pinned [alpine-base-era README](https://github.com/alpinelinux/aports/blob/d9d560d5de74ff9a7a73f3c903d6f126a0bf3142/README.md) describes APKBUILDs, patches and scripts without a repository license declaration. This does not prove that scripts or patches lack embedded notices or authorize applying their upstream recipe license to them.

No presumed repository LICENSE is added. The 287 retained non-archive materials (34 recipes, 147 patches, 84 auxiliaries and 22 hooks) retain their exact origin/commit/path and concrete embedded/referenced notice evidence below. No opaque or unparseable text was found in this fixed set; the search and classifications do not establish blanket legal applicability or absence of undiscovered credits. Repository metadata expectations alone do not authenticate notice bodies.

## Actual passive non-archive indicators

A single readonly analysis authenticated all 287 non-archive originals against the compiled manifest and accepted recovery receipt: 767,313 bytes, with SHA256/SHA512/applicable Git-blob hashes, complete EOF and native9 FD/path/ancestor checks, final source reseals and closure of all held descriptors. The actor was genuine Linux UID/GID 1000, empty kernel supplementary groups, zero four capability sets, NNP1, exact five-entry environment, Node 22.23.2 and ext4. No material or archive was executed, no archive was read and no network operation occurred.

Ignored metadata `pr129-non-archive-notice-indicators-v2.json` is 365,122 bytes/SHA256 `399d900e913f0a283eaf400521ede286a110c89b8cd32097d3827cb718ae3620`. It preserves each original id/origin/commit/path, complete hashes/size/native identity, bounded indicator line/byte positions and line hashes, patch target paths and safe reference-token candidates. It exports no raw lines or notice text. All 287 were strict UTF-8 without NUL; no opaque text was found. It observed 53 materials with 132 indicator rows, 51 materials with reference-token candidates and zero detected SPDX-License-Identifier declarations. Those are discovery facts, not chosen license expressions or copyright absence evidence.

| Material role | Original materials | Complete bytes | Materials with indicators | Indicator rows |
| --- | ---: | ---: | ---: | ---: |
| APORTS_RECIPE | 34 | 171,827 | 34 | 66 |
| INSTALL_HOOK | 20 | 6,565 | 0 | 0 |
| SOURCE_AUX | 84 | 165,866 | 9 | 26 |
| SOURCE_PATCH | 147 | 422,412 | 10 | 40 |
| TRIGGER | 2 | 643 | 0 | 0 |

The 34 recipes are the exact 171,827-byte text set already mapped above. Their upstream `license=` fields are not a grant over every aports script/patch. The remaining 19 indicated materials have these reproducible positions and byte identities; their complete origin/commit edges and functional target paths stay in the metadata projection:

| Exact declared source path / commit link | Candidate line positions | Observed token candidates | Complete material SHA256 |
| --- | --- | --- | --- |
| [`main/alpine-baselayout/hier.7`](https://github.com/alpinelinux/aports/blob/60a7585bbab2fa0f762504eb617dbca90216e31f/main/alpine-baselayout/hier.7#L67) | 67, 206, 207 | `Licenses`, `copying` | `8a91913d8a05ad57316355ee74d966210a6eae7bd850d46dac53e799d3981cc2` |
| [`main/bash/bash53-008`](https://github.com/alpinelinux/aports/blob/1522c3193610902d8493f9790a2755c11f21f26d/main/bash/bash53-008#L55) | 55, 66, 119, 126, 129, 131, 165, 182, 206, 213 | COPYRIGHT_OR_(c)_TOKEN_CANDIDATE | `097cd723cbfb8907674ac32214063a3fd85282657ec5b4e544d2c0f719653fb4` |
| [`main/busybox/0018-depmod-support-generating-kmod-binary-index-files.patch`](https://github.com/alpinelinux/aports/blob/c3ef5d10e6ef6528852c51f0564963e2f8c1be19/main/busybox/0018-depmod-support-generating-kmod-binary-index-files.patch#L50) | 50, 51, 52, 53, 55 | `Copyright`, `LICENSE`, `Licensed` | `6817e14f68dae612a91aa7d75e76b1212a5bba8e9cfdff11336e606bdeed98eb` |
| [`main/busybox/0024-umount-Implement-O-option-to-unmount-by-mount-option.patch`](https://github.com/alpinelinux/aports/blob/c3ef5d10e6ef6528852c51f0564963e2f8c1be19/main/busybox/0024-umount-Implement-O-option-to-unmount-by-mount-option.patch#L77) | 77 | `LICENSE`, `Licensed` | `fe1b1ed4983c26960bf9d88062e52f6f1f2735a54d15234361d2b2c53eef14ce` |
| [`main/busybox/bbsuid.c`](https://github.com/alpinelinux/aports/blob/c3ef5d10e6ef6528852c51f0564963e2f8c1be19/main/busybox/bbsuid.c#L2) | 2, 3, 6 | `Copyright`, `License` | `99f6275a53a4005d8f03d87e5361699419b33a52b2b2e2fe1c45e90ab6d51f58` |
| [`main/busybox/dad.if-up`](https://github.com/alpinelinux/aports/blob/c3ef5d10e6ef6528852c51f0564963e2f8c1be19/main/busybox/dad.if-up#L4) | 4 | `Copyright` | `2fd20d1bc67d9ee711990002b24f156635a73f56b8935b2f76592938817fa4e7` |
| [`main/busybox/default.script`](https://github.com/alpinelinux/aports/blob/c3ef5d10e6ef6528852c51f0564963e2f8c1be19/main/busybox/default.script#L4) | 4 | `Copyright` | `c7b39bba4d7f1ce05dbdeba7d2fd97b96a8c3c0c1ebc0259f641fb8e1c3827d2` |
| [`main/busybox/ssl_client.c`](https://github.com/alpinelinux/aports/blob/c3ef5d10e6ef6528852c51f0564963e2f8c1be19/main/busybox/ssl_client.c#L134) | 134 | COPYRIGHT_OR_(c)_TOKEN_CANDIDATE | `f36fb83637a12fe0706f828a3e9a4181ac6ed452b59d5d30fcf4dbe1884b8aed` |
| [`main/gcc/0002-gcc-poison-system-directories.patch`](https://github.com/alpinelinux/aports/blob/423a8ad043d07f2c7546c8ec3e2b0384cda360ae/main/gcc/0002-gcc-poison-system-directories.patch#L120) | 120, 122, 127 | `+AC_MSG_NOTICE`, `AC_MSG_NOTICE` | `8466aa1b19d862e83c7c95b3b3e577139ad302829f4775fde6869fefd13b48f8` |
| [`main/gcc/0005-On-linux-targets-pass-as-needed-by-default-to-the-li.patch`](https://github.com/alpinelinux/aports/blob/423a8ad043d07f2c7546c8ec3e2b0384cda360ae/main/gcc/0005-On-linux-targets-pass-as-needed-by-default-to-the-li.patch#L41) | 41, 66, 75, 94, 107, 132, 145, 157, 202 | `COPYING.RUNTIME`, `COPYING3`, `COPYING3.` | `460166779c04872acd684a30e90b0603cc22f96a2315d60f6af8e68feae94d3f` |
| [`main/gcc/0017-add-fortify-headers-paths.patch`](https://github.com/alpinelinux/aports/blob/423a8ad043d07f2c7546c8ec3e2b0384cda360ae/main/gcc/0017-add-fortify-headers-paths.patch#L14) | 14 | `COPYING.RUNTIME`, `COPYING3` | `0f378465137aa1c6b2d66a0c89e3a7359ec4125c50e73e0f200cf987b6aaab73` |
| [`main/gcc/0024-riscv-disable-multilib-support.patch`](https://github.com/alpinelinux/aports/blob/423a8ad043d07f2c7546c8ec3e2b0384cda360ae/main/gcc/0024-riscv-disable-multilib-support.patch#L49) | 49 | `COPYING3.` | `40dff2d834668966111d58e9e817447e07c38e643e0059742bcb2ef6bccef889` |
| [`main/gcc/0029-configure-Add-enable-autolink-libatomic-use-in-LINK_.patch`](https://github.com/alpinelinux/aports/blob/423a8ad043d07f2c7546c8ec3e2b0384cda360ae/main/gcc/0029-configure-Add-enable-autolink-libatomic-use-in-LINK_.patch#L53) | 53 | `COPYING.RUNTIME`, `COPYING3` | `d4a73c034dd8ccfbbef46c3c5a65eda67673499cbe803a7abf459c9d7d83d6db` |
| [`main/gcc/0038-static-PIE-ensure-static-reaches-the-linker.patch`](https://github.com/alpinelinux/aports/blob/423a8ad043d07f2c7546c8ec3e2b0384cda360ae/main/gcc/0038-static-PIE-ensure-static-reaches-the-linker.patch#L41) | 41, 58, 74 | `COPYING.RUNTIME`, `COPYING3` | `07d87bb9aea8eecf86c6ea74f0a7d8a89c17afd12ebfea73c2977cbe84af0124` |
| [`main/icu/data-filter-en.yml`](https://github.com/alpinelinux/aports/blob/6755fdb21483ba250d374c3244f0f48bc63447e2/main/icu/data-filter-en.yml#L4) | 4 | `noticeably` | `0138a8c234d4c243c52a545644310e37921e31b4303af1a43b043bf4884297a2` |
| [`main/musl/getconf.c`](https://github.com/alpinelinux/aports/blob/f5640d3a10f664c9119720c60515265d3d6f6d01/main/musl/getconf.c#L2) | 2, 3, 11, 14, 15, 16, 17 | `Copyright`, `copyright`, `notice` | `d87d0cbb3690ae2c5d8cc218349fd8278b93855dd625deaf7ae50e320aad247c` |
| [`main/musl/getent.c`](https://github.com/alpinelinux/aports/blob/f5640d3a10f664c9119720c60515265d3d6f6d01/main/musl/getent.c#L2) | 2, 3, 9, 12, 13, 14, 15 | `Copyright`, `copyright`, `notice` | `a6171c2db641cdd99c164169d3c5c6ca323617483cedec4cbbe3eb39c5834df0` |
| [`main/musl/iconv.c`](https://github.com/alpinelinux/aports/blob/f5640d3a10f664c9119720c60515265d3d6f6d01/main/musl/iconv.c#L4) | 4, 5 | `Copyright`, `License`, `Licensed` | `f79a2930a2e5bb0624321589edf8b889d1e9b603e01e6b7ae214616605b3fdd7` |
| [`main/openldap/0003-Add-mqtt-overlay.patch`](https://github.com/alpinelinux/aports/blob/1f9cbd23a8be05afabdd96072263ba025e097c8f/main/openldap/0003-Add-mqtt-overlay.patch#L73) | 73, 74, 76, 78, 80, 82 | `Copyright`, `LICENSE`, `License.`, `license` | `3c32d0414f619647142f94f2ce828f3e3d53b00b2291415feab32dc80846145e` |

A targeted reread of these 19 originals (122,651 bytes, 66 indicated lines) preserved their complete hashes, native identities, original receipt/manifest association, final reseals and closed descriptors. Ignored signal metadata `pr129-non-archive-notice-classification-v2.json` is 38,243 bytes/SHA256 `4c52d4c898f18f39ef4da144e3bcd94ec7baaadc9b6adb0e1c3df2d55c300c7d`. It contains fixed lexical signals and line hashes only, not raw source or notice text. The classifications below distinguish actual references from search false positives; they do not relicense patches or select a legal interpretation.

| Retained materials | Classified observation | Source/reference association |
| --- | --- | --- |
| `bash53-008`, `ssl_client.c` | Functional C expressions containing `(c)`, without a copyright keyword on the indicated lines | FALSE_POSITIVE_FUNCTIONAL_TOKEN; no extra notice reference is created from these tokens. |
| GCC `0002-gcc-poison-system-directories.patch` | Three `AC_MSG_NOTICE` configure status messages | FALSE_POSITIVE_FUNCTIONAL_TOKEN, not a copyright notice. |
| ICU `data-filter-en.yml` | Ordinary adverb `noticeably` | FALSE_POSITIVE_ORDINARY_PROSE. |
| Alpine baselayout `hier.7` | Manual-page documentation naming license/copying directories | DOCUMENTATION_LICENSE_DIRECTORY_REFERENCE, not a root aports license declaration or a concrete missing standalone file. |
| BusyBox `0018-depmod...`, `0024-umount...` | Copyright context/addition/removal and explicit GPLv2/`LICENSE` references in source headers | `busybox-1.37.0/LICENSE`, 18,348 bytes/SHA256 `bbfc9843646d483c334664f651c208b9839626891d8f17604db2146962f43548`, is actually observed in the matching complete archive. Patch-side distinctions remain preserved. |
| BusyBox `bbsuid.c` | Retained copyright header and GPLv2 named declaration at line 6 | INLINE_NAMED_LICENSE_DECLARATION in this independently retained auxiliary; no origin-wide license substitution. |
| BusyBox `dad.if-up`, `default.script` | Copyright headers at line 4 | INLINE_COPYRIGHT_HEADER; these bytes are retained with their exact aports provenance, without inventing an unreferenced external notice. |
| GCC `0005`, `0017`, `0024`, `0029`, `0038` patches | Actual source-header/context references to `COPYING3` and, in four patches, `COPYING.RUNTIME` | Matching archive members `gcc-15.2.0/COPYING3` (35,147 bytes/SHA256 `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`) and `gcc-15.2.0/COPYING.RUNTIME` (3,324 bytes/SHA256 `9d6b43ce4d8de0c878bf16b54d8e7a10d9bd42b75178153e3af6a815bdc90f74`) are observed. `COPYING3.LIB` is also observed, 7,639 bytes/SHA256 `a853c2ffec17057872340eee242ae4d96cbf2b520ae27d903e1b2fef1a5f9d1c`. Trailing punctuation in lexical `COPYING3.` is not part of the referenced filename. |
| musl `getconf.c`, `getent.c` | Copyright and source/binary redistribution clauses in the retained headers | INLINE_TERMS_AND_COPYRIGHT in the auxiliary files; retained clauses are not replaced by musl's top-level MIT declaration. |
| musl `iconv.c` | Copyright plus named GPLv2 declaration at line 5 | INLINE_NAMED_LICENSE_DECLARATION; this supports the recipe's separate musl-utils declaration rather than silently applying core musl's MIT declaration. |
| OpenLDAP `0003-Add-mqtt-overlay.patch` | Added copyright/redistribution clauses and `LICENSE` reference for `contrib/slapd-modules/mqtt/mqtt.c` | Inline patch header is retained; matching `openldap-2.6.14/LICENSE` is observed, 2,214 bytes/SHA256 `310fe25c858a9515fc8c8d7d1f24a67c9496f84a91e0a0e41ea9975b1371e569`. This records the reference, without implying that the root license overrides the added terms. |

Thus the 19 indicated non-recipes comprise four functional/prose false-positive materials, one directory-documentation material, five GCC referenced-header patches and nine materials carrying inline copyright/license evidence. No concrete extra notice filename is inferred from the false positives; all explicit GCC/BusyBox/OpenLDAP filename references in this set have retained matching source members. Bytes and provenance of the remaining non-indicated scripts/patches remain associated, with no notice-exemption or implicit relicensing claim.

The 20 install hooks and two triggers had no detected indicator. This is not a notice exemption; their provenance and upstream/script attribution remain in the table. The initial analysis refusal, 246 bytes/SHA256 `2dd244e3b5c11da5a08b0b7e153e4f08ab7d1012d8d7e1fa8d7a512e68c2dfd0`, remains preserved: a reviewer regex representation failed its actor check before the 287 bodies were opened. V2 corrected that representation with exact kernel token comparisons; no production gate, source or collector was changed.

## Actual 42-archive notice candidate observations

The first-batch failure remains preserved: receipt 35,276 bytes/SHA256 `7eb4ec133686e2162cdd60c7ff5317fb295fad7d6bc3c571d55d64c9eaf258d6`, failed ACK SHA256 `33f62316a5dc028d06e5dd50fe07ec0512689b2881dfd9811d1dbd36911d9b04` and original 107,809-byte projection/SHA256 `b537b2634c7e1a3c976092a51f8ea881e140bed4367c7a1f84095940276b58df`. Its 41 successful sources were reused unchanged; only GCC was recovered under the reviewed bounded profile.

The cumulative authenticated rollup `pr129-notice-candidate-coverage-authenticated-rollup42.json` is142222bytes/SHA256 `e8ebbf345ba6e81dc6e7b4c91e5aa914a1a3aa60de9b73e14925b7005949409f`. It binds all42 observed sources, zero failures and283 candidate rows:280 regular files with observed size/SHA256, three directories without content hashes, zero links and158 unique content hashes. The77897-byte JSONL/SHA256 `a96ee5aff7e5e91f434cbdf68730a676fe3a1d5ff7a4ff4779227abc7e6e6c27` was reconstructed from that retained rollup and exactly matches the previously announced SHA; no original standalone JSONL was located. This document authenticated the reconstructed metadata projection's full bytes without reparsing an archive. No raw notice bytes are included.

Distinct basenames include nested occurrences. Names such as `copyright_test.go`, `copying.f90` and `legal-debug.ll` still need classification; a filename match is not automatically an applicable notice. Shared TAR coverage reports STDLIB_MEMBERS_OBSERVED, NOTICE_BYTES_HASHED and DECODER_EOF_AND_ZERO_TRAILER_CHECKED, with the explicit gap TAR_MEMBER_PADDING_AND_EXTENSION_SEMANTICS_NOT_FULLY_VALIDATED. Preserve actual per-archive coverage rather than promoting it to the older fixed helper's complete envelope profile.

| Exact source association | Candidate rows | Distinct observed basenames | Result |
| --- | ---: | --- | --- |
| `COLLECTION-go1.24.6` | 35 | `LICENSE`, `PATENTS`, `copyright`, `copyright_test.go` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-apk-tools-apk-tools-v3.0.8.tar.gz` | 1 | `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-bash-bash-5.3-1.tar.gz` | 4 | `COPYING`, `COPYRIGHT`, `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-busybox-busybox-1.37.0.tar.bz2` | 2 | `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-ca-certificates-ca-certificates-20260909.tar.bz2` | 0 | NO_FILENAME_CANDIDATE | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-cyrus-sasl-cyrus-sasl-2.1.28.tar.gz` | 3 | `COPYING`, `COPYRIGHT` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-e2fsprogs-e2fsprogs-1.47.4.tar.gz` | 5 | `COPYING`, `COPYRIGHT`, `NOTICE`, `copyright` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-gcc-gcc-15.2.0.tar.xz` | 55 | `COPYING`, `COPYING.LIB`, `COPYING.RUNTIME`, `COPYING3`, `COPYING3.LIB`, nested license/notice/test filenames | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-gdbm-gdbm-1.26.tar.gz` | 1 | `COPYING` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-icu-icu4c-78.1-data-bin-b.zip` | 1 | `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-icu-icu4c-78.1-data-bin-l.zip` | 1 | `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-icu-icu4c-78.1-data.zip` | 0 | NO_FILENAME_CANDIDATE | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-icu-icu4c-78.1-sources.tgz` | 2 | `LICENSE`, `license.html` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-keyutils-keyutils-1.6.3.tar.gz` | 2 | `LICENCE.GPL`, `LICENCE.LGPL` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-krb5-krb5-1.22.2.tar.gz` | 9 | `LICENSE`, `NOTICE`, `copyright.h`, `copyright.html`, `copyright.rst`, `copyright.rst.txt`, `license.rtf`, `notice.rst` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-libedit-libedit-20260508-3.1.tar.gz` | 1 | `COPYING` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-libffi-libffi-3.5.2.tar.gz` | 2 | `LICENSE`, `LICENSE-BUILDTOOLS` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-libverto-libverto-0.3.2.tar.gz` | 1 | `COPYING` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-libxml2-libxml2-2.13.9.tar.xz` | 1 | `Copyright` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-libxslt-libxslt-1.1.43.tar.xz` | 5 | `COPYRIGHT`, `Copyright`, `copyright.html` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-llvm21-llvm-project-21.1.8.src.tar.xz` | 36 | `COPYRIGHT.regex`, `LICENSE`, `LICENSE.TXT`, `LICENSE.txt`, `copying.f90`, `legal-debug.ll`, `legal-indirect-calls.ll` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-lz4-lz4-1.10.0.tar.gz` | 7 | `COPYING`, `LICENSE`, `copyright` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-musl-musl-1.2.6.tar.gz` | 1 | `COPYRIGHT` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-ncurses-ncurses-6.6-20260516.tgz` | 8 | `COPYING`, `copyright` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-nss_wrapper-nss_wrapper-1.1.12.tar.gz` | 2 | `COPYING-CMAKE-SCRIPTS`, `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-openldap-openldap-2.6.14.tgz` | 13 | `COPYRIGHT`, `Copyright`, `LICENSE`, `LICENSE-2.0.1`, `copyright-plain.sdf`, `copyright.sdf`, `license-plain.sdf`, `license.sdf` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-openssl-openssl-3.5.8.tar.gz` | 3 | `LICENSE`, `LICENSE.txt`, `copyright.pm` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-pax-utils-pax-utils-1.3.9.tar.xz` | 1 | `COPYING` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-readline-readline-8.3.tar.gz` | 1 | `COPYING` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-tzdata-posixtz-0.5.tar.xz` | 0 | NO_FILENAME_CANDIDATE | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-tzdata-tzcode2026d.tar.gz` | 1 | `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-tzdata-tzdata2026d.tar.gz` | 1 | `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-util-linux-util-linux-2.42.3.tar.xz` | 19 | `COPYING`, `COPYING.BSD-2-Clause`, `COPYING.BSD-3-Clause`, `COPYING.BSD-4-Clause-UC`, `COPYING.EUPL-1.2`, `COPYING.GPL-2.0-only`, `COPYING.GPL-2.0-or-later`, `COPYING.GPL-3.0-or-later`, `COPYING.ISC`, `COPYING.LGPL-2.1-or-later`, `COPYING.MIT`, `licenses` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-xz-xz-5.8.4.tar.gz` | 6 | `COPYING`, `COPYING.0BSD`, `COPYING.GPLv2`, `COPYING.GPLv3`, `COPYING.LGPLv2.1`, `license-check.sh` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-zlib-zlib-1.3.2.tar.gz` | 3 | `LICENSE`, `LICENSE.Info-Zip`, `LICENSE_1_0.txt` | NOTICE_CANDIDATES_OBSERVED |
| `COLLECTION-material-zstd-zstd-1.5.7.tar.gz` | 3 | `COPYING`, `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `PR127-GOSU_SOURCE` | 1 | `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `PR127-MOBY_USER_MODULE_SOURCE` | 1 | `LICENSE` | NOTICE_CANDIDATES_OBSERVED |
| `PR127-X_SYS_MODULE_SOURCE` | 2 | `LICENSE`, `PATENTS` | NOTICE_CANDIDATES_OBSERVED |
| `PR127-GO_STDLIB_SOURCE` | 38 | `LICENSE`, `PATENTS`, `copyright`, `copyright_test.go` | NOTICE_CANDIDATES_OBSERVED |
| `PR128-POSTGRES_UPSTREAM_SOURCE` | 4 | `COPYRIGHT`, `copyright.pl`, `legal.sgml` | NOTICE_CANDIDATES_OBSERVED |
| `PR128-DOCKER_LIBRARY_POSTGRES_SOURCE` | 1 | `LICENSE` | NOTICE_CANDIDATES_OBSERVED |

GCC's source bytes are retained: 101,056,276 bytes/SHA256 `438fd996826b0c82485a29da03a72d71d6e3541a83ec702df4271f6fe025d24e`. Its reader refused with `postgres_source_archive_notice_member_limit`, exit 1 and confirmed cleanup. The original 332-byte failure metadata/SHA256 `043dd5be8a9618e0eabec7802e8fbdae5a46167cfeaa9fa3a36a5258bebcc54a` remains preserved. The recovered result observes 149,865 members and 1,073,448,960 decoded stream bytes under the fixed 500,000-member/536,870,912-byte RLIMIT_AS profile, with 55 candidate rows. Its success supersedes no original failure bytes and grants no closure or admission by itself.

The three non-regular candidates are directories `go/src/internal/copyright` in older/current Go and `util-linux-2.42.3/Documentation/licenses`, NON_REGULAR_NO_CONTENT. The three zero-filename-candidate archives are ca-certificates, ICU data.zip and posixtz; zero candidates does not establish absence of copyright or notice requirements. Targeted embedded metadata for ca-certificates and posixtz has now been authenticated: original report 10,267 bytes/SHA256 `0e6a917e080cf9e12bc3861c654b356e255f83f401b9d156dd2c891d81205086`, projection 11,465 bytes/SHA256 `8c84974dfc05b034bbf591c7357ba3fe4d5b0807a846ea9d6bec3cf9179d1287`. Only metadata was read for this table, with no archive replay or raw text.

| Zero-filename source | Observed embedded coverage | Exact indicated member references |
| --- | --- | --- |
| ca-certificates 20260909 | 15 members, 13 regular/2 directories, no links; 15 indicated lines: 7 COPYRIGHT, 1 SPDX, 2 MPL, 7 LICENSE_TEXT (overlapping categories) | `c_rehash.c` lines 4/7/8; `certdata.txt` lines 3/4/2175/2177/2286/2288; `mk-ca-bundle.pl` lines 9/13/22/173/447/453. Member/line size/SHA256 are retained in the authenticated projection. |
| posixtz 0.5 | 9 members, 8 regular/1 directory, no links; 4 indicated lines: 3 COPYRIGHT, 1 LICENSE_TEXT | `posixtz.c` lines 3/4/6; `posixtz.lua` line 3, with retained member/line hashes. |
| ICU 78.1 data.zip | No standalone notice filename in the accepted enumeration | RECIPE_ASSOCIATED_NO_STANDALONE_CANDIDATE: four exact ICU archives from recipe commit `6755fdb21483ba250d374c3244f0f48bc63447e2`. Recipe L96 copies `$srcdir/icu/license.html`; source archive `icu/license.html` is 622 bytes/SHA256 `c62d7697c03979f5056d28b338fafc7a1152820f7b379adf4a9d88cd37160f96`. Source `icu/LICENSE` and each bin ZIP root `LICENSE` share 27,718 bytes/SHA256 `e55522d81edc687a341a4411e0776e54ca654e90147f354a90458aaced4116af`. No LICENSE is invented inside data.zip. |

The two embedded classifications are EMBEDDED_INDICATOR_LINES_OBSERVED_IN_REGULAR_SOURCE_FILES. Their complete archives preserve the indicated bytes; pattern observations do not select legal meaning or establish notice closure. The shared TAR/ZIP gaps remain explicit (37 TAR profiles and five ZIP profiles), as does the first GCC refusal.

## Twelve ordered retained layers: native inventory verified

The following IDs come from the authenticated subject inventory. Annotation counts describe the current 50 report records only. Zero means no current report record points to that layer; it does not mean the layer is empty, contains no source-sensitive binary/notice, or has no historical package.

| Zero-based layer | Authenticated DiffID | Report annotation count | Native members/entries/whiteouts | Observed APK database | Filename notice candidates |
| --- | --- | ---: | --- | --- | ---: |
| 0 | `sha256:74d97c428c51a828f9051a7a40a53ff1fc99e54fc30323ce36760701b0b7f711` | 16 | 515/515/0 | 16 records; `f3c5bdc8732409f6849ec6e245db1d7a5bb3be6da6120e6787ba3970cc5baccd` | 0 |
| 1 | `sha256:199b85bb67b34ec56ca3679a640cad26c482694949d478875ad803bfad29f113` | 0 | 10/10/0 | NO_DATABASE_CHANGESET | 0 |
| 2 | `sha256:1b1c5f60fe610883c371803e933d0eb9d31dfe8ae9c1a5299e2516c6757eb2d9` | 0 | 29/29/0 | 16 records; `f3c5bdc8732409f6849ec6e245db1d7a5bb3be6da6120e6787ba3970cc5baccd` | 0 |
| 3 | `sha256:507f0fcc5e5565bd8f7a584202000685ebfaa7ebda9b9d436289bc1004fb4ce8` | 0 | 1/1/0 | NO_DATABASE_CHANGESET | 0 |
| 4 | `sha256:34f5e4927b447367ecd2367ae94e56d654a30b9e244b9396ac628d5bcf90a5cf` | 29 | 3474/3474/0 | 45 records; `d7547813da119795e412a5d2603e049cc172f67ba4777c3446fa3bc918a4419d` | 0 |
| 5 | `sha256:d006a4a663e7362cd4ae34ed8bf9a851ac9e99c359d8b1f143b1fccc0ad3e8fe` | 0 | 6/6/0 | NO_DATABASE_CHANGESET | 0 |
| 6 | `sha256:42a506b7d4dafcf6fb679a5c2e4de60153ebca613bbfad36b833053eb92cd047` | 0 | 2/2/0 | NO_DATABASE_CHANGESET | 0 |
| 7 | `sha256:149a42a2d36a8dc846e4624af2c7c2766d1cac31300c9f8392ca050d137ed217` | 0 | 4/4/0 | NO_DATABASE_CHANGESET | 0 |
| 8 | `sha256:f81d67057ca8ee3ee1f538cdb7b128e05b4e2727e1c50686633d8b5158793fe2` | 0 | 5/5/0 | NO_DATABASE_CHANGESET | 0 |
| 9 | `sha256:b69834c94476d5cb5d6561d3529668949fa3d28bd745a937bcec2f66eadebb72` | 0 | 4/4/0 | NO_DATABASE_CHANGESET | 0 |
| 10 | `sha256:d438b225a8977c23dd26527e196bdff21f4565ec24f22b931aa69aaf38a2df24` | 0 | 4/4/0 | NO_DATABASE_CHANGESET | 0 |
| 11 | `sha256:90b3a336de1c13f00f45fbf3e985e3366ad191aa9919864ac946f735d965e092` | 5 | 17/15/2 | 46 records; `6552d6b7caaa8bee8d3467521fd51147706f349353ea46cde1bf0947f8ecda16` | 0 |

The independently accepted native report is 2,466,654 bytes/SHA256 `db00363cf10194ff95a057870ce73ba5ccc08b03e4d67777b9483268482fdbbe`, supervisor ACK SHA256 `5778d7a05d509d69569616c14325df0b8ae92ae954c628fa23a60ac0c907f907`. Its author authenticated the original readonly native FD/path/parents/full-SHA/EOF and produced metadata 107,109 bytes/SHA256 `85ffc18e19437f398b035534a3bde920d1b38834a4d1834b38b280f1a1d4e324`; this table verified that projection's size/SHA256 and reads metadata only, without another archive inspection.

The 12 changesets have 4,071 TAR members, 4,069 entries, two whiteouts in layer 11 and zero opaque-directory operations. APK snapshots at layers 0/2/4/11 have 16/16/45/46 records: 123 occurrences, 46 distinct raw records and 46 final APK records. Every observed historical APK identity/origin is also present in the final snapshot; no extra historical APK version/origin was found. This does not eliminate non-APK historical binaries/compiler/source obligations. Final gosu's APK declaration `1.19-r5` / `gosu` / `Apache-2.0` does not overwrite the Go main/module report's missing version/license declarations.

The virtual `.postgresql-rundeps` raw record is SHA256 `97f88508aee3d01274dd836363d59772a9d8c1873e4bca95d14a56c9385d0128`, with 22 declared dependencies: `so:libLLVM.so.21.1`, `so:libc.musl-x86_64.so.1`, `so:libcrypto.so.3`, `so:libedit.so.0`, `so:libgcc_s.so.1`, `so:libgssapi_krb5.so.2`, `so:libicui18n.so.78`, `so:libicuuc.so.78`, `so:libldap.so.2`, `so:liblz4.so.1`, `so:libssl.so.3`, `so:libstdc++.so.6`, `so:libuuid.so.1`, `so:libxml2.so.2`, `so:libxslt.so.1`, `so:libz.so.1`, `so:libzstd.so.1`, `bash`, `tzdata`, `zstd`, `icu-data-full`, `nss_wrapper`. The targeted final database observation now establishes all 22 package/origin associations from exact `P/V/o/p/D` fields, rather than guessed soname filenames. Independently authenticated report: 10,039 bytes/SHA256 `9ab91cb31c07a29b0565048c51caed58cd3d5d9b03a3f4a0af23c691c0b8a583`, supervisor stdout SHA256 `84db02bb0b7d695699db1b7301352d5710562db28d0afe8f29af68970518a06e`. The genuine UID1000 child received only the readonly byte-pinned original, selected exactly the last raw layer (2,055,168 bytes/DiffID above), and read only `lib/apk/db/installed` (64,264 bytes/SHA256 `6552d6b7caaa8bee8d3467521fd51147706f349353ea46cde1bf0947f8ecda16`). Full opaque archive SHA/EOF/native9 were sealed before/after; the root supervisor confirmed source/code/runtime stability, exit0/complete stdout/empty stderr, root600 fsync/readback and closed FDs. This table authenticated that report's native9/root parent/full SHA/EOF before/after only; no archive or inventory was replayed.

| Virtual dependency | Exact final package | APK version | Declared origin | Database edge |
| --- | --- | --- | --- | --- |
| `so:libLLVM.so.21.1` | `llvm21-libs` | `21.1.8-r1` | `llvm21` | p provides |
| `so:libc.musl-x86_64.so.1` | `musl` | `1.2.6-r2` | `musl` | p provides |
| `so:libcrypto.so.3` | `libcrypto3` | `3.5.8-r0` | `openssl` | p provides |
| `so:libedit.so.0` | `libedit` | `20260508.3.1-r1` | `libedit` | p provides |
| `so:libgcc_s.so.1` | `libgcc` | `15.2.0-r5` | `gcc` | p provides |
| `so:libgssapi_krb5.so.2` | `krb5-libs` | `1.22.2-r1` | `krb5` | p provides |
| `so:libicui18n.so.78` | `icu-libs` | `78.1-r0` | `icu` | p provides |
| `so:libicuuc.so.78` | `icu-libs` | `78.1-r0` | `icu` | p provides |
| `so:libldap.so.2` | `libldap` | `2.6.14-r0` | `openldap` | p provides |
| `so:liblz4.so.1` | `lz4-libs` | `1.10.0-r1` | `lz4` | p provides |
| `so:libssl.so.3` | `libssl3` | `3.5.8-r0` | `openssl` | p provides |
| `so:libstdc++.so.6` | `libstdc++` | `15.2.0-r5` | `gcc` | p provides |
| `so:libuuid.so.1` | `libuuid` | `2.42.3-r1` | `util-linux` | p provides |
| `so:libxml2.so.2` | `libxml2` | `2.13.9-r2` | `libxml2` | p provides |
| `so:libxslt.so.1` | `libxslt` | `1.1.43-r3` | `libxslt` | p provides |
| `so:libz.so.1` | `zlib` | `1.3.2-r0` | `zlib` | p provides |
| `so:libzstd.so.1` | `zstd-libs` | `1.5.7-r2` | `zstd` | p provides |
| `bash` | `bash` | `5.3.9-r1` | `bash` | P name |
| `tzdata` | `tzdata` | `2026d-r0` | `tzdata` | P name |
| `zstd` | `zstd` | `1.5.7-r2` | `zstd` | P name |
| `icu-data-full` | `icu-data-full` | `78.1-r0` | `icu` | P name |
| `nss_wrapper` | `nss_wrapper` | `1.1.12-r1` | `nss_wrapper` | P name |

Every declaration maps uniquely: 17 soname `p:` edges plus five exact package-name edges. Two ICU sonames map to the same `icu-libs` package. These are explicit APK declarations, not a dynamic-link execution or filesystem reconstruction. The virtual package remains a dependency set without a fictitious upstream archive or license. Source/recipe/notice associations use the exact mapped origin rows above; source-to-binary reproduction and notice legality are not inferred.

Old `usr/local/bin/gosu` occurs in layer 2: 1,769,900 bytes/SHA256 `52c8749d0142edd234e9d6bd5237dff2d81e71f43537e2f4f66f75dd4b243dd0`, REMOVED_OR_REPLACED. Final `usr/bin/gosu` occurs in layer 11: 1,977,120 bytes/SHA256 `6d3214ab9d2f1e9ffda75ea2f6bb1f454a13a78dd70318e09eee814ce32cce03`. A Go/compiler version is not derived from either path or hash. PostgreSQL/pg_dump/pg_restore/psql survive from layer 4; their versions are not derived by this path observation. No targeted APKBUILD/Dockerfile/go.mod/go.sum/VERSION/go/gofmt or `usr/local/go` tree was observed.

The historical version edge is supported separately by public retained evidence, not by running or parsing the old binary. [filesystem-policy.json](../../infra/postgres-image/filesystem-policy.json) pins that lower-layer gosu path/hash; [lock.json](../../infra/postgres-image/lock.json) binds base platform `aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3` to index `b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`. The [public audit receipt 36343617867](service-image-audits/36343617867/audit-receipt.json) is 101,834 bytes/SHA256 `aeed3a9cff72fecbd6a2d2db96dff49e3bdd0ecf9f623b1e1392e4f53cc9217b`; its postgres-alpine/index/target `usr/local/bin/gosu` declaration identifies `stdlib@v1.24.6` and binds a 296,480-byte raw report/SHA256 `607cb358e2372fb9558a622155cd39991bb669eb414cbc49a2159f27c2392063`. The older [receipt 36342206206](service-image-audits/36342206206/audit-receipt.json), 117,661 bytes/SHA256 `612d8739ce5b81f76ad61966982aabe09489ed3633ce440675a7e1b6c0a5bb3d`, is retained separately. Complete bytes of both public receipts were verified for this table.

The already-retained raw `image-postgres-alpine.json` for run 36343617867 was found in the existing private Windows cache and authenticated by a held readonly FD: complete 296,480 bytes/SHA256 `607cb358e2372fb9558a622155cd39991bb669eb414cbc49a2159f27c2392063`, EOF and native9 FD/path identity before/after, then closed. This is NTFS byte authentication only; no private ACL, Linux UID1000 retention, fresh scan or binary execution is claimed. Its `usr/local/bin/gosu` gobinary target declares exactly four packages:

| Historical report declaration | Existing retained source association | Boundary |
| --- | --- | --- |
| `github.com/tianon/gosu@v1.19.0` | Complete gosu 1.19 source already accepted by PR127; the [accepted diagnostic](TASK-0005A-POSTGRES-GOSU-DIAGNOSTIC.md) and pinned base recipe supply the historical gosu association | Historical main-module declaration stays distinct from the corrected candidate's absent Go main version and APK `gosu@1.19-r5`. |
| `stdlib@v1.24.6` | Complete Go 1.24.6 bytes in the accepted 323-material batch and 35 notice candidates in the cumulative rollup | Historical version edge is established without executing or newly parsing the old binary. |
| `github.com/moby/sys/user@v0.1.0` | Reuse the exact PR127 module ZIP and accepted h1/go.mod h1 binding; no second archive is invented | Historical and corrected-build report edges are both retained, rather than assuming one from the other. |
| `golang.org/x/sys@v0.1.0` | Reuse the exact PR127 module ZIP, LICENSE/PATENTS and accepted h1/go.mod h1 binding | This closes the concrete missing old-report dependency metadata; it does not prove binary reproduction or all source-to-binary provenance. |

All four declarations come from that exact raw report's Packages array, not solely its vulnerability entries. No old collector, archived executable, ZIP re-extraction, network acquisition or old async bundle replay was performed.

All layers have zero filename notice candidates under the reviewed rule. This is no legal absence proof or statement about inline credits/nonstandard names. Relate actual APK/whiteout/final-path/helper observations to source/subpackage rows, preserving declarations, history and unresolved bindings. Accepted physical inventory does not establish source/notice closure.

## Remaining ledger work and preserved scope limits

| Coverage / remaining integration | Present fact | Preserved scope / next record |
| --- | --- | --- |
| Complete opaque byte inventory | VERIFIED: 323/323, 496,389,328 bytes; original 316/323 failure preserved | Preserve independently accepted recovery/receipt/ACK and contexts/failures. No notices or source binding is inferred from BYTES_VERIFIED_UNADMITTED. |
| Whole-archive notice enumeration | VERIFIED OBSERVATIONS: 42 observed, zero failures, 283 candidate rows; original GCC refusal preserved | Preserve pins, coverage gaps and refusal. Record the reviewed GCC recovery and exact filename-reference map; preserve 37 TAR/five ZIP semantic gaps. ca-certificates/posixtz embedded evidence and the exact ICU recipe/source/bin notice association are present, with the zero standalone candidate fact retained. |
| Non-archive and aports notices | 287 full-byte originals authenticated; 132 indicator rows; no standalone notice-name blobs at 35 fixed roots/package trees | 19 indicated non-recipes classified: four false positives, one documentation item, five GCC reference-header patches and nine inline-evidence materials; explicit referenced filenames have matching retained members. Keep exact patch-side/script provenance and no inferred relicensing or presumed repository LICENSE. |
| Historical layer and virtual package map | Native inventory VERIFIED; 46 final APK records/35 origins; virtual record has 22 dependencies; historical gosu differs | All 22 virtual package edges now map uniquely by declared provides/name to exact final APK versions/origins; all four historical gosu package declarations are recorded separately. Preserve those source/notice/history references and no filesystem reconstruction or binary reproduction inference. |
| Older Go source/history | Complete Go 1.24.6 archive retained; 35 notice candidates; public historical audit supports old stdlib 1.24.6 association | The exact existing raw report now provides all four old-gosu declarations, including both v0.1.0 modules; reuse their PR127 sources with distinct historical edges. Preserve the old/new APK/Go declarations, complete archive/member references and no binary reproduction claim. |
| Complete retained evidence association | Independently accepted: 496 references/1205734424 bytes, 474 unique objects/900089203 bytes, 22 groups; 23 historical refs remain in three `INCOMPLETE` records | The path-free [core inventory](../../infra/postgres-image/core-evidence-inventory.json) and [acceptance projection](../../infra/postgres-image/core-evidence-acceptance.json) expose no private local paths or raw ACK/receipt/policy. Attestation and the second COMPLETE copy remain later gates. |

The declared-reference table has no unresolved technical identifier edge in its fixed scope. The consolidated retriever bound these receipts, inventories, raw reports, notices, source materials and historical recipes into the actual root ACK2030bytes/SHA256 `5a497398de8f4f675ee8ea0b6978c8692b3044fa79374cf6521d8185d4065667`, state `RETRIEVED`, `CORE_COMPLETE`, `sourceUnchanged` and `descriptorsClosed:true`; independent native review returned APPROVE. The37 TAR and five ZIP inspection limitations remain explicit and do not invent a generic source-parser or legal-review gate. No blanket completeness is inferred for binary reproduction, legal interpretation, current vulnerability eligibility or an arbitrary unobserved source tree.

P1 completion records only complete evidence coverage. It does not grant current audit eligibility, private-access acceptance, signing, registry write, admission, runtime startup, four-service acceptance or support activation. Full binary reproduction, blanket legal compliance and Git-object authentication of every source tarball are not silently added as new ADR7 gates. The old incomplete batch, recovery failures, unsupported inspections and any unaccepted drafts remain preserved with their original identity and scope.

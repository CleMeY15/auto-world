#!/bin/sh
set -eu

# These 34 assertions preserve the command bodies from gosu1.20's
# Dockerfile.test-alpine. The four negations gain explicit failure guards when
# combined into one script. The same PostgreSQL Alpine base supplies the users.
case "${1-}" in
    prepare)
        cat > /usr/local/bin/gosu-t <<'GOSU_ASSERT'
#!/bin/sh
set -ex
spec="$1"; shift
expec="$1"; shift
real="$(gosu "$spec" id -u):$(gosu "$spec" id -g):$(gosu "$spec" id -G)"
[ "$expec" = "$real" ]
expec="$1"; shift
real="$(gosu "$spec" id -un):$(gosu "$spec" id -gn):$(gosu "$spec" id -Gn)" || true
[ "$expec" = "$real" ]
GOSU_ASSERT
        chmod 0755 /usr/local/bin/gosu-t
        ;;
    assertions)
        id
        gosu-t 0 "0:0:$(id -G root)" "root:root:$(id -Gn root)"
        gosu-t 0:0 '0:0:0' 'root:root:root'
        gosu-t root "0:0:$(id -G root)" "root:root:$(id -Gn root)"
        gosu-t 0:root '0:0:0' 'root:root:root'
        gosu-t root:0 '0:0:0' 'root:root:root'
        gosu-t root:root '0:0:0' 'root:root:root'
        gosu-t 1000 "1000:$(id -g):$(id -g)" "1000:$(id -gn):$(id -gn)"
        gosu-t 0:1000 '0:1000:1000' 'root:1000:1000'
        gosu-t 1000:1000 '1000:1000:1000' '1000:1000:1000'
        gosu-t root:1000 '0:1000:1000' 'root:1000:1000'
        gosu-t 1000:root '1000:0:0' '1000:root:root'
        gosu-t 1000:daemon "1000:$(id -g daemon):$(id -g daemon)" '1000:daemon:daemon'
        gosu-t games "$(id -u games):$(id -g games):$(id -G games)" 'games:games:games users'
        gosu-t games:daemon "$(id -u games):$(id -g daemon):$(id -g daemon)" 'games:daemon:daemon'
        gosu-t 0: "0:0:$(id -G root)" "root:root:$(id -Gn root)"
        gosu-t '' "$(id -u):$(id -g):$(id -G)" "$(id -un):$(id -gn):$(id -Gn)"
        gosu-t ':0' "$(id -u):0:0" "$(id -un):root:root"
        [ "$(gosu 0 env | grep '^HOME=')" = 'HOME=/root' ]
        [ "$(gosu 0:0 env | grep '^HOME=')" = 'HOME=/root' ]
        [ "$(gosu root env | grep '^HOME=')" = 'HOME=/root' ]
        [ "$(gosu 0:root env | grep '^HOME=')" = 'HOME=/root' ]
        [ "$(gosu root:0 env | grep '^HOME=')" = 'HOME=/root' ]
        [ "$(gosu root:root env | grep '^HOME=')" = 'HOME=/root' ]
        [ "$(gosu 0:1000 env | grep '^HOME=')" = 'HOME=/root' ]
        [ "$(gosu root:1000 env | grep '^HOME=')" = 'HOME=/root' ]
        [ "$(gosu 1000 env | grep '^HOME=')" = 'HOME=/' ]
        [ "$(gosu 1000:0 env | grep '^HOME=')" = 'HOME=/' ]
        [ "$(gosu 1000:root env | grep '^HOME=')" = 'HOME=/' ]
        [ "$(gosu games env | grep '^HOME=')" = 'HOME=/usr/games' ]
        [ "$(gosu games:daemon env | grep '^HOME=')" = 'HOME=/usr/games' ]
        ! gosu bogus true || exit 1
        ! gosu 0day true || exit 1
        ! gosu 0:bogus true || exit 1
        ! gosu 0:0day true || exit 1
        printf '%s\n' 'upstream-alpine-identity-assertions=17' 'upstream-alpine-home-assertions=13' 'upstream-alpine-refusal-assertions=4' 'upstream-alpine-result=passed'
        ;;
    exec-check)
        # Compare the process ID across exec instead of nesting Docker/top.
        # Gosu must replace itself; the shell reached afterwards has this PID.
        GOSU_TEST_EXPECTED_PID=$$
        export GOSU_TEST_EXPECTED_PID
        exec gosu root sh -ec 'test "$$" = "$GOSU_TEST_EXPECTED_PID"; printf "%s\n" "gosu-process-replacement=passed"'
        ;;
    *)
        printf '%s\n' 'Unknown gosu functional-test phase' >&2
        exit 1
        ;;
esac

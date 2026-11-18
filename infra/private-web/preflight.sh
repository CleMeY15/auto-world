#!/bin/sh
set -eu
# Requires the reviewed reports build and the offline synthetic DTO authority.
product() {
    curl -fsS --max-time 3 --unix-socket /run/aw-private-product/web.sock -H 'Host: 127.0.0.1:3130' "http://localhost$1"
}
listing=lst_5696220ef97cf2af439e0279456ea36c70dd3df4e97b4455fc1577fa81aa8863
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    auth=$(curl -s --max-time 2 --unix-socket /run/aw-private-auth/auth.sock -H 'Host: autofind.tech' -o /dev/null -w '%{http_code}' http://localhost/session-check) || auth=000
    if [ "$auth" = 401 ] &&
       product "/demo/rapports/$listing/b2-parcours" | grep -F '/acces/deconnexion' >/dev/null &&
       product "/api/demo/v2/listings/$listing" | grep -F "$listing" >/dev/null; then
        exit 0
    fi
    sleep 1
done
echo 'Autorité, rapport synthétique, lien de déconnexion ou DTO indisponible.' >&2
exit 1

from datetime import datetime, timezone
from pathlib import Path
import re
from urllib.parse import urlsplit

from django.contrib.auth import logout
from django.contrib.auth.views import LoginView
from django.http import FileResponse, HttpResponse
from django.shortcuts import render
from django.urls import path, re_path
from django.views.decorators.http import require_http_methods

PAGES = {"/", "/demo", "/carte-grise", "/historique-vehicule", "/importation"}
REPORT = re.compile(r"/demo/rapports/[\w-]+/[\w-]+", re.ASCII)
STATIC = re.compile(r"/_next/static/(?:[\w.@~-]+/)*[\w.@~-]+", re.ASCII)
API = re.compile(r"/api/demo/(?:v2/catalog|(?:v2/|v3/)?search|(?:v2/)?listings/[\w-]+)", re.ASCII)


def page_target(value):
    # Only canonical document paths. The query and fragment remain opaque.
    if not value or len(value) > 8192 or not value.startswith("/") or value.startswith("//"):
        return False
    if "\\" in value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        return False
    pathname = urlsplit(value).path
    return pathname in PAGES or bool(REPORT.fullmatch(pathname))


class PrivateLogin(LoginView):
    template_name = "access.html"

    def get_redirect_url(self):
        target = super().get_redirect_url()
        return target if page_target(target) else "/demo"


def check(request):
    if not request.user.is_authenticated:
        return HttpResponse(status=401)
    target = request.headers.get("X-Original-URI", "")
    pathname = target.partition("?")[0]
    permitted = (page_target(target) or API.fullmatch(pathname) or pathname == "/icon.svg"
                 or (STATIC.fullmatch(pathname) and ".." not in pathname and "/./" not in pathname))
    return HttpResponse(status=204 if permitted else 403)


BETA_TARGET = datetime(2027, 1, 13, 11, tzinfo=timezone.utc)
LAUNCH_ASSETS = Path(__file__).resolve().parent / "launch"


@require_http_methods(["GET", "HEAD"])
def launch_asset(request, filename, media_type):
    return FileResponse((LAUNCH_ASSETS / filename).open("rb"), content_type=media_type)


def enter(request):
    target = request.headers.get("X-Original-URI", "")
    if request.method in {"GET", "HEAD"} and target.partition("?")[0] == "/":
        remaining = max(0, int((BETA_TARGET - datetime.now(timezone.utc)).total_seconds()))
        days, rest = divmod(remaining, 86400)
        hours, rest = divmod(rest, 3600)
        minutes, seconds = divmod(rest, 60)
        return render(request, "launch.html", {
            "deadline": BETA_TARGET.isoformat(), "target_day": BETA_TARGET.date(),
            "remaining": remaining, "digits": tuple(f"{n:02}" for n in (days, hours, minutes, seconds)),
        })
    if request.method != "GET" or not page_target(target):
        return HttpResponse(status=401)
    return render(request, "access.html", {"next": target}, status=401)


@require_http_methods(["GET", "POST"])
def leave(request):
    if request.method == "POST":
        logout(request)
        response = render(request, "access.html", {"signed_out": True})
        response.headers["Clear-Site-Data"] = '"cache", "storage"'
        return response
    return render(request, "access.html", {"leave": True})


def csrf_error(request, reason=""):
    return render(request, "access.html", {"expired": True}, status=403)


def clear_storage(request):
    return HttpResponse(
        "try { localStorage.clear(); sessionStorage.clear(); } catch {}"
        "if ('BroadcastChannel' in window) { const c=new BroadcastChannel('aw-private-session');"
        "c.postMessage('logout'); c.close(); }", content_type="application/javascript")


def fragment(request):
    return HttpResponse(
        "const target=document.querySelector('[name=next]');"
        "if(target && location.hash) target.value=target.value.split('#')[0]+location.hash;",
        content_type="application/javascript")


urlpatterns = [
    path("session-check", check),
    path("acces/launch.webp", launch_asset, {"filename": "launch.webp", "media_type": "image/webp"}),
    path("acces/launch.js", launch_asset, {"filename": "launch.js", "media_type": "application/javascript"}),
    path("acces/connexion", PrivateLogin.as_view()),
    path("acces/deconnexion", leave),
    path("acces/fragment.js", fragment),
    path("acces/clear.js", clear_storage),
    re_path(r"^.*$", enter),
]

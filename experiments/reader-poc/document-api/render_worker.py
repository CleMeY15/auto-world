"""Offline, single-job renderer. Its only listener is a Unix-domain socket."""
import contextlib
import ctypes
import http.server
import json
import os
from pathlib import Path
import re
import resource
import signal
import socketserver
import stat
import subprocess
import sys
import tempfile
import time

MAX_INPUT = 512 * 1024
MAX_REQUEST = 6 * MAX_INPUT + 8192
MAX_OUTPUT = 4 * 1024 * 1024
JOB_TIMEOUT = 12
DOC_URL = "https://document.invalid/"
CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
       "img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; "
       "worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; "
       "sandbox allow-scripts")
SYNTHETIC_HEADERS = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": CSP,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), display-capture=()",
}


class RenderIssue(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status = status
        self.code = code


def decode_job(body):
    if len(body) > MAX_REQUEST:
        raise RenderIssue(413, "render_input_too_large")
    try:
        data = json.loads(body)
        if not isinstance(data, dict) or set(data) - {"html", "format", "selector"}:
            raise ValueError
        if not isinstance(data.get("html"), str) or not data["html"].strip():
            raise ValueError
        if len(data["html"].encode("utf-8")) > MAX_INPUT:
            raise RenderIssue(413, "render_input_too_large")
        if data.get("format") not in ("html", "screenshot"):
            raise ValueError
        selector = data.get("selector")
        if selector is not None and (not isinstance(selector, str) or
                                     not re.fullmatch(r"[#.]?[A-Za-z][\w-]{0,80}", selector, re.ASCII)):
            raise ValueError
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise RenderIssue(400, "invalid_render_job") from exc
    return data


def render_document(job):
    from playwright.sync_api import Error, TimeoutError, sync_playwright

    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(
                executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
                headless=True, chromium_sandbox=True, timeout=5000,
                args=["--disable-dev-shm-usage", "--no-first-run", "--disable-background-networking",
                      "--disable-extensions", "--disable-gpu", "--js-flags=--jitless --max-old-space-size=96"],
            )
        except Error as exc:
            raise RenderIssue(503, "renderer_unavailable") from exc
        try:
            ctx = browser.new_context(
                offline=True, accept_downloads=False, service_workers="block",
                viewport={"width": 1024, "height": 768}, device_scale_factor=1, permissions=[],
            )
            page = ctx.new_page()
            ctx.on("page", lambda popup: popup.close())
            page.on("dialog", lambda dialog: dialog.dismiss())
            opened = False

            def serve(route):
                nonlocal opened
                req = route.request
                if (not opened and req.url == DOC_URL and req.is_navigation_request()
                        and req.frame == page.main_frame):
                    opened = True
                    route.fulfill(status=200, headers=SYNTHETIC_HEADERS, body=job["html"].encode("utf-8"))
                else:
                    route.abort()

            ctx.route("**/*", serve)
            ctx.route_web_socket("**/*", lambda ws: ws.close())
            page.goto(DOC_URL, wait_until="domcontentloaded", timeout=3500)
            if job.get("selector"):
                page.locator(job["selector"]).first.wait_for(state="attached", timeout=2000)
            else:
                page.wait_for_timeout(150)
            if job["format"] == "screenshot":
                result = page.screenshot(type="png", full_page=False, timeout=2500)
            else:
                result = page.content().encode("utf-8")
            if len(result) > MAX_OUTPUT:
                raise RenderIssue(413, "render_output_too_large")
            return result
        except TimeoutError as exc:
            raise RenderIssue(504, "render_timeout") from exc
        except Error as exc:
            raise RenderIssue(422, "render_failed") from exc
        finally:
            browser.close()


def child():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (7, 8))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024**2, 16 * 1024**2))
    nofile = min(1024, resource.getrlimit(resource.RLIMIT_NOFILE)[0])
    resource.setrlimit(resource.RLIMIT_NOFILE, (nofile, nofile))
    try:
        job = decode_job(sys.stdin.buffer.read(MAX_REQUEST + 1))
        sys.stdout.buffer.write(render_document(job))
    except RenderIssue as exc:
        sys.stdout.buffer.write(json.dumps({"status": exc.status, "error": exc.code}).encode())
        return 2
    except ImportError:
        return 3
    return 0


def descendants(pid):
    children = []
    for file in Path(f"/proc/{pid}/task").glob("*/children"):
        with contextlib.suppress(OSError):
            children.extend(int(n) for n in file.read_text().split())
    return set(children)


def clear_children():
    # The dedicated, serial worker is a Linux child subreaper. Chromium/Node
    # may start fresh process groups; reparented grandchildren must also exit.
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        active = descendants(os.getpid())
        if not active:
            return
        pending = list(active)
        while pending:
            pid = pending.pop()
            nested = descendants(pid) - active
            active.update(nested)
            pending.extend(nested)
        for pid in active:
            with contextlib.suppress(ProcessLookupError):
                os.kill(pid, signal.SIGKILL)
        while True:
            try:
                if os.waitpid(-1, os.WNOHANG)[0] == 0:
                    break
            except ChildProcessError:
                break
        time.sleep(0.02)
    # An unkillable process invalidates isolation of the next request. The
    # container's init/restart policy owns recovery if the entire worker exits.
    if descendants(os.getpid()):
        os._exit(1)


def run_job(body):
    job = decode_job(body)
    with tempfile.TemporaryDirectory(prefix="reader-job-") as temp:
        with tempfile.TemporaryFile(dir=temp) as src, tempfile.TemporaryFile(dir=temp) as dst:
            src.write(body)
            src.seek(0)
            env = {"HOME": temp, "TMPDIR": temp, "LANG": "C.UTF-8", "PATH": os.defpath,
                   "PYTHONDONTWRITEBYTECODE": "1", "CHROMIUM_PATH": os.getenv("CHROMIUM_PATH", "/usr/bin/chromium")}
            proc = subprocess.Popen([sys.executable, os.path.abspath(__file__), "--child"],
                                    stdin=src, stdout=dst, stderr=subprocess.DEVNULL,
                                    cwd=temp, env=env, start_new_session=True)
            try:
                status = proc.wait(timeout=JOB_TIMEOUT)
            except subprocess.TimeoutExpired as exc:
                proc.kill()
                proc.wait(timeout=1)
                raise RenderIssue(504, "render_timeout") from exc
            finally:
                clear_children()
            dst.seek(0)
            output = dst.read(MAX_OUTPUT + 1)
    if len(output) > MAX_OUTPUT:
        raise RenderIssue(413, "render_output_too_large")
    if status == 2:
        result = json.loads(output)
        raise RenderIssue(result["status"], result["error"])
    if status or not output:
        raise RenderIssue(503, "renderer_unavailable")
    if job["format"] == "screenshot":
        return "image/png", output
    return "text/html; charset=utf-8", output


class RenderHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def handle(self):
        self.connection.settimeout(4)
        super().handle()

    def do_POST(self):
        try:
            if self.path != "/render":
                raise RenderIssue(404, "not_found")
            if self.headers.get_content_type() != "application/json":
                raise RenderIssue(415, "json_required")
            lengths = self.headers.get_all("Content-Length", [])
            if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,10}", lengths[0]):
                raise RenderIssue(400, "invalid_length")
            length = int(lengths[0])
            if length > MAX_REQUEST:
                raise RenderIssue(413, "render_input_too_large")
            body = self.rfile.read(length)
            if len(body) != length:
                raise RenderIssue(400, "truncated_request")
            mime, output = run_job(body)
            status = 200
        except RenderIssue as exc:
            mime, output, status = "application/json", json.dumps({"error": exc.code}).encode(), exc.status
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(output)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(output)


def main():
    # PR_SET_CHILD_SUBREAPER, required so the watchdog also reaps detached descendants.
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "Could not enable child subreaper")
    sock = Path(os.getenv("READER_RENDER_SOCKET", "/sockets/renderer.sock"))
    os.umask(0o077)
    if sock.is_socket():
        sock.unlink()
    with socketserver.UnixStreamServer(str(sock), RenderHandler) as server:
        sock.chmod(stat.S_IRUSR | stat.S_IWUSR)
        try:
            server.serve_forever()
        finally:
            sock.unlink(missing_ok=True)


if __name__ == "__main__":
    if sys.argv[1:] == ["--child"]:
        sys.exit(child())
    main()

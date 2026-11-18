"""Exercise the staged boundary on loopback only, without root or service installation."""
import contextlib
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parents[1]
REPO = HERE.parents[1]


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def stop(child):
    if child.poll() is None:
        child.terminate()
        child.wait(timeout=10)


def wait_for(path, child):
    for _ in range(100):
        if child.poll() is not None:
            raise RuntimeError("Service exited during startup")
        if path.exists():
            return
        time.sleep(.1)
    raise RuntimeError("Service did not start")


with tempfile.TemporaryDirectory(prefix="aw-private-") as directory, contextlib.ExitStack() as cleanup:
    tmp = Path(directory)
    tls_port, http_port = port(), port()
    host = f"localhost:{tls_port}"
    url = f"https://{host}"
    (tmp / "key").write_text(secrets.token_urlsafe(64))
    (tmp / "test_settings.py").write_text("from settings import *\nALLOWED_HOSTS = ['localhost']\n")
    env = {**os.environ, "PRIVATE_WEB_STATE": directory, "DJANGO_SETTINGS_MODULE": "test_settings",
           "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": os.pathsep.join(
               [directory, str(HERE), os.environ.get("PYTHONPATH", "")]),
           "TEST_PASSWORD": secrets.token_urlsafe(32), "TEST_URL": url,
           "PRIVATE_WEB_SOCKET": str(tmp / "web.sock"), "NODE_ENV": "production",
           "AUTO_WORLD_DEMO": "1", "AUTO_WORLD_WEB_BACKEND": "offline",
           "NEXT_PUBLIC_PRIVATE_WEB": "1", "NEXT_TELEMETRY_DISABLED": "1"}

    def run(args, **kwargs):
        return subprocess.run(args, env=env, cwd=HERE, check=True, **kwargs)

    def start(args, cwd):
        child = subprocess.Popen(args, env=env, cwd=cwd)
        cleanup.callback(stop, child)
        return child

    run([sys.executable, "-m", "django", "migrate", "--noinput", "--verbosity", "0"])
    run([sys.executable, "-m", "django", "shell", "-c",
         "import os; from django.contrib.auth.models import User; "
         "User.objects.create_user('invite', password=os.environ['TEST_PASSWORD'])"])
    run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
         "-subj", "/CN=localhost", "-keyout", str(tmp / "privkey"), "-out", str(tmp / "cert")],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    env.update(RUNTIME_DIRECTORY=directory, CREDENTIALS_DIRECTORY=directory)
    run([str(HERE / "render-edge"), "loopback"])
    config = (tmp / "nginx.conf").read_text()
    for public, isolated in {
        "syslog:server=unix:/dev/log,tag=aw-private-edge": str(tmp / "access.log"),
        "listen 127.0.0.1:18080 ": f"listen 127.0.0.1:{http_port} ",
        "listen 127.0.0.1:18443 ": f"listen 127.0.0.1:{tls_port} ",
        "listen [::1]:18080 ": f"listen [::1]:{http_port} ",
        "listen [::1]:18443 ": f"listen [::1]:{tls_port} ",
        "/run/aw-private-auth/auth.sock": str(tmp / "auth.sock"),
        "/run/aw-private-product/web.sock": env["PRIVATE_WEB_SOCKET"],
        "/etc/aw-private-web/fullchain.pem": str(tmp / "cert"),
        str(tmp / "tls-key"): str(tmp / "privkey"),
        "https://autofind.tech": url, "Host autofind.tech": f"Host {host}",
        "autofind.tech": "localhost",
    }.items():
        config = config.replace(public, isolated)
    assert "listen [::]" not in config and "listen 443" not in config and "listen 80" not in config
    (tmp / "nginx.conf").write_text(config)
    auth = start([sys.executable, "-m", "gunicorn", "--bind", f"unix:{tmp}/auth.sock",
                  "--no-control-socket", "wsgi_private:application"], HERE)
    product = start(["node", str(HERE / "product.cjs")], REPO / "apps/web")
    wait_for(tmp / "auth.sock", auth)
    wait_for(tmp / "web.sock", product)
    nginx = os.environ.get("PRIVATE_WEB_NGINX") or shutil.which("nginx")
    run([nginx, "-t", "-p", directory, "-c", str(tmp / "nginx.conf")])
    edge = start([nginx, "-p", directory, "-c", str(tmp / "nginx.conf")], HERE)
    wait_for(tmp / "nginx.pid", edge)
    for address in ["127.0.0.1", "[::1]"]:
        status = run(["curl", "--noproxy", "*", "--resolve", f"localhost:{tls_port}:{address}",
                      "-ksS", "-o", "/dev/null", "-w", "%{http_code}", url + "/demo"],
                     capture_output=True, text=True)
        assert status.stdout == "401", (address, status.stdout)
    for engine in ["chromium", "webkit"]:
        # Each engine gets an independent account/session; no credentials on the command line.
        run(["node", "test/browser.cjs", engine])
    stop(auth)
    closed = run(["curl", "-ksS", "-o", "/dev/null", "-w", "%{http_code}", url + "/demo"],
                 capture_output=True, text=True)
    assert closed.stdout == "500", closed.stdout
    print("PASS: authorization service stopped; product remains inaccessible")

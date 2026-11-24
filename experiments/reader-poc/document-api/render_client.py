"""Send a submitted HTML document to the optional isolated renderer over a Unix socket."""
import http.client
import json
import os
import socket

from documents import ReaderIssue

HTML_LIMIT = 512 * 1024
OUTPUT_LIMIT = 4 * 1024 * 1024


def render_submitted(markup, output_format, selector):
    path = os.getenv("READER_RENDER_SOCKET", "/sockets/renderer.sock")
    payload = json.dumps({"html": markup, "format": output_format, "selector": selector}, ensure_ascii=False).encode()
    try:
        channel = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    except OSError as exc:
        raise ReaderIssue(503, "renderer_unavailable") from exc
    with channel as sock:
        sock.settimeout(30)
        conn = http.client.HTTPConnection("localhost", timeout=30)
        try:
            sock.connect(path)
            conn.auto_open = False
            conn.sock = sock
            conn.request("POST", "/render", body=payload, headers={"Content-Type":"application/json"})
            with conn.getresponse() as response:
                raw = response.read(OUTPUT_LIMIT + 1)
                if len(raw) > OUTPUT_LIMIT:
                    raise ReaderIssue(413, "render_output_too_large")
                if response.status != 200:
                    try:
                        code = json.loads(raw).get("error", "render_failed")
                    except (ValueError, AttributeError):
                        code = "render_failed"
                    raise ReaderIssue(response.status if 400 <= response.status <= 599 else 502, code)
                if output_format == "screenshot" and not raw.startswith(b"\x89PNG\r\n\x1a\n"):
                    raise ReaderIssue(502, "invalid_rendered_image")
                return raw
        except TimeoutError as exc:
            raise ReaderIssue(504, "render_timeout") from exc
        except (OSError, http.client.HTTPException) as exc:
            raise ReaderIssue(503, "renderer_unavailable") from exc
        finally:
            conn.close()

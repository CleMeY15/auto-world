"""Run with /usr/bin/python3 infra/private-web/test/catalog.py."""
import importlib.util
import http.server
import json
import os
from pathlib import Path
import socketserver
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

import django
from django.conf import settings
from django.core.management import call_command
from django.test import Client

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
settings.configure(
    SECRET_KEY="ephemeral-test", ROOT_URLCONF="gateway", ALLOWED_HOSTS=["testserver"],
    INSTALLED_APPS=["django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions"],
    DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}},
    MIDDLEWARE=["django.contrib.sessions.middleware.SessionMiddleware", "django.contrib.auth.middleware.AuthenticationMiddleware"],
    TEMPLATES=[{"BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [HERE / "templates"]}],
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
django.setup()
from django.contrib.auth import get_user_model

spec = importlib.util.spec_from_file_location("preflight", HERE / "catalog_preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class Gateway(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        call_command("migrate", verbosity=0)
        cls.account = get_user_model().objects.create_user("invite", password="only-this-test")

    def check(self, client, path):
        return client.get("/session-check", HTTP_X_ORIGINAL_URI=path).status_code

    @patch.dict(os.environ, {"AUTOFIND_PRIVATE_CATALOG": "1"})
    def test_favorites_scope_requires_an_active_session_and_rotates(self):
        client = Client()
        def probe(path):
            return client.get("/session-check", HTTP_X_ORIGINAL_URI=path, HTTP_X_AW_FAVORITES_SCOPE="spoofed")
        for path in ("/catalogue/favoris", "/catalogue/favoris/lecture"):
            response = probe(path)
            self.assertEqual(response.status_code, 401)
            self.assertNotIn("X-Aw-Favorites-Scope", response)
        client.force_login(self.account)
        scope = probe("/catalogue/favoris")["X-Aw-Favorites-Scope"]
        self.assertRegex(scope, r"^[0-9a-f]{64}$")
        for path in ("/catalogue", "/catalogue/42", "/catalogue/favoris/lecture"):
            self.assertEqual(probe(path)["X-Aw-Favorites-Scope"], scope)
        for path in ("/", "/api/demo/v2/catalog", "/catalogue/favoris/extra"):
            self.assertNotIn("X-Aw-Favorites-Scope", probe(path))
        client.logout()
        client.force_login(self.account)
        self.assertNotEqual(probe("/catalogue/favoris")["X-Aw-Favorites-Scope"], scope)
        with patch.dict(os.environ, {"AUTOFIND_PRIVATE_CATALOG": "0"}):
            self.assertEqual(probe("/catalogue/favoris").status_code, 403)
            self.assertEqual(probe("/catalogue/favoris/lecture").status_code, 403)

    @patch.dict(os.environ, {"AUTOFIND_PRIVATE_CATALOG": "1"})
    def test_authenticated_catalogue_without_fixture_or_internal_endpoints(self):
        client = Client()
        self.assertEqual(client.get("/", HTTP_X_ORIGINAL_URI="/").status_code, 200)
        target = "/catalogue/42?limit=5"
        self.assertEqual(self.check(client, target), 401)
        form = client.get("/entry", HTTP_X_ORIGINAL_URI=target)
        self.assertEqual(form.status_code, 401)
        self.assertIn(target, form.content.decode())
        login = client.post("/acces/connexion", {"username": "invite", "password": "only-this-test", "next": target})
        self.assertEqual(login.url, target)
        for path in ("/", "/demo", "/catalogue", target, "/icon.svg", "/_next/static/chunks/main.js"):
            with self.subTest(path=path):
                self.assertEqual(self.check(client, path), 204)
        for path in ("/api/demo/v2/catalog", "/demo/rapports/123/a", "/internal/catalog", "/catalogue/01",
                     "/catalogue/%2f", "/catalogue/123/extra", "//example.org", "/catalogue/"):
            with self.subTest(path=path):
                self.assertEqual(self.check(client, path), 403)
        self.assertEqual(client.post("/acces/deconnexion").status_code, 200)
        self.assertEqual(self.check(client, target), 401)

    @patch.dict(os.environ, {"AUTOFIND_PRIVATE_CATALOG": "1"})
    def test_login_destination(self):
        for target in ("", "/", "/demo", "https://example.org", "/api/demo/v2/catalog"):
            with self.subTest(target=target):
                client = Client()
                result = client.post("/acces/connexion", {"username": "invite", "password": "only-this-test", "next": target})
                self.assertEqual(result.url, "/catalogue")

    @patch.dict(os.environ, {"AUTOFIND_PRIVATE_CATALOG": "0"})
    def test_rollback_retains_demo(self):
        client = Client()
        client.force_login(self.account)
        self.assertEqual(self.check(client, "/catalogue/42"), 403)
        self.assertEqual(self.check(client, "/api/demo/v2/catalog"), 204)
        self.assertEqual(self.check(client, "/demo/rapports/123/a"), 204)


class Preflight(unittest.TestCase):
    rendered = b'<section data-catalog-dataset="autoworld/leboncoin"></section><a href="/acces/deconnexion">Sortir</a>'

    def probe(self, payload, rendered=None, session=401, api=200):
        replies = [(session, b""), (api, json.dumps(payload).encode()), (200, self.rendered if rendered is None else rendered)]
        with patch.object(preflight, "get", side_effect=replies):
            return preflight.ready("auth", "reader", "product")

    def test_project_and_empty_database(self):
        for items in ([], [{"source_listing_id": "42", "source_label": "Leboncoin"}]):
            self.assertTrue(self.probe({"dataset": "autoworld/leboncoin", "items": items}))

    def test_requests_over_private_socket(self):
        page = self.rendered
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                endpoints = {
                    ("autofind.tech", "/session-check", "/catalogue"): (401, b""),
                    ("localhost", "/internal/catalog?limit=1", None): (200, b'{"dataset":"autoworld/leboncoin","items":[]}'),
                    ("127.0.0.1:3130", "/catalogue?limit=1", None): (200, page),
                }
                status, body = endpoints.get((self.headers["Host"], self.path, self.headers.get("X-Original-URI")), (404, b""))
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "probe.sock")
            with socketserver.UnixStreamServer(path, Handler) as server:
                thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .02})
                thread.start()
                try:
                    self.assertTrue(preflight.ready(path, path, path))
                finally:
                    server.shutdown()
                    thread.join()

    def test_closed_when_fixture_or_unavailable(self):
        valid = {"dataset": "autoworld/leboncoin", "items": []}
        self.assertFalse(self.probe(valid, session=204))
        self.assertFalse(self.probe(valid, api=503))
        self.assertFalse(self.probe({"dataset": "synthetic-description-v2", "items": []}))
        self.assertFalse(self.probe({**valid, "items": [{"source_listing_id": "42", "source_label": "Fixture"}]}))
        self.assertFalse(self.probe({**valid, "items": [{"source_listing_id": "lst_fake", "source_label": "Leboncoin"}]}))
        self.assertFalse(self.probe(valid, rendered=b'<a href="/acces/deconnexion">Sortir</a>Catalogue indisponible'))
        self.assertFalse(self.probe(valid, rendered=b'<div data-catalog-dataset="autoworld/leboncoin"></div>'))


if __name__ == "__main__":
    unittest.main()

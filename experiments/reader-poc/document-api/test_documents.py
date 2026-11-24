import unittest
from unittest.mock import patch

from documents import ReaderIssue, convert


class HtmlTests(unittest.TestCase):
    def test_implicit_body_and_links(self):
        html = '<title>Prix</title><article><p>Voir <a href="/modele">le véhicule</a></p></article>'
        doc = convert(html.encode(), "text/html", "https://example.com/fiches/un")
        self.assertEqual(doc["title"], "Prix")
        self.assertIn("[le véhicule](https://example.com/modele)", doc["content"])

    def test_modes_menu_and_selector(self):
        html = b"<body><nav>Menu</nav><main><h1>Titre</h1><script>SECRET</script><div class='prix'>40 EUR</div></main>"
        self.assertNotIn("Menu", convert(html, "text/html")["content"])
        self.assertIn("Menu", convert(html, "text/html", mode="markdown")["content"])
        self.assertEqual("40 EUR", convert(html, "text/html", selector=".prix", mode="text")["content"])
        self.assertNotIn("SECRET", convert(html, "text/html", mode="html")["content"])
        with self.assertRaises(ReaderIssue):
            convert(html, "text/html", selector="#absent")

    def test_no_dependency_for_text_and_html_only_operations(self):
        with patch("documents.shutil.which",return_value=None):
            self.assertEqual("café", convert(b"caf\xe9", "text/plain; charset=iso-8859-1")["content"])
            self.assertIn("bonjour", convert(b"<p>bonjour</p>", "text/html", mode="html")["content"])
            with self.assertRaises(ReaderIssue) as exc:
                convert(b"<p>bonjour</p>", "text/html")
            self.assertEqual(503, exc.exception.status)

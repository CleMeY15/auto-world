import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

from search_index import SearchIndex


class SearchIndexTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "reader.db"
        self.index = SearchIndex(self.path)
        self.addCleanup(self.index.close)

    def test_rank_accents_query_literals_and_excerpt(self):
        self.index.put({"url": "https://example.org/a", "title": "Essai",
                        "content": "Une boîte de vitesses manuelle."})
        self.index.put({"url": "https://example.org/b", "title": "Boîte manuelle",
                        "description": "Six rapports", "content": "Fiche technique."})
        results = self.index.search('"boite" (MANUELLE)')
        self.assertEqual([row["url"] for row in results],
                         ["https://example.org/b", "https://example.org/a"])
        self.assertEqual(set(results[0]), {"url", "title", "description", "content"})
        self.assertIn("vitesses", results[1]["content"])
        self.assertEqual(self.index.search("boite OR manuelle"), [])
        self.assertEqual(self.index.search(" ) *** ' "), [])
        self.assertEqual(self.index.search(""), [])
        self.assertEqual(self.index.search("ukulele"), [])

    def test_reindex_delete_and_persist_across_connections(self):
        url = "https://example.org/fr"
        self.index.put({"url": url, "title": "Ancienne", "content": "diesel"})
        self.index.put({"url": url, "title": "Nouvelle", "content": "hybride"})
        second = SearchIndex(self.path)
        self.addCleanup(second.close)
        self.assertEqual(second.search("diesel"), [])
        self.assertEqual([row["title"] for row in second.search("hybride")], ["Nouvelle"])
        self.assertTrue(second.delete(url))
        self.assertFalse(second.delete(url))
        self.assertEqual(self.index.search("hybride"), [])

    def test_page_order_and_concurrent_updates(self):
        second = SearchIndex(self.path)
        self.addCleanup(second.close)

        def write(i):
            index = second if i % 2 else self.index
            index.put({"url": f"https://example.org/{i:02}", "title": "Annonce"})
            self.assertTrue(index.search("annonce", limit=1))

        with ThreadPoolExecutor(max_workers=8) as workers:
            list(workers.map(write, range(40)))
        some = self.index.search("annonce", limit=3, offset=17)
        self.assertEqual([r["url"].split("/")[-1] for r in some], ["17", "18", "19"])
        self.assertEqual(second.search("annonce", offset=40), [])

    def test_invalid_inputs(self):
        for options in ({"limit": 0}, {"limit": 101}, {"offset": -1}, {"limit": True}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.index.search("abc", **options)
        for query in ("a" * 513, "a " * 33):
            with self.assertRaises(ValueError):
                self.index.search(query)
        for doc in ({}, {"url": " "}, {"url": "abc", "content": 8}):
            with self.assertRaises(ValueError):
                self.index.put(doc)

    def test_workers_can_start_on_the_same_new_database(self):
        path = Path(self.tmp.name) / "new.db"
        ready = Barrier(8)

        def start(i):
            ready.wait()
            index = SearchIndex(path)
            try:
                index.put({"url": f"https://example.org/{i}", "title": "Document"})
            finally:
                index.close()

        with ThreadPoolExecutor(max_workers=8) as workers:
            list(workers.map(start, range(8)))
        index = SearchIndex(path)
        self.addCleanup(index.close)
        self.assertEqual(len(index.search("document")), 8)


if __name__ == "__main__":
    unittest.main()

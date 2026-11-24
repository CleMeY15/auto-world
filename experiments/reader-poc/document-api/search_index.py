"""Persistent ranked search over documents already read by the local service."""

import re
import sqlite3
import threading
import unicodedata


class SearchIndex:
    """An SQLite FTS5 index that can be shared by request-handler threads."""

    def __init__(self, path):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, timeout=10, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        try:
            self._db.executescript("""
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS documents (
                    id INTEGER PRIMARY KEY,
                    url TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    content TEXT NOT NULL
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS document_terms USING fts5(
                    url, title, description, content,
                    content=documents, content_rowid=id,
                    tokenize='unicode61 remove_diacritics 2'
                );
                CREATE TRIGGER IF NOT EXISTS documents_insert
                AFTER INSERT ON documents BEGIN
                    INSERT INTO document_terms (rowid, url, title, description, content)
                    VALUES (new.id, new.url, new.title, new.description, new.content);
                END;
                CREATE TRIGGER IF NOT EXISTS documents_delete
                AFTER DELETE ON documents BEGIN
                    INSERT INTO document_terms
                        (document_terms, rowid, url, title, description, content)
                    VALUES ('delete', old.id, old.url, old.title, old.description, old.content);
                END;
                CREATE TRIGGER IF NOT EXISTS documents_update
                AFTER UPDATE ON documents BEGIN
                    INSERT INTO document_terms
                        (document_terms, rowid, url, title, description, content)
                    VALUES ('delete', old.id, old.url, old.title, old.description, old.content);
                    INSERT INTO document_terms (rowid, url, title, description, content)
                    VALUES (new.id, new.url, new.title, new.description, new.content);
                END;
                COMMIT;
            """)
        except BaseException:
            self._db.close()
            raise

    def put(self, document):
        """Insert a document, or replace the searchable text for its exact URL."""
        url = document.get("url")
        if not isinstance(url, str) or not url.strip():
            raise ValueError("A nonempty URL is required")
        fields = [document.get(field, "") for field in ("title", "description", "content")]
        if any(not isinstance(field, str) for field in fields):
            raise ValueError("Document text fields must be strings")
        with self._lock, self._db:
            self._db.execute("""
                INSERT INTO documents (url, title, description, content)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET title=excluded.title,
                    description=excluded.description, content=excluded.content
                WHERE title != excluded.title OR description != excluded.description
                    OR content != excluded.content
            """, (url, *fields))

    def search(self, query, limit=10, offset=0):
        """Find all literal terms, ordered by relevance and then stable URL."""
        if type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("limit must be an integer between 1 and 100")
        if type(offset) is not int or not 0 <= offset <= 2**63 - 1:
            raise ValueError("offset must be a nonnegative SQLite integer")
        if not isinstance(query, str) or len(query) > 512:
            raise ValueError("query must be text of at most 512 characters")
        words = re.findall(r"[^\W_]+", unicodedata.normalize("NFC", query))
        if not words:
            return []
        if len(words) > 32:
            raise ValueError("query must contain at most 32 search terms")
        # Quoting each term makes FTS operators (including OR/NOT) literal.
        expression = " AND ".join(f'"{word}"' for word in words)
        with self._lock:
            rows = self._db.execute("""
                SELECT url, title, description,
                    substr(snippet(document_terms, 3, '', '', ' … ', 24), 1, 1200) AS content
                FROM document_terms WHERE document_terms MATCH ?
                ORDER BY bm25(document_terms, 0.5, 8.0, 3.0, 1.0), url
                LIMIT ? OFFSET ?
            """, (expression, limit, offset)).fetchall()
        return [dict(row) for row in rows]

    def delete(self, url):
        """Delete one exact URL and return whether it existed."""
        with self._lock, self._db:
            return self._db.execute("DELETE FROM documents WHERE url = ?", (url,)).rowcount > 0

    def close(self):
        with self._lock:
            self._db.close()

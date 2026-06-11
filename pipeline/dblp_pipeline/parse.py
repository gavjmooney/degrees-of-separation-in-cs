"""Stage 1: stream-parse dblp.xml(.gz) into staging.sqlite.

The staging database is a checkpoint: parsing the ~4.6GB XML takes ~20 minutes,
after which all Stage 2 builds (graph construction, metadata, search index)
iterate on staging.sqlite in minutes without touching the XML again.
"""

from __future__ import annotations

import gzip
import sqlite3
import sys
import time
from pathlib import Path

from lxml import etree

from . import config

BATCH_SIZE = 50_000
PROGRESS_EVERY = 500_000

STAGING_SCHEMA = """
CREATE TABLE names (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE pubs (
    id      INTEGER PRIMARY KEY,
    key     TEXT NOT NULL UNIQUE,
    type    TEXT NOT NULL,
    publtype TEXT,
    title   TEXT,
    year    INTEGER,
    venue   TEXT
);
CREATE TABLE pub_authors (
    pub_id  INTEGER NOT NULL,
    pos     INTEGER NOT NULL,
    name_id INTEGER NOT NULL
);
CREATE TABLE persons (
    key         TEXT PRIMARY KEY,
    is_disambig INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE TABLE person_names (
    person_key TEXT NOT NULL,
    pos        INTEGER NOT NULL,
    name_id    INTEGER NOT NULL
);
"""


class _DtdResolver(etree.Resolver):
    """Resolve the relative `dblp.dtd` SYSTEM id to a local file regardless of cwd."""

    def __init__(self, dtd_path: Path):
        self._dtd_path = str(dtd_path)

    def resolve(self, system_url, public_id, context):
        if system_url and system_url.endswith("dblp.dtd"):
            return self.resolve_filename(self._dtd_path, context)
        return None


def _element_text(elem: etree._Element) -> str:
    """Full text content with nested markup (<i>, <sub>, ...) flattened."""
    return "".join(elem.itertext()).strip()


def _open_source(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rb")
    return open(path, "rb")


class StagingWriter:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        if db_path.exists():
            db_path.unlink()
        self.conn = sqlite3.connect(db_path)
        self.conn.executescript("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;")
        self.conn.executescript(STAGING_SCHEMA)
        self._name_ids: dict[str, int] = {}
        self._pub_rows: list[tuple] = []
        self._pub_author_rows: list[tuple] = []
        self._person_rows: list[tuple] = []
        self._person_name_rows: list[tuple] = []
        self._next_pub_id = 0

    def intern_name(self, name: str) -> int:
        name_id = self._name_ids.get(name)
        if name_id is None:
            name_id = len(self._name_ids)
            self._name_ids[name] = name_id
        return name_id

    def add_pub(self, key: str, type_: str, publtype: str | None, title: str | None,
                year: int | None, venue: str | None, author_names: list[str]) -> None:
        pub_id = self._next_pub_id
        self._next_pub_id += 1
        self._pub_rows.append((pub_id, key, type_, publtype, title, year, venue))
        for pos, name in enumerate(author_names):
            self._pub_author_rows.append((pub_id, pos, self.intern_name(name)))
        if len(self._pub_rows) >= BATCH_SIZE:
            self._flush_pubs()

    def add_person(self, key: str, is_disambig: bool, names: list[str]) -> None:
        self._person_rows.append((key, int(is_disambig)))
        for pos, name in enumerate(names):
            self._person_name_rows.append((key, pos, self.intern_name(name)))
        if len(self._person_rows) >= BATCH_SIZE:
            self._flush_persons()

    def _flush_pubs(self) -> None:
        self.conn.executemany("INSERT INTO pubs VALUES (?,?,?,?,?,?,?)", self._pub_rows)
        self.conn.executemany("INSERT INTO pub_authors VALUES (?,?,?)", self._pub_author_rows)
        self.conn.commit()
        self._pub_rows.clear()
        self._pub_author_rows.clear()

    def _flush_persons(self) -> None:
        self.conn.executemany(
            "INSERT OR REPLACE INTO persons VALUES (?,?)", self._person_rows
        )
        self.conn.executemany("INSERT INTO person_names VALUES (?,?,?)", self._person_name_rows)
        self.conn.commit()
        self._person_rows.clear()
        self._person_name_rows.clear()

    def finish(self) -> dict[str, int]:
        self._flush_pubs()
        self._flush_persons()
        self.conn.executemany(
            "INSERT INTO names (id, name) VALUES (?,?)",
            ((nid, name) for name, nid in self._name_ids.items()),
        )
        self.conn.commit()
        self.conn.execute("CREATE INDEX idx_pub_authors_pub ON pub_authors(pub_id)")
        self.conn.execute("CREATE INDEX idx_pub_authors_name ON pub_authors(name_id)")
        self.conn.execute("CREATE INDEX idx_person_names_key ON person_names(person_key)")
        self.conn.execute("CREATE INDEX idx_person_names_name ON person_names(name_id)")
        self.conn.commit()
        counts = {
            "pubs": self._next_pub_id,
            "persons": self.conn.execute("SELECT COUNT(*) FROM persons").fetchone()[0],
            "names": len(self._name_ids),
        }
        self.conn.close()
        return counts


def parse_dblp(input_path: Path, dtd_path: Path, db_path: Path,
               limit: int | None = None, log=print) -> dict[str, int]:
    """Parse the DBLP XML into staging.sqlite. Returns record counts."""
    writer = StagingWriter(db_path)
    record_tags = sorted(config.PUBLICATION_TYPES | {"www"})
    started = time.time()
    n_records = 0

    with _open_source(input_path) as source:
        context = etree.iterparse(
            source,
            events=("end",),
            tag=record_tags,
            load_dtd=True,
            resolve_entities=True,
            huge_tree=True,
        )
        context.resolvers.add(_DtdResolver(dtd_path))

        for _, elem in context:
            tag = elem.tag
            if tag == "www":
                key = elem.get("key") or ""
                if key.startswith("homepages/"):
                    names = [_element_text(a) for a in elem.iter("author")]
                    names = [n for n in names if n]
                    if names:
                        writer.add_person(key, elem.get("publtype") == "disambiguation", names)
            else:
                key = elem.get("key")
                if key:
                    authors = [_element_text(a) for a in elem.iter("author")]
                    authors = [a for a in authors if a]
                    title_elem = elem.find("title")
                    title = _element_text(title_elem) if title_elem is not None else None
                    year_elem = elem.find("year")
                    year = None
                    if year_elem is not None and year_elem.text and year_elem.text.strip().isdigit():
                        year = int(year_elem.text.strip())
                    venue_elem = elem.find("journal")
                    if venue_elem is None:
                        venue_elem = elem.find("booktitle")
                    venue = _element_text(venue_elem) if venue_elem is not None else None
                    writer.add_pub(key, tag, elem.get("publtype"), title, year, venue, authors)

            # Free parsed content: clear this record and drop earlier siblings,
            # otherwise the in-memory tree grows to the full 4.6GB document.
            elem.clear()
            parent = elem.getparent()
            if parent is not None:
                while elem.getprevious() is not None:
                    del parent[0]

            n_records += 1
            if n_records % PROGRESS_EVERY == 0:
                log(f"  parsed {n_records:,} records ({time.time() - started:.0f}s)")
            if limit is not None and n_records >= limit:
                break

    counts = writer.finish()
    counts["records"] = n_records
    counts["seconds"] = round(time.time() - started, 1)
    log(f"Stage 1 done: {counts}")
    return counts


def main(argv: list[str] | None = None) -> None:
    import argparse

    ap = argparse.ArgumentParser(description="Stage 1: DBLP XML -> staging.sqlite")
    ap.add_argument("--input", type=Path, default=config.DBLP_XML_GZ)
    ap.add_argument("--dtd", type=Path, default=config.DBLP_DTD)
    ap.add_argument("--output", type=Path, default=config.STAGING_DB)
    ap.add_argument("--limit", type=int, default=None, help="stop after N records (smoke tests)")
    args = ap.parse_args(argv)
    parse_dblp(args.input, args.dtd, args.output, args.limit)


if __name__ == "__main__":
    main(sys.argv[1:])

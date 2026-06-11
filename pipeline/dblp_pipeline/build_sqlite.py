"""Stage 2c: build dblp.sqlite — author/paper metadata, the bipartite
author-paper graph, and the FTS5 autocomplete index."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np

from .build_authors import AuthorIndex

FINAL_SCHEMA = """
CREATE TABLE authors (
    id          INTEGER PRIMARY KEY,   -- == CSR node id
    dblp_key    TEXT,                  -- homepages/... or NULL for orphan names
    name        TEXT NOT NULL,
    is_disambig INTEGER NOT NULL DEFAULT 0,
    pub_count   INTEGER NOT NULL DEFAULT 0,
    first_year  INTEGER,
    last_year   INTEGER,
    top_venues  TEXT                   -- JSON array of up to 3 venue names
);
CREATE TABLE author_aliases (
    author_id INTEGER NOT NULL,
    alias     TEXT NOT NULL
);
CREATE INDEX idx_aliases_author ON author_aliases(author_id);
CREATE TABLE papers (
    id        INTEGER PRIMARY KEY,     -- == staging pub id
    dblp_key  TEXT NOT NULL UNIQUE,
    type      TEXT NOT NULL,
    informal  INTEGER NOT NULL DEFAULT 0,
    title     TEXT,
    year      INTEGER,
    venue     TEXT,
    n_authors INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE paper_authors (
    author_id INTEGER NOT NULL,
    paper_id  INTEGER NOT NULL,
    pos       INTEGER NOT NULL,
    PRIMARY KEY (author_id, paper_id)
) WITHOUT ROWID;
CREATE INDEX idx_pa_paper ON paper_authors(paper_id);
CREATE VIRTUAL TABLE author_fts USING fts5(
    norm_name,
    author_id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3 4'
);
"""


def build_final_sqlite(staging_path: Path, out_path: Path, index: AuthorIndex,
                       included_pub_ids: np.ndarray, log=print) -> dict:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()
    conn = sqlite3.connect(out_path)
    conn.executescript(
        "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-524288;"
    )
    conn.execute("ATTACH DATABASE ? AS stg", (str(staging_path),))
    conn.executescript(FINAL_SCHEMA)

    log("  sqlite: temp mapping tables")
    conn.execute("CREATE TEMP TABLE included_pubs (id INTEGER PRIMARY KEY)")
    conn.executemany(
        "INSERT INTO included_pubs VALUES (?)", ((int(i),) for i in included_pub_ids)
    )
    conn.execute(
        "CREATE TEMP TABLE name_author (name_id INTEGER PRIMARY KEY, author_id INTEGER)"
    )
    nta = index.name_to_author
    conn.executemany(
        "INSERT INTO name_author VALUES (?,?)",
        ((int(nid), int(aid)) for nid, aid in enumerate(nta) if aid >= 0),
    )
    conn.execute(
        "CREATE TEMP TABLE person_author (key TEXT PRIMARY KEY, author_id INTEGER)"
    )
    conn.executemany(
        "INSERT INTO person_author VALUES (?,?)",
        ((key, aid) for aid, key in enumerate(index.dblp_keys) if key is not None),
    )
    conn.commit()

    log("  sqlite: paper_authors (bipartite graph)")
    conn.execute(
        """INSERT OR IGNORE INTO paper_authors (author_id, paper_id, pos)
           SELECT na.author_id, pa.pub_id, pa.pos
           FROM stg.pub_authors pa
           JOIN name_author na ON na.name_id = pa.name_id
           JOIN included_pubs i ON i.id = pa.pub_id
           ORDER BY na.author_id, pa.pub_id, pa.pos"""
    )

    log("  sqlite: papers")
    conn.execute(
        """INSERT INTO papers (id, dblp_key, type, informal, title, year, venue, n_authors)
           SELECT p.id, p.key, p.type,
                  CASE WHEN p.publtype = 'informal' THEN 1 ELSE 0 END,
                  p.title, p.year, p.venue,
                  COALESCE(c.n, 0)
           FROM stg.pubs p
           JOIN included_pubs i ON i.id = p.id
           LEFT JOIN (SELECT paper_id, COUNT(*) n FROM paper_authors GROUP BY paper_id) c
                  ON c.paper_id = p.id"""
    )

    log("  sqlite: authors")
    conn.executemany(
        "INSERT INTO authors (id, dblp_key, name, is_disambig) VALUES (?,?,?,?)",
        (
            (aid, index.dblp_keys[aid], index.primary_names[aid], int(index.is_disambig[aid]))
            for aid in range(index.author_count)
        ),
    )
    conn.execute(
        """CREATE TEMP TABLE astats AS
           SELECT pa.author_id AS a, COUNT(*) AS c, MIN(p.year) AS fy, MAX(p.year) AS ly
           FROM paper_authors pa JOIN papers p ON p.id = pa.paper_id
           GROUP BY pa.author_id"""
    )
    conn.execute(
        """UPDATE authors SET pub_count = s.c, first_year = s.fy, last_year = s.ly
           FROM astats s WHERE s.a = authors.id"""
    )

    log("  sqlite: top venues")
    conn.execute(
        """CREATE TEMP TABLE tvenues AS
           SELECT a, json_group_array(v) AS j FROM (
               SELECT pa.author_id AS a, p.venue AS v,
                      ROW_NUMBER() OVER (
                          PARTITION BY pa.author_id ORDER BY COUNT(*) DESC, p.venue
                      ) AS rn
               FROM paper_authors pa JOIN papers p ON p.id = pa.paper_id
               WHERE p.venue IS NOT NULL
               GROUP BY pa.author_id, p.venue
           ) WHERE rn <= 3 GROUP BY a"""
    )
    conn.execute(
        "UPDATE authors SET top_venues = t.j FROM tvenues t WHERE t.a = authors.id"
    )

    log("  sqlite: aliases + search index")
    conn.execute(
        """INSERT INTO author_aliases (author_id, alias)
           SELECT pa.author_id, n.name
           FROM stg.person_names pn
           JOIN person_author pa ON pa.key = pn.person_key
           JOIN stg.names n ON n.id = pn.name_id
           WHERE pn.pos > 0"""
    )
    conn.execute(
        """INSERT INTO author_fts (norm_name, author_id)
           SELECT name, id FROM authors
           UNION ALL
           SELECT alias, author_id FROM author_aliases"""
    )
    conn.commit()

    counts = {
        "authors": conn.execute("SELECT COUNT(*) FROM authors").fetchone()[0],
        "papers": conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0],
        "paper_author_rows": conn.execute("SELECT COUNT(*) FROM paper_authors").fetchone()[0],
    }
    conn.execute("ANALYZE")
    conn.commit()
    conn.close()
    log(f"  sqlite: {counts}")
    return counts

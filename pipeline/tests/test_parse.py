import sqlite3
from pathlib import Path

import pytest

from dblp_pipeline.parse import parse_dblp

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def staging(tmp_path_factory):
    db_path = tmp_path_factory.mktemp("staging") / "staging.sqlite"
    parse_dblp(FIXTURES / "mini_dblp.xml", FIXTURES / "dblp.dtd", db_path, log=lambda *_: None)
    conn = sqlite3.connect(db_path)
    yield conn
    conn.close()


def _pub_authors(conn, key):
    return [
        r[0]
        for r in conn.execute(
            """SELECT n.name FROM pubs p
               JOIN pub_authors pa ON pa.pub_id = p.id
               JOIN names n ON n.id = pa.name_id
               WHERE p.key = ? ORDER BY pa.pos""",
            (key,),
        )
    ]


def test_pub_counts(staging):
    # 10 publications; <proceedings> and <www> records are not pubs
    assert staging.execute("SELECT COUNT(*) FROM pubs").fetchone()[0] == 10
    assert staging.execute(
        "SELECT COUNT(*) FROM pubs WHERE type='proceedings'"
    ).fetchone()[0] == 0


def test_entity_resolution(staging):
    authors = _pub_authors(staging, "journals/x/DijkstraS18")
    assert authors == ["Dave Dijkstra", "Jürgen Schmidhuber"]


def test_nested_title_markup_flattened(staging):
    title = staging.execute(
        "SELECT title FROM pubs WHERE key='journals/x/AardvarkB20'"
    ).fetchone()[0]
    assert title == "A Fancy Title on Graphs."


def test_venue_and_year(staging):
    row = staging.execute(
        "SELECT venue, year, publtype FROM pubs WHERE key='journals/corr/abs-2201-00001'"
    ).fetchone()
    assert row == ("CoRR", 2022, "informal")
    row = staging.execute(
        "SELECT venue FROM pubs WHERE key='conf/y/AardvarkB21'"
    ).fetchone()
    assert row[0] == "CONF"


def test_homonyms_are_distinct_names(staging):
    names = {
        r[0]
        for r in staging.execute(
            "SELECT name FROM names WHERE name LIKE 'Wei Wang%'"
        )
    }
    assert names == {"Wei Wang", "Wei Wang 0001", "Wei Wang 0002"}


def test_person_records(staging):
    # 4 homepages records; the non-homepages www record is skipped
    assert staging.execute("SELECT COUNT(*) FROM persons").fetchone()[0] == 4
    aliases = [
        r[0]
        for r in staging.execute(
            """SELECT n.name FROM person_names pn JOIN names n ON n.id = pn.name_id
               WHERE pn.person_key = 'homepages/a/AliceAardvark' ORDER BY pn.pos"""
        )
    ]
    assert aliases == ["Alice Aardvark", "A. Aardvark"]


def test_disambiguation_flag(staging):
    rows = dict(staging.execute("SELECT key, is_disambig FROM persons"))
    assert rows["homepages/w/WeiWang"] == 1
    assert rows["homepages/w/WeiWang1"] == 0


def test_author_order_preserved(staging):
    assert _pub_authors(staging, "journals/x/WangE16") == ["Wei Wang 0002", "Eve Evans"]


def test_limit_flag(tmp_path):
    db_path = tmp_path / "limited.sqlite"
    counts = parse_dblp(
        FIXTURES / "mini_dblp.xml", FIXTURES / "dblp.dtd", db_path,
        limit=3, log=lambda *_: None,
    )
    assert counts["records"] == 3

import json
import sqlite3
from pathlib import Path

import pytest

from dblp_pipeline.build import build_artifacts
from dblp_pipeline.csr_format import read_csr
from dblp_pipeline.parse import parse_dblp
from dblp_pipeline.validate import validate_artifacts

FIXTURES = Path(__file__).parent / "fixtures"
QUIET = lambda *_: None  # noqa: E731


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    root = tmp_path_factory.mktemp("build")
    staging = root / "staging.sqlite"
    out = root / "artifacts"
    parse_dblp(FIXTURES / "mini_dblp.xml", FIXTURES / "dblp.dtd", staging, log=QUIET)
    build_artifacts(staging, out, max_clique_authors=5, log=QUIET)
    conn = sqlite3.connect(out / "dblp.sqlite")
    yield out, conn
    conn.close()


def _author_id(conn, name):
    return conn.execute("SELECT id FROM authors WHERE name = ?", (name,)).fetchone()[0]


def _weight(graph, conn, a_name, b_name):
    a, b = _author_id(conn, a_name), _author_id(conn, b_name)
    nbrs, weights = graph.neighbors_of(a)
    for u, w in zip(nbrs, weights):
        if u == b:
            return int(w)
    return 0


def test_validation_passes(built):
    out, _ = built
    validate_artifacts(out, log=QUIET)


def test_coauthor_weights(built):
    out, conn = built
    graph = read_csr(out / "coauthor.csr")
    assert _weight(graph, conn, "Alice Aardvark", "Bob Builder") == 2
    assert _weight(graph, conn, "Bob Builder", "Carol Chen") == 1
    assert _weight(graph, conn, "Alice Aardvark", "Carol Chen") == 0
    # entity-resolved author participates in the graph
    assert _weight(graph, conn, "Dave Dijkstra", "Jürgen Schmidhuber") == 1


def test_homonyms_are_separate_nodes(built):
    out, conn = built
    graph = read_csr(out / "coauthor.csr")
    w1 = _author_id(conn, "Wei Wang 0001")
    w2 = _author_id(conn, "Wei Wang 0002")
    assert w1 != w2
    assert len(graph.neighbors_of(w1)[0]) == 0  # solo author: no co-authors
    assert _weight(graph, conn, "Wei Wang 0002", "Eve Evans") == 1


def test_disambiguation_profile_in_graph_and_badged(built):
    out, conn = built
    graph = read_csr(out / "coauthor.csr")
    row = conn.execute(
        "SELECT id, is_disambig FROM authors WHERE name = 'Wei Wang'"
    ).fetchone()
    assert row[1] == 1
    assert _weight(graph, conn, "Wei Wang", "Eve Evans") == 1


def test_clique_cap_skips_big_paper(built):
    out, conn = built
    graph = read_csr(out / "coauthor.csr")
    meta = json.loads((out / "meta.json").read_text())
    assert meta["graph"]["papers_over_clique_cap"] == 1
    big = _author_id(conn, "Big AuthorA")
    assert len(graph.neighbors_of(big)[0]) == 0
    # ...but the paper is still in metadata with its authors
    n = conn.execute(
        "SELECT n_authors FROM papers WHERE dblp_key = 'conf/big/Collab24'"
    ).fetchone()[0]
    assert n == 6


def test_author_stats_and_aliases(built):
    _, conn = built
    row = conn.execute(
        "SELECT pub_count, first_year, last_year, dblp_key FROM authors WHERE name = 'Alice Aardvark'"
    ).fetchone()
    assert row == (2, 2020, 2021, "homepages/a/AliceAardvark")
    aliases = [r[0] for r in conn.execute(
        "SELECT alias FROM author_aliases WHERE author_id = ?",
        (_author_id(conn, "Alice Aardvark"),))]
    assert aliases == ["A. Aardvark"]


def test_fts_search_with_diacritics_and_alias(built):
    _, conn = built
    hits = {r[0] for r in conn.execute(
        "SELECT author_id FROM author_fts WHERE author_fts MATCH 'jurgen*'")}
    assert _author_id(conn, "Jürgen Schmidhuber") in hits
    hits = {r[0] for r in conn.execute(
        "SELECT author_id FROM author_fts WHERE author_fts MATCH 'aardvark'")}
    assert _author_id(conn, "Alice Aardvark") in hits


def test_year_filter(built, tmp_path):
    out, _ = built
    staging = out.parent / "staging.sqlite"
    dev_out = tmp_path / "dev"
    build_artifacts(staging, dev_out, year_range=(2020, 2026),
                    max_clique_authors=5, log=QUIET)
    conn = sqlite3.connect(dev_out / "dblp.sqlite")
    years = [r[0] for r in conn.execute("SELECT DISTINCT year FROM papers")]
    assert all(2020 <= y <= 2026 for y in years)
    # Carol's only 2020+ paper is the 2022 preprint with Dave
    graph = read_csr(dev_out / "coauthor.csr")
    assert _weight(graph, conn, "Carol Chen", "Dave Dijkstra") == 1
    assert conn.execute(
        "SELECT COUNT(*) FROM authors WHERE name = 'Wei Wang 0001'"
    ).fetchone()[0] == 0  # 2015-only author excluded entirely
    conn.close()
    validate_artifacts(dev_out, log=QUIET)


def test_exclude_informal(built, tmp_path):
    out, conn0 = built
    staging = out.parent / "staging.sqlite"
    dev_out = tmp_path / "noinformal"
    build_artifacts(staging, dev_out, exclude_informal=True,
                    max_clique_authors=5, log=QUIET)
    conn = sqlite3.connect(dev_out / "dblp.sqlite")
    assert conn.execute("SELECT COUNT(*) FROM papers WHERE informal = 1").fetchone()[0] == 0
    graph = read_csr(dev_out / "coauthor.csr")
    assert _weight(graph, conn, "Carol Chen", "Dave Dijkstra") == 0
    conn.close()

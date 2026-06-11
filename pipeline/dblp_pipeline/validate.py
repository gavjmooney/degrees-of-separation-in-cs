"""Validate built artifacts: CSR structural invariants and cross-checks
against the SQLite metadata."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import numpy as np

from .csr_format import read_csr


def validate_artifacts(artifacts_dir: Path, spot_checks: int = 100, log=print) -> None:
    csr_path = artifacts_dir / "coauthor.csr"
    db_path = artifacts_dir / "dblp.sqlite"
    meta = json.loads((artifacts_dir / "meta.json").read_text())
    graph = read_csr(csr_path)
    conn = sqlite3.connect(db_path)
    n, m = graph.node_count, graph.edge_entry_count
    max_clique = meta["graph"]["max_clique_authors"]

    def check(cond: bool, msg: str) -> None:
        if not cond:
            raise AssertionError(f"validation failed: {msg}")
        log(f"  ok: {msg}")

    check(n == meta["graph"]["nodes"], f"node count matches meta ({n:,})")
    check(int(graph.offsets[0]) == 0 and int(graph.offsets[-1]) == m,
          "offsets span [0, M]")
    check(bool(np.all(np.diff(graph.offsets.astype(np.int64)) >= 0)),
          "offsets monotonic")

    src = np.repeat(np.arange(n, dtype=np.uint64),
                    np.diff(graph.offsets).astype(np.int64))
    dst = graph.neighbors.astype(np.uint64)
    check(bool(np.all(src != dst)), "no self-loops")
    boundary = np.zeros(m, dtype=bool)
    starts = graph.offsets[1:-1].astype(np.int64)
    boundary[starts[starts < m]] = True  # offsets == M belong to empty trailing slices
    if m > 1:
        nondesc = (dst[1:] > dst[:-1]) | boundary[1:]
        check(bool(np.all(nondesc)), "neighbor slices strictly sorted")

    fwd = (src << np.uint64(32)) | dst
    rev = (dst << np.uint64(32)) | src
    fwd_order = np.argsort(fwd, kind="stable")
    rev_order = np.argsort(rev, kind="stable")
    check(bool(np.array_equal(fwd[fwd_order], rev[rev_order])),
          "graph is symmetric")
    check(bool(np.array_equal(graph.weights[fwd_order], graph.weights[rev_order])),
          "weights are symmetric")
    del src, dst, fwd, rev, fwd_order, rev_order

    db_authors = conn.execute("SELECT COUNT(*) FROM authors").fetchone()[0]
    check(db_authors == n, f"sqlite author count == CSR nodes ({n:,})")
    max_id = conn.execute("SELECT MAX(id) FROM authors").fetchone()[0]
    check(max_id == n - 1, "author ids dense 0..N-1")

    # Spot-check: CSR neighbors/weights of random authors equal the SQLite
    # bipartite graph's co-author counts (papers within the clique cap).
    rng = np.random.default_rng(42)
    sample = rng.integers(0, n, size=min(spot_checks, n))
    for aid in sample:
        aid = int(aid)
        rows = conn.execute(
            """SELECT pb.author_id, COUNT(*) FROM paper_authors pa
               JOIN papers p ON p.id = pa.paper_id
               JOIN paper_authors pb ON pb.paper_id = pa.paper_id
               WHERE pa.author_id = ? AND pb.author_id != ?
                 AND p.n_authors BETWEEN 2 AND ?
               GROUP BY pb.author_id ORDER BY pb.author_id""",
            (aid, aid, max_clique),
        ).fetchall()
        nbrs, weights = graph.neighbors_of(aid)
        expected = [(int(u), min(int(w), 65535)) for u, w in zip(nbrs, weights)]
        actual = [(u, min(c, 65535)) for u, c in rows]
        if expected != actual:
            raise AssertionError(
                f"validation failed: author {aid} CSR adjacency != sqlite bipartite "
                f"(csr {len(expected)} nbrs, sqlite {len(actual)})"
            )
    log(f"  ok: {len(sample)} spot-checked authors match bipartite graph")

    fts = conn.execute(
        "SELECT COUNT(*) FROM author_fts WHERE author_fts MATCH 'a*'"
    ).fetchone()[0]
    check(fts > 0, "FTS index answers prefix queries")
    conn.close()
    log("validation passed")


def main(argv=None) -> None:
    import argparse
    from . import config

    ap = argparse.ArgumentParser(description="Validate built artifacts")
    ap.add_argument("--artifacts", type=Path, default=config.ARTIFACTS_DIR)
    args = ap.parse_args(argv)
    validate_artifacts(args.artifacts)


if __name__ == "__main__":
    main()

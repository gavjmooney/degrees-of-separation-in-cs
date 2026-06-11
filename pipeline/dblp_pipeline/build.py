"""Stage 2 orchestrator: staging.sqlite -> artifacts (coauthor.csr, dblp.sqlite, meta.json).

Dev-subset builds use --filter-years / --filter-sample to produce small
artifacts from the full staging DB in minutes, without re-parsing the XML.
"""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import date
from pathlib import Path

import numpy as np

from . import config
from .build_authors import build_author_index
from .build_graph import build_coauthor_csr
from .build_sqlite import build_final_sqlite
from .csr_format import write_csr

# Knuth multiplicative hash for deterministic pseudo-random paper sampling.
_HASH_MULT = 2654435761


def compute_included_pubs(conn: sqlite3.Connection, year_range: tuple[int, int] | None,
                          sample: float | None, exclude_informal: bool,
                          log=print) -> np.ndarray:
    """Boolean mask over staging pub ids (dense 0..P-1)."""
    n_pubs = (conn.execute("SELECT MAX(id) FROM pubs").fetchone()[0] or -1) + 1
    mask = np.ones(n_pubs, dtype=bool)
    if year_range is not None:
        years = np.full(n_pubs, -1, dtype=np.int32)
        for pid, year in conn.execute("SELECT id, year FROM pubs WHERE year IS NOT NULL"):
            years[pid] = year
        mask &= (years >= year_range[0]) & (years <= year_range[1])
    if exclude_informal:
        for (pid,) in conn.execute("SELECT id FROM pubs WHERE publtype = 'informal'"):
            mask[pid] = False
    if sample is not None:
        ids = np.arange(n_pubs, dtype=np.uint64)
        hashed = (ids * np.uint64(_HASH_MULT)) & np.uint64(0xFFFFFFFF)
        mask &= hashed < np.uint64(sample * 2**32)
    log(f"  included pubs: {int(mask.sum()):,} / {n_pubs:,}")
    return mask


def build_artifacts(staging_path: Path, out_dir: Path,
                    year_range: tuple[int, int] | None = None,
                    sample: float | None = None,
                    exclude_informal: bool = False,
                    max_clique_authors: int = config.MAX_CLIQUE_AUTHORS,
                    log=print) -> dict:
    started = time.time()
    out_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(staging_path)

    log("Stage 2: computing paper filter")
    mask = compute_included_pubs(conn, year_range, sample, exclude_informal, log)

    log("Stage 2a: author resolution")
    index = build_author_index(conn, mask, log)

    log("Stage 2b: co-author graph")
    graph, graph_stats = build_coauthor_csr(
        conn, index.name_to_author, mask, index.author_count, max_clique_authors, log
    )
    write_csr(out_dir / "coauthor.csr", graph)

    log("Stage 2c: metadata sqlite")
    included_ids = np.flatnonzero(mask)
    db_counts = build_final_sqlite(staging_path, out_dir / "dblp.sqlite", index,
                                   included_ids, log)
    conn.close()

    meta = {
        "built": date.today().isoformat(),
        "filters": {
            "year_range": list(year_range) if year_range else None,
            "sample": sample,
            "exclude_informal": exclude_informal,
        },
        "graph": graph_stats,
        "sqlite": db_counts,
        "alias_conflicts": index.alias_conflicts,
        "seconds": round(time.time() - started, 1),
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2))
    log(f"Stage 2 done in {meta['seconds']}s -> {out_dir}")
    return meta


def parse_year_range(s: str) -> tuple[int, int]:
    a, b = s.split("-")
    return int(a), int(b)


def main(argv=None) -> None:
    import argparse

    ap = argparse.ArgumentParser(description="Stage 2: staging.sqlite -> artifacts")
    ap.add_argument("--staging", type=Path, default=config.STAGING_DB)
    ap.add_argument("--out", type=Path, default=config.ARTIFACTS_DIR)
    ap.add_argument("--filter-years", type=parse_year_range, default=None,
                    metavar="FROM-TO", help="only papers in this year range (dev subsets)")
    ap.add_argument("--filter-sample", type=float, default=None, metavar="FRAC",
                    help="deterministic pseudo-random fraction of papers (dev subsets)")
    ap.add_argument("--exclude-informal", action="store_true",
                    help="exclude arXiv/CoRR-style informal publications")
    ap.add_argument("--max-clique-authors", type=int, default=config.MAX_CLIQUE_AUTHORS)
    args = ap.parse_args(argv)
    build_artifacts(args.staging, args.out, args.filter_years, args.filter_sample,
                    args.exclude_informal, args.max_clique_authors)


if __name__ == "__main__":
    main()

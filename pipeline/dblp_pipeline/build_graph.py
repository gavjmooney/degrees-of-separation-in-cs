"""Stage 2b: build the weighted co-authorship CSR graph.

Pairs are generated vectorized: papers are bucketed by author count k, each
bucket's author lists become an (n_papers, k) matrix, and every column pair
(i < j) emits packed u64 edge keys (lo << 32 | hi). np.unique over all keys
yields unique undirected edges with multiplicity = edge weight.
"""

from __future__ import annotations

import sqlite3

import numpy as np

from . import config
from .csr_format import CsrGraph

FETCH_CHUNK = 1_000_000


def _load_pub_author_arrays(conn: sqlite3.Connection) -> tuple[np.ndarray, np.ndarray]:
    """pub_authors as (pub_id i64, name_id i64) arrays, in (pub_id, pos) order."""
    cur = conn.execute("SELECT pub_id, name_id FROM pub_authors ORDER BY pub_id, pos")
    pub_chunks, name_chunks = [], []
    while True:
        rows = cur.fetchmany(FETCH_CHUNK)
        if not rows:
            break
        arr = np.array(rows, dtype=np.int64)
        pub_chunks.append(arr[:, 0])
        name_chunks.append(arr[:, 1])
    if not pub_chunks:
        return np.empty(0, np.int64), np.empty(0, np.int64)
    return np.concatenate(pub_chunks), np.concatenate(name_chunks)


def build_coauthor_csr(conn: sqlite3.Connection, name_to_author: np.ndarray,
                       included_pub_mask: np.ndarray, author_count: int,
                       max_clique_authors: int = config.MAX_CLIQUE_AUTHORS,
                       log=print) -> tuple[CsrGraph, dict]:
    pub_ids, name_ids = _load_pub_author_arrays(conn)
    n_pubs = len(included_pub_mask)

    authors = name_to_author[name_ids].astype(np.int64)
    keep = included_pub_mask[pub_ids] & (authors >= 0)
    pub_ids, authors = pub_ids[keep], authors[keep]

    # Sort rows by (pub, author) and drop duplicate authors within a paper.
    order = np.lexsort((authors, pub_ids))
    pub_ids, authors = pub_ids[order], authors[order]
    dup = np.zeros(len(pub_ids), dtype=bool)
    if len(pub_ids) > 1:
        dup[1:] = (pub_ids[1:] == pub_ids[:-1]) & (authors[1:] == authors[:-1])
    pub_ids, authors = pub_ids[~dup], authors[~dup]

    counts = np.bincount(pub_ids, minlength=n_pubs)
    seg_offsets = np.zeros(n_pubs + 1, dtype=np.int64)
    np.cumsum(counts, out=seg_offsets[1:])
    n_skipped_big = int(np.count_nonzero(counts > max_clique_authors))

    key_chunks: list[np.ndarray] = []
    for k in range(2, max_clique_authors + 1):
        pubs_k = np.flatnonzero(counts == k)
        if len(pubs_k) == 0:
            continue
        idx = seg_offsets[pubs_k][:, None] + np.arange(k)[None, :]
        mat = authors[idx]  # (n_k, k), each row sorted ascending
        for i in range(k):
            for j in range(i + 1, k):
                keys = (mat[:, i].astype(np.uint64) << np.uint64(32)) | mat[:, j].astype(np.uint64)
                key_chunks.append(keys)

    if key_chunks:
        all_keys = np.concatenate(key_chunks)
        del key_chunks
        unique_keys, multiplicity = np.unique(all_keys, return_counts=True)
        del all_keys
    else:
        unique_keys = np.empty(0, dtype=np.uint64)
        multiplicity = np.empty(0, dtype=np.int64)

    lo = (unique_keys >> np.uint64(32)).astype(np.uint32)
    hi = (unique_keys & np.uint64(0xFFFFFFFF)).astype(np.uint32)
    weights = np.minimum(multiplicity, config.MAX_EDGE_WEIGHT).astype(np.uint16)

    src = np.concatenate([lo, hi])
    dst = np.concatenate([hi, lo])
    w = np.concatenate([weights, weights])
    order = np.lexsort((dst, src))
    src, dst, w = src[order], dst[order], w[order]

    offsets = np.zeros(author_count + 1, dtype=np.uint64)
    np.cumsum(np.bincount(src, minlength=author_count), out=offsets[1:])

    graph = CsrGraph(offsets=offsets, neighbors=dst, weights=w)
    stats = {
        "nodes": author_count,
        "undirected_edges": len(unique_keys),
        "edge_entries": len(dst),
        "papers_over_clique_cap": n_skipped_big,
        "max_clique_authors": max_clique_authors,
        "max_degree": int(np.diff(offsets).max()) if author_count else 0,
        "max_weight": int(weights.max()) if len(weights) else 0,
    }
    log(f"  graph: {stats['nodes']:,} nodes, {stats['undirected_edges']:,} undirected edges, "
        f"{n_skipped_big:,} papers over the {max_clique_authors}-author cap")
    return graph, stats

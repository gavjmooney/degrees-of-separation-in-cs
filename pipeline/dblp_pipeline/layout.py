"""Stage 3 (optional): whole-network map.

Computes a 2D embedding of the co-author graph (igraph DRL/OpenOrd — the
"map of science" family of layouts), detects collaboration communities
(Leiden), and renders a static density map coloured by community. Outputs:

    layout.f32      x,y float32 per node id, normalized to [0,1] (y down)
    map.png         pre-rendered global map (no edges, no node labels)
    map-index.u16   community id per pixel (hover lookup), 65535 = empty
    map-meta.json   extent/communities (id, label, colour, members, centroid)

Authors with no co-authors are placed on a thin ring outside the layout
(hash-based angle, deterministic) — present but visually out of the way.
"""

from __future__ import annotations

import colorsys
import json
import sqlite3
import time
from collections import Counter
from pathlib import Path

import numpy as np

from .csr_format import read_csr

EMPTY_PIXEL = 65535


def _log(msg: str) -> None:
    print(f"  [{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _variant_color(base_hex: str, i: int) -> str:
    """Deterministic per-community lightness variation of its domain colour,
    giving the domain 'continents' visible internal texture."""
    r = int(base_hex[1:3], 16) / 255
    g = int(base_hex[3:5], 16) / 255
    b = int(base_hex[5:7], 16) / 255
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = min(0.85, max(0.3, l + (((i * 37) % 5) - 2) * 0.045))
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"


def _unique_edges(csr) -> np.ndarray:
    src = np.repeat(
        np.arange(csr.node_count, dtype=np.int64),
        np.diff(csr.offsets).astype(np.int64),
    )
    dst = csr.neighbors.astype(np.int64)
    keep = src < dst
    return np.column_stack([src[keep], dst[keep]])


def _label_communities(
    db_path: Path, membership: np.ndarray, node_ids: np.ndarray,
    top_ids: list[int], comm_sizes: np.ndarray,
) -> tuple[dict[int, str], dict[int, list[str]], dict[int, str]]:
    """Subject-area labels for top communities, via the curated venue taxonomy.

    Each community's members' venues are scored against fields.FIELDS; when a
    field clearly dominates, the community is labelled with the subject area
    (duplicates disambiguated by dominant venue). Otherwise it falls back to
    its top venue names. Returns (labels, top venues per community).
    """
    import re as _re

    from .fields import DOMAINS, EXCLUDED_VENUES, OTHER_DOMAIN, classify_venue

    track = _re.compile(r"\s*\(\d+\)$")
    top_set = set(top_ids)
    aid_to_comm: dict[int, int] = {}
    for idx, comm in zip(node_ids, membership):
        c = int(comm)
        if c in top_set:
            aid_to_comm[int(idx)] = c

    venue_counts: dict[int, Counter] = {c: Counter() for c in top_ids}
    field_counts: dict[int, Counter] = {c: Counter() for c in top_ids}
    conn = sqlite3.connect(db_path)
    for aid, venues_json in conn.execute(
        "SELECT id, top_venues FROM authors WHERE top_venues IS NOT NULL"
    ):
        comm = aid_to_comm.get(aid)
        if comm is None:
            continue
        for w, venue in zip((3, 2, 1), json.loads(venues_json)):
            base = track.sub("", venue).strip()
            if base not in EXCLUDED_VENUES:
                venue_counts[comm][base] += w
            field = classify_venue(venue)
            if field:
                field_counts[comm][field] += w
    conn.close()

    labels: dict[int, str] = {}
    venues_out: dict[int, list[str]] = {}
    domains: dict[int, str] = {}
    for c in top_ids:
        venues_out[c] = [v for v, _ in venue_counts[c].most_common(3)]
        total_venue = sum(venue_counts[c].values()) or 1
        mapped = sum(field_counts[c].values())
        # domain assignment for unlabelled communities: aggregate the mapped
        # evidence per DOMAIN (pooling related fields, e.g. Networking +
        # Wireless + IoT), which is far more robust than the single top field
        domain_counts: Counter = Counter()
        for f, w in field_counts[c].items():
            domain_counts[DOMAINS.get(f, OTHER_DOMAIN)] += w
        domains[c] = (
            domain_counts.most_common(1)[0][0]
            if domain_counts and mapped >= 0.12 * total_venue
            else OTHER_DOMAIN
        )
        # very large communities are the mixed core of the network — no single
        # field (or venue pair) describes them honestly, whatever the scores say
        if comm_sizes[c] >= 0.05 * len(node_ids):
            labels[c] = "Interdisciplinary"
            domains[c] = OTHER_DOMAIN
            continue
        if field_counts[c] and mapped >= 0.15 * total_venue:
            top2 = field_counts[c].most_common(2)
            f1, w1 = top2[0]
            w2 = top2[1][1] if len(top2) > 1 else 0
            if w1 >= 1.5 * w2 and w1 >= 0.22 * mapped:
                labels[c] = f1  # one field clearly leads
                domains[c] = DOMAINS.get(f1, OTHER_DOMAIN)  # domain follows the label
                continue
            if len(top2) > 1 and w1 + w2 >= 0.4 * mapped:
                labels[c] = f"{f1} / {top2[1][0]}"  # two related fields dominate
                domains[c] = DOMAINS.get(f1, OTHER_DOMAIN)
                continue
        labels[c] = " · ".join(venues_out[c][:2]) if venues_out[c] else "—"

    # disambiguate duplicate labels with a dominant venue not already shown
    uses = Counter(labels.values())
    for c in top_ids:
        if uses[labels[c]] > 1:
            extra = next((v for v in venues_out[c] if v not in labels[c]), None)
            if extra:
                labels[c] = f"{labels[c]} · {extra}"
    final = Counter()
    for c in top_ids:
        final[labels[c]] += 1
        if final[labels[c]] > 1:
            labels[c] = f"{labels[c]} ({final[labels[c]]})"
    return labels, venues_out, domains


def _normalize(xy: np.ndarray, degree: np.ndarray, core: np.ndarray) -> np.ndarray:
    """Robust radial normalization to [0,1] (y down).

    The frame is scaled to the giant component (`core`): DRL scatters the
    thousands of small disconnected components in a wide annulus around it,
    which would otherwise shrink the interesting structure to a fraction of
    the frame. The giant's 99th-percentile radius defines the content circle
    (radius 0.42 around the centre); everything outside (small components,
    outliers) clamps onto a rim, and isolated authors form the outer ring.
    """
    laid = degree > 0
    center = np.median(xy[core], axis=0)
    rel = xy - center
    dist = np.hypot(rel[:, 0], rel[:, 1])
    r99 = np.percentile(dist[core], 99) or 1.0
    scale = 0.42 / r99
    norm = 0.5 + rel * scale
    # Compress outliers smoothly toward the disc edge instead of clamping
    # them onto a hard rim (a hard rim reads as a fake "ring" and gets
    # confused with the isolated-author ring when highlighted). Giant-tail
    # outliers land just inside the edge; far-flung small components pile
    # into a soft jittered fringe band below the isolated ring.
    nd = dist * scale
    out = laid & (nd > 0.42)
    if out.any():
        compressed = 0.42 + 0.045 * np.log1p((nd[out] - 0.42) / 0.1)
        capped = compressed > 0.45
        if capped.any():
            h = (np.flatnonzero(out)[capped].astype(np.uint64) * np.uint64(40503)) % np.uint64(1000)
            compressed[capped] = 0.45 + 0.012 * (h.astype(np.float64) / 1000)
        f = compressed / nd[out]
        norm[out] = 0.5 + rel[out] * (scale * f)[:, None]
    # isolated authors: deterministic outer ring
    iso = np.flatnonzero(degree == 0)
    if len(iso):
        h = (iso.astype(np.uint64) * np.uint64(2654435761)) & np.uint64(0xFFFFFFFF)
        angle = (h.astype(np.float64) / 2**32) * 2 * np.pi
        ring_r = 0.465 + 0.025 * ((h >> np.uint64(8)).astype(np.float64) % 97) / 97
        norm[iso, 0] = 0.5 + ring_r * np.cos(angle)
        norm[iso, 1] = 0.5 + ring_r * np.sin(angle)
    return np.clip(norm, 0.005, 0.995)


def build_map(artifacts_dir: Path, image_size: int = 4096, index_size: int = 1024,
              top_communities: int = 40, render_only: bool = False) -> None:
    csr = read_csr(artifacts_dir / "coauthor.csr")
    n = csr.node_count
    degree = np.diff(csr.offsets).astype(np.int64)
    laid_ids = np.flatnonzero(degree > 0)
    _log(f"{n:,} nodes, {len(laid_ids):,} with co-authors (laid out), "
         f"{n - len(laid_ids):,} isolated (outer ring)")

    import igraph as ig

    edges = _unique_edges(csr)
    _log(f"building igraph graph ({len(edges):,} edges)")
    # compact ids for the laid-out subgraph
    compact = np.full(n, -1, dtype=np.int64)
    compact[laid_ids] = np.arange(len(laid_ids))
    g = ig.Graph(n=len(laid_ids), edges=compact[edges].tolist())

    layout_path = artifacts_dir / "layout.f32"
    raw_path = artifacts_dir / "layout-raw.f32"
    if render_only and (raw_path.exists() or layout_path.exists()):
        src = raw_path if raw_path.exists() else layout_path
        if src is layout_path:
            _log("render-only: WARNING no layout-raw.f32 — re-normalizing already-normalized "
                 "coords; previously clamped rim positions cannot be recovered")
        _log(f"render-only: reusing {src.name}")
        xy = np.fromfile(src, dtype=np.float32).reshape(-1, 2).astype(np.float64)
    else:
        _log("running DRL layout (this is the long step)")
        t0 = time.time()
        coords = np.array(g.layout_drl().coords, dtype=np.float64)
        _log(f"DRL done in {time.time() - t0:.0f}s")
        xy = np.zeros((n, 2), dtype=np.float64)
        xy[laid_ids] = coords
        xy.astype(np.float32).tofile(raw_path)  # raw coords: re-normalization stays possible

    _log("detecting communities (Leiden)")
    t0 = time.time()
    part = g.community_leiden(objective_function="modularity", n_iterations=2)
    membership = np.array(part.membership, dtype=np.int64)
    n_comms = membership.max() + 1 if len(membership) else 0
    _log(f"Leiden done in {time.time() - t0:.0f}s: {n_comms:,} communities")

    comps = g.connected_components()
    giant_compact = np.array(max(comps, key=len), dtype=np.int64)
    core = np.zeros(n, dtype=bool)
    core[laid_ids[giant_compact]] = True
    _log(f"giant component: {int(core.sum()):,} nodes")

    norm = _normalize(xy, degree, core)
    norm.astype(np.float32).tofile(layout_path)
    _log("layout.f32 written")

    # ---- community summary ----
    from .fields import DOMAIN_COLORS, OTHER_DOMAIN

    comm_sizes = np.bincount(membership, minlength=n_comms)
    top_ids = [int(c) for c in np.argsort(comm_sizes)[::-1][:top_communities]]
    _log(f"labelling top {len(top_ids)} communities by subject area")
    labels, comm_venues, comm_domains = _label_communities(
        artifacts_dir / "dblp.sqlite", membership, laid_ids, top_ids, comm_sizes
    )
    colors = [
        _variant_color(DOMAIN_COLORS[comm_domains[c]], i) for i, c in enumerate(top_ids)
    ]

    # map community -> render index (0..K-1 top, K = other)
    OTHER = len(top_ids)
    render_idx = np.full(n_comms, OTHER, dtype=np.int64)
    for i, c in enumerate(top_ids):
        render_idx[c] = i
    node_render = np.full(n, OTHER, dtype=np.int64)  # isolated -> other
    node_render[laid_ids] = render_idx[membership]

    # ---- rasterize: density + dominant community per pixel ----
    _log(f"rendering {image_size}px map + {index_size}px index")
    px = norm[:, 0]
    py = norm[:, 1]
    rng = [[0.0, 1.0], [0.0, 1.0]]

    def histo(mask: np.ndarray, size: int) -> np.ndarray:
        hgram, _, _ = np.histogram2d(py[mask], px[mask], bins=size, range=rng)
        return hgram  # [row][col]

    palette = np.array(
        [tuple(int(c[i : i + 2], 16) for i in (1, 3, 5)) for c in colors]
        + [(108, 117, 140)],  # "other": muted blue-grey
        dtype=np.float64,
    )

    centroids = {}
    members_count = {}
    for size, is_index in ((image_size, False), (index_size, True)):
        total = np.zeros((size, size))
        best = np.zeros((size, size))
        best_id = np.full((size, size), EMPTY_PIXEL, dtype=np.uint16)
        for i in range(len(top_ids) + 1):
            mask = node_render == i
            if i < len(top_ids) and not is_index:
                m = norm[mask]
                centroids[i] = (
                    (float(np.median(m[:, 0])), float(np.median(m[:, 1])))
                    if len(m)
                    else (0.5, 0.5)
                )
                members_count[i] = int(mask.sum())
            hgram = histo(mask, size)
            total += hgram
            better = hgram > best
            best = np.where(better, hgram, best)
            best_id[better] = i
        if is_index:
            best_id[total < 1] = EMPTY_PIXEL
            best_id.tofile(artifacts_dir / "map-index.u16")
        else:
            # brightness floor keeps sparse regions visible; cap at the 99th
            # percentile so a few hot pixels don't compress the whole range
            nz = total[total > 0]
            cap = np.percentile(nz, 99) if len(nz) else 1.0
            level = np.log1p(np.minimum(total, cap)) / np.log1p(cap)
            brightness = 0.45 + 0.55 * level**0.6
            safe_id = np.where(best_id == EMPTY_PIXEL, 0, best_id)
            rgba = np.zeros((size, size, 4), dtype=np.float64)
            rgba[..., :3] = palette[safe_id] * brightness[..., None]
            rgba[..., 3] = np.where(total >= 1, 255, 0)  # transparent background
            from PIL import Image

            img = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")
            img.save(artifacts_dir / "map.png", optimize=True)

    # domain aggregates: member-weighted centroid over their communities
    domain_agg: dict[str, dict] = {}
    for i, c in enumerate(top_ids):
        d = comm_domains[c]
        agg = domain_agg.setdefault(d, {"members": 0, "wx": 0.0, "wy": 0.0})
        agg["members"] += members_count[i]
        agg["wx"] += centroids[i][0] * members_count[i]
        agg["wy"] += centroids[i][1] * members_count[i]

    meta = {
        "imageSize": image_size,
        "indexSize": index_size,
        "nodes": n,
        "laidOut": int(len(laid_ids)),
        "domains": sorted(
            (
                {
                    "name": d,
                    "color": DOMAIN_COLORS[d],
                    "members": agg["members"],
                    "cx": agg["wx"] / agg["members"],
                    "cy": agg["wy"] / agg["members"],
                }
                for d, agg in domain_agg.items()
                if d != OTHER_DOMAIN  # the mixed core gets no continent label
            ),
            key=lambda x: -x["members"],
        ),
        "communities": [
            {
                "id": i,
                "label": labels[c],
                "domain": comm_domains[c],
                "venues": comm_venues[c],
                "color": colors[i],
                "members": members_count[i],
                "cx": centroids[i][0],
                "cy": centroids[i][1],
            }
            for i, c in enumerate(top_ids)
        ],
        "otherColor": "#6c758c",
    }
    (artifacts_dir / "map-meta.json").write_text(json.dumps(meta, indent=2))
    _log("map.png, map-index.u16, map-meta.json written")


def main(argv=None) -> None:
    import argparse

    from . import config

    ap = argparse.ArgumentParser(description="Stage 3: whole-network map")
    ap.add_argument("--artifacts", type=Path, default=config.ARTIFACTS_DIR)
    ap.add_argument("--image-size", type=int, default=4096)
    ap.add_argument("--index-size", type=int, default=1024)
    ap.add_argument("--top-communities", type=int, default=40)
    ap.add_argument("--render-only", action="store_true",
                    help="reuse existing layout.f32; redo communities + rendering only")
    args = ap.parse_args(argv)
    build_map(args.artifacts, args.image_size, args.index_size, args.top_communities,
              args.render_only)


if __name__ == "__main__":
    main()

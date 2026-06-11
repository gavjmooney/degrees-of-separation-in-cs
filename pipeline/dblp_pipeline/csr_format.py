"""Binary CSR adjacency format ("DCSR") shared between the Python pipeline
and the Node server.

Layout (little-endian):
    bytes 0..3    magic "DCSR"
    bytes 4..7    u32 version (=1)
    bytes 8..15   u64 node_count N
    bytes 16..23  u64 edge_entry_count M (directed entries = 2 x undirected edges)
    bytes 24..47  reserved (zero)
    offsets       u64 x (N+1)   -- offsets[N] == M, 8-byte aligned (starts at 48)
    neighbors     u32 x M       -- sorted ascending within each node's slice
    weights       u16 x M       -- co-authored paper count, clamped to 65535
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

MAGIC = b"DCSR"
VERSION = 1
HEADER_SIZE = 48


@dataclass
class CsrGraph:
    offsets: np.ndarray  # u64, len N+1
    neighbors: np.ndarray  # u32, len M
    weights: np.ndarray  # u16, len M

    @property
    def node_count(self) -> int:
        return len(self.offsets) - 1

    @property
    def edge_entry_count(self) -> int:
        return len(self.neighbors)

    def neighbors_of(self, node: int) -> tuple[np.ndarray, np.ndarray]:
        lo, hi = self.offsets[node], self.offsets[node + 1]
        return self.neighbors[lo:hi], self.weights[lo:hi]


def write_csr(path: Path, graph: CsrGraph) -> None:
    n, m = graph.node_count, graph.edge_entry_count
    assert graph.offsets.dtype == np.uint64 and len(graph.offsets) == n + 1
    assert int(graph.offsets[0]) == 0 and int(graph.offsets[-1]) == m
    assert graph.neighbors.dtype == np.uint32 and graph.weights.dtype == np.uint16
    header = struct.pack("<4sIQQ", MAGIC, VERSION, n, m).ljust(HEADER_SIZE, b"\0")
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(header)
        f.write(graph.offsets.tobytes())
        f.write(graph.neighbors.tobytes())
        f.write(graph.weights.tobytes())


def read_csr(path: Path) -> CsrGraph:
    with open(path, "rb") as f:
        header = f.read(HEADER_SIZE)
        magic, version, n, m = struct.unpack("<4sIQQ", header[:24])
        if magic != MAGIC:
            raise ValueError(f"{path}: bad magic {magic!r}")
        if version != VERSION:
            raise ValueError(f"{path}: unsupported version {version}")
        offsets = np.fromfile(f, dtype=np.uint64, count=n + 1)
        neighbors = np.fromfile(f, dtype=np.uint32, count=m)
        weights = np.fromfile(f, dtype=np.uint16, count=m)
    if len(offsets) != n + 1 or len(neighbors) != m or len(weights) != m:
        raise ValueError(f"{path}: truncated file")
    return CsrGraph(offsets, neighbors, weights)

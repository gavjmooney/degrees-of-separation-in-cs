"""Stage 2a: resolve author names to persons and assign dense node IDs.

A *person* is one dblp homepages/* record (its <author> list = name variants,
first = primary). Any author name on a publication that belongs to no person
record becomes a singleton person. Only persons with at least one *included*
publication get an ID (excluded persons would be isolated nodes).

IDs are dense 0..N-1, deterministic per dump: ordered by dblp person key,
with orphan (no-homepage) persons after, ordered by name. The dblp key is the
stable external identifier across dump rebuilds.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

import numpy as np


@dataclass
class AuthorIndex:
    # All indexed by author_id (0..N-1):
    dblp_keys: list[str | None]
    primary_names: list[str]
    is_disambig: np.ndarray  # u8
    # name_id -> author_id, -1 if the name maps to no included author:
    name_to_author: np.ndarray  # i32
    names: list[str]  # name_id -> name string
    alias_conflicts: int

    @property
    def author_count(self) -> int:
        return len(self.primary_names)


def load_names(conn: sqlite3.Connection) -> list[str]:
    n = conn.execute("SELECT MAX(id) FROM names").fetchone()[0]
    names: list[str] = [""] * (n + 1)
    for nid, name in conn.execute("SELECT id, name FROM names"):
        names[nid] = name
    return names


def build_author_index(conn: sqlite3.Connection, included_pub_mask: np.ndarray,
                       log=print) -> AuthorIndex:
    names = load_names(conn)
    n_names = len(names)

    # owner of each name: index into a provisional person list
    name_owner = np.full(n_names, -1, dtype=np.int64)
    person_keys: list[str | None] = []
    person_primary_nid: list[int] = []
    person_disambig: list[bool] = []
    alias_conflicts = 0

    rows = conn.execute(
        """SELECT pn.person_key, pn.pos, pn.name_id, p.is_disambig
           FROM person_names pn JOIN persons p ON p.key = pn.person_key
           ORDER BY pn.person_key, pn.pos"""
    ).fetchall()
    current_key = None
    for key, pos, nid, is_disambig in rows:
        if key != current_key:
            current_key = key
            person_keys.append(key)
            person_primary_nid.append(nid)
            person_disambig.append(bool(is_disambig))
        pidx = len(person_keys) - 1
        if name_owner[nid] == -1:
            name_owner[nid] = pidx
        else:
            alias_conflicts += 1
    if alias_conflicts:
        log(f"  warning: {alias_conflicts} name variants claimed by multiple person records (first wins)")

    # Names used on publications; orphans become singleton persons.
    pub_rows = conn.execute("SELECT pub_id, name_id FROM pub_authors").fetchall()
    pub_ids = np.fromiter((r[0] for r in pub_rows), dtype=np.int64, count=len(pub_rows))
    name_ids = np.fromiter((r[1] for r in pub_rows), dtype=np.int64, count=len(pub_rows))
    del pub_rows

    used_nids = np.unique(name_ids)
    orphan_nids = used_nids[name_owner[used_nids] == -1]
    for nid in orphan_nids:
        person_keys.append(None)
        person_primary_nid.append(int(nid))
        person_disambig.append(False)
        name_owner[nid] = len(person_keys) - 1

    # Persons with >=1 included publication row.
    included_rows = included_pub_mask[pub_ids]
    used_persons = np.unique(name_owner[name_ids[included_rows]])
    used_persons = used_persons[used_persons >= 0]

    # Deterministic ordering: homepage persons by dblp key, then orphans by name.
    def sort_key(pidx: int):
        key = person_keys[pidx]
        if key is not None:
            return (0, key)
        return (1, names[person_primary_nid[pidx]])

    ordered = sorted((int(p) for p in used_persons), key=sort_key)

    person_to_author = np.full(len(person_keys), -1, dtype=np.int64)
    dblp_keys: list[str | None] = []
    primary_names: list[str] = []
    is_disambig = np.zeros(len(ordered), dtype=np.uint8)
    for author_id, pidx in enumerate(ordered):
        person_to_author[pidx] = author_id
        dblp_keys.append(person_keys[pidx])
        primary_names.append(names[person_primary_nid[pidx]])
        is_disambig[author_id] = person_disambig[pidx]

    name_to_author = np.full(n_names, -1, dtype=np.int32)
    owned = name_owner >= 0
    name_to_author[owned] = person_to_author[name_owner[owned]].astype(np.int32)

    log(f"  authors: {len(ordered):,} ({len(orphan_nids):,} orphan names, "
        f"{int(is_disambig.sum()):,} disambiguation profiles)")
    return AuthorIndex(dblp_keys, primary_names, is_disambig, name_to_author, names,
                       alias_conflicts)

"""Build configuration for the DBLP preprocessing pipeline."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
STAGING_DB = DATA_DIR / "staging" / "staging.sqlite"
ARTIFACTS_DIR = DATA_DIR / "artifacts"
ARTIFACTS_DEV_DIR = DATA_DIR / "artifacts-dev"

DBLP_XML_GZ = RAW_DIR / "dblp.xml.gz"
DBLP_DTD = RAW_DIR / "dblp.dtd"

# Publication element types that carry <author> tags and count as papers.
# <proceedings> is excluded (editors, not authors); <www> records are persons.
PUBLICATION_TYPES = frozenset(
    {"article", "inproceedings", "incollection", "book", "phdthesis", "mastersthesis", "data"}
)

# All top-level record tags under <dblp> (used to know when to free memory).
ALL_RECORD_TYPES = PUBLICATION_TYPES | {"proceedings", "www", "person"}

# Papers with more than this many authors contribute no co-author edges
# (hyper-authorship collaborations would otherwise create absurd 1-hop cliques).
MAX_CLIQUE_AUTHORS = 50

# Edge weights are stored as u16 in the CSR artifact.
MAX_EDGE_WEIGHT = 65535

# Degrees of Separation in CS

Visualise the degree of separation between computing-science researchers in the
[dblp](https://dblp.org) co-authorship network — the Erdős-number idea, for all of CS.
Pick two authors, get the shortest chain of co-authored papers connecting them, and
explore the surrounding collaboration neighbourhood interactively.

## Architecture

```
dblp.xml.gz ── Python pipeline (offline, once per dump) ──▶ data/artifacts/
                                                              ├── coauthor.csr   binary CSR co-author graph (~380 MB)
                                                              ├── dblp.sqlite    metadata + bipartite graph + FTS5 search
                                                              └── meta.json
data/artifacts ──▶ Node (Fastify) API ──▶ React + sigma.js SPA
```

- **pipeline/** — Python 3.12+. Stage 1 stream-parses the ~4.6 GB XML into a staging
  SQLite checkpoint (~8 min). Stage 2 resolves persons (dblp `homepages/` records,
  homonym suffixes, aliases), builds the weighted co-authorship graph as a compact
  binary CSR, and produces the metadata/search database (~10 min).
- **server/** — Node 22 + TypeScript. Loads the CSR into typed arrays (~400 MB RAM),
  answers shortest-path queries with an allocation-free bidirectional BFS
  (sub-millisecond typical), extracts capped k-hop neighbourhood subgraphs, and serves
  search/metadata from SQLite (FTS5 autocomplete).
- **web/** — Vite + React + sigma.js (WebGL). Author search with disambiguation,
  animated force layout with the path pinned to a horizontal backbone, hover/click
  details, shared-paper edge inspection.

## Setup

```powershell
# 1. download data (~1 GB)
curl.exe -L -o data/raw/dblp.xml.gz  https://dblp.org/xml/dblp.xml.gz
curl.exe -L -o data/raw/dblp.dtd    https://dblp.org/xml/dblp.dtd

# 2. python pipeline
python -m venv pipeline/.venv
pipeline/.venv/Scripts/pip install lxml numpy pytest
$env:PYTHONPATH = "pipeline"
pipeline/.venv/Scripts/python -m dblp_pipeline.cli parse        # XML -> staging (~8 min)
pipeline/.venv/Scripts/python -m dblp_pipeline.cli build        # staging -> artifacts (~10 min)
pipeline/.venv/Scripts/python -m dblp_pipeline.cli validate     # invariant checks

# small dev artifacts (seconds to build, instant server startup):
pipeline/.venv/Scripts/python -m dblp_pipeline.cli build --out data/artifacts-dev --filter-years 2018-2026 --filter-sample 0.15

# optional: whole-network map (igraph DRL layout + Leiden communities ->
# layout.f32, map.png, map-index.u16, map-meta.json; the landing page becomes
# an interactive 'map of computing science' with animated zoom into queries).
# DRL is the long step: ~35 min for the dev set, hours for the full graph.
pipeline/.venv/Scripts/pip install igraph pillow
pipeline/.venv/Scripts/python -m dblp_pipeline.cli layout --artifacts data/artifacts-dev
# tweak rendering without redoing the layout:
pipeline/.venv/Scripts/python -m dblp_pipeline.cli layout --artifacts data/artifacts-dev --render-only

# 3. node + web
npm install
npm run dev:server     # API on :3001 (ARTIFACTS_DIR=... to point elsewhere)
npm run dev:web        # SPA on :5173, proxies /api to :3001
```

Production: `npm run build`, then `node server/dist/index.js` serves both the API and
the built SPA from one process. Point `ARTIFACTS_DIR` at the artifacts directory.

## Data policies

- Papers with **more than 50 authors** contribute no co-author edges (they still appear
  in metadata and paper lists) — hyper-authorship collaborations would otherwise create
  absurd 1-hop cliques.
- arXiv/CoRR **informal preprints are included** (`build --exclude-informal` to drop).
- dblp **disambiguation profiles** (bare names like "Wei Wang" that bin unattributed
  papers from many people) stay in the graph and are clearly badged in the UI.

## Tests

```powershell
pipeline/.venv/Scripts/python -m pytest pipeline/tests   # parser + graph build on fixtures
npm test --workspace server                               # BFS/subgraph unit tests
npm run bench --workspace server                          # shortest-path latency benchmark
```

Data from [dblp.org](https://dblp.org), released under CC0 1.0.

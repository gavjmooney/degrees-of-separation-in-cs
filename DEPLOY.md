# Deploying to a VPS

One Node process (Fastify) serves both the JSON API and the built SPA, reading
the pipeline artifacts from disk. Put a reverse proxy (Caddy shown here) in
front for the domain + TLS. Nothing else is needed — no database server, no
workers.

## What lives where

| thing | how it gets to the VPS |
|---|---|
| code (`server/`, `web/`, `pipeline/`) | `git clone` from GitHub |
| `data/artifacts/` (~7.5 GB full build: `dblp.sqlite` ≈ 3.1 GB, `coauthor.csr` ≈ 380 MB, `layout.f32`, `map.png`, `map-index.u16`, `map-meta.json`, `meta.json`) | `rsync` — never in git |

The pipeline does **not** run on the VPS; artifacts are built locally and
shipped. RAM needs: the server holds the CSR in memory — budget ~1 GB RSS for
the full graph, so a 2 GB VPS is comfortable.

## 1. VPS prerequisites (Ubuntu/Debian)

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential rsync caddy
```

(`build-essential` is a fallback for better-sqlite3; it normally installs a
prebuilt linux-x64 binary and compiles nothing.)

## 2. Clone and build

```bash
sudo useradd -r -m -s /usr/sbin/nologin dos   # service user
sudo -u dos -H bash -c '
  cd ~ &&
  git clone https://github.com/gavjmooney/degrees-of-separation-in-cs.git app &&
  cd app &&
  npm ci &&
  npm run build       # builds server (tsc -> server/dist) and web (vite -> web/dist)
'
```

## 3. Ship the artifacts

From the dev machine (Windows: run in Git Bash or WSL so rsync exists):

```bash
rsync -avz --progress data/artifacts/ dos@YOUR_VPS:/home/dos/artifacts/
```

First transfer of the sqlite file is the slow part; later syncs only move
changed files. After a new dblp dump, rebuild locally and rsync again — the
server only needs a restart to pick it up.

## 4. systemd unit

`/etc/systemd/system/dos.service`:

```ini
[Unit]
Description=Degrees of Separation in CS
After=network.target

[Service]
User=dos
WorkingDirectory=/home/dos/app/server
Environment=ARTIFACTS_DIR=/home/dos/artifacts
Environment=PORT=3001
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
MemoryMax=2G

[Install]
WantedBy=multi-user.target
```

`ARTIFACTS_DIR` must be an **absolute** path. Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dos
curl -s localhost:3001/api/meta | head -c 200   # smoke test
```

## 5. Caddy (domain + automatic HTTPS)

`/etc/caddy/Caddyfile`:

```
yourdomain.example {
    reverse_proxy localhost:3001
    encode gzip
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtains and renews the certificate automatically. The Fastify app
already serves the SPA, the map image, and the API from one port, so this one
proxy block is the whole edge config.

## 6. Verify

From the dev machine, the browser e2e can be pointed at production:

```bash
node web/scripts/e2e.mjs https://yourdomain.example data/e2e-prod
```

(Author arguments may be needed if the served artifact set differs from the
defaults — see the header of `web/scripts/e2e.mjs`.)

## Updating

```bash
# code:
sudo -u dos -H bash -c 'cd ~/app && git pull && npm ci && npm run build'
sudo systemctl restart dos
# data (after a local pipeline rebuild):
rsync -avz data/artifacts/ dos@YOUR_VPS:/home/dos/artifacts/ && sudo systemctl restart dos
```

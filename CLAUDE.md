# pdfpal

PDF reading and research assistant with AI chat, annotations, paper search, and project organization.

## Quick start

### Option A — Docker

```bash
cp .env.example .env
docker compose up --build
```

### Option B — Local

```bash
cp .env.example .env
make install
make run
```

Edit `.env` before starting — at minimum set `CLAUDE_BIN` and `TAVILY_API_KEY`.

Auth is optional: when `GOOGLE_CLIENT_ID` is left empty, authentication is disabled (suitable for local / solo use).

### CLI usage

```bash
cd backend && python3 cli.py --db ~/my.db --port 8200
```

## Tech stack

- **Backend:** Python 3 / FastAPI / uvicorn, SQLite (WAL mode), pdfplumber, httpx, authlib, python-jose
- **Frontend:** React 19 / TypeScript / Vite 8 / Tailwind CSS 4, react-pdf, react-router-dom, react-markdown with KaTeX math support
- **AI:** Claude CLI (`claude --print`) invoked as a subprocess for chat
- **Auth:** Google OAuth2 with JWT session cookies (allowlist-based)
- **External APIs:** Tavily (web search augmentation), Semantic Scholar, OpenAlex, arXiv, Unpaywall (PDF resolution + related papers)

## Repo

`git@github.com:andrepaim/pdfpal.git`

## Local development

### Backend

```bash
cd backend
pip install -r requirements.txt
python3 -m uvicorn main:app --host 0.0.0.0 --port 8200 --reload
```

Backend serves on port 8200. The app initializes the SQLite DB (`backend/pdfpal.db`) on startup.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite dev server proxies `/api` requests to `http://localhost:8200` (with path rewrite stripping the `/api` prefix -- see `vite.config.ts`).

## Deploy

Service: `pdfpal.service` (systemd)

```bash
# Full deploy (build frontend + restart service):
./deploy.sh

# Or manually:
cd frontend && npm install && npm run build
systemctl restart pdfpal
```

- Production runs on port **8200** via uvicorn
- Frontend is built to `frontend/dist/` and served as static files by FastAPI (SPA catch-all)
- The pdf.worker file is copied from react-pdf during build (see `deploy.sh`)

## Environment variables

Configured via `.env` (local) or `/etc/pdfpal.env` (production, mode 600, owned by root). See `.env.example` for all options.

- `TAVILY_API_KEY` -- web search for chat context
- `CLAUDE_BIN` -- path to claude CLI binary (default: `/usr/local/bin/claude`)
- `GOOGLE_CLIENT_ID` -- Google OAuth (leave empty to disable auth)
- `GOOGLE_CLIENT_SECRET` -- Google OAuth
- `ALLOWED_EMAILS` -- comma-separated email allowlist
- `SESSION_SECRET` -- JWT signing secret
- `SESSION_MAX_AGE` -- session TTL in seconds (default: 30 days)
- `PUBLIC_URL` -- public base URL (default: `http://localhost:8200`)

## Architecture

### Backend entry point

`backend/main.py` -- FastAPI app. Sets up CORS, auth middleware, DB init, and mounts all routers.

### Key modules

| File | Purpose |
|------|---------|
| `main.py` | App setup, sessions CRUD (v1 legacy), PDF extraction, chat endpoint, paper search/related |
| `auth.py` | Google OAuth2 flow, JWT session tokens, `/auth/*` routes |
| `db.py` | Shared SQLite connection helper |
| `pdf_resolver.py` | Smart PDF URL resolution: URL rewriting (arXiv, OpenReview, ACL, PMC, PMLR), HTML scraping for PDF links, Unpaywall/S2 fallback |
| `semantic_scholar.py` | Paper search (OpenAlex + arXiv), related papers (S2 references/citations), reference ordering by PDF text position |
| `routes/projects.py` | v2 CRUD: projects, sources, notes, artifacts |
| `routes/annotations.py` | PDF highlight annotations CRUD |
| `migrate_v2.py` | One-time migration from v1 sessions to v2 projects/sources (run manually) |

### API routing

- All API routes are under `/api/` prefix
- Auth routes are mounted at both `/auth/` and `/api/auth/`
- Non-API routes fall through to SPA (react-router handles client-side routing)
- Auth middleware protects `/api/*` paths; static assets and `/auth/*` are public

### Database

SQLite at `backend/pdfpal.db`. Two schema generations coexist:
- **v1 (legacy):** `sessions`, `messages`
- **v2 (current):** `projects`, `sources`, `chat_sessions`, `chat_messages`, `notes`, `artifacts`, `annotations`, `source_related`

### Frontend structure

`frontend/src/` -- React SPA with pages, components, hooks, and lib directories. Uses react-router-dom for routing.

## Notes

- PDF extraction is limited to 50 pages max
- Chat streams responses via SSE (`text/event-stream`)
- The chat endpoint shells out to `claude --print` with a 5-minute timeout
- CORS is restricted to `https://pdfpal.duckdns.org` in production

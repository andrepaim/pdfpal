# 📄 pdfpal

> An AI-powered research workspace. Organize papers into projects, chat across multiple sources, take notes, and generate artifacts — all self-hosted.

Powered by your local [Claude CLI](https://claude.ai/code) — no API costs beyond your Claude subscription.

---

## Features

- **Projects** — organize PDFs into research workspaces; rename, search, delete
- **Smart PDF resolver** — paste any URL: arXiv, OpenReview, ACL Anthology, PMLR, Nature, Springer, DOI links, or a direct `.pdf` URL; tracking params stripped automatically
- **Open-access fallback** — for paywalled URLs, automatically queries Semantic Scholar and Unpaywall for a free copy
- **Per-source chat** — read a PDF and chat with it in a split-pane viewer; conversation persists across sessions
- **Project chat** — chat across multiple sources simultaneously; toggle which sources are in context
- **Notes** — markdown editor with live preview, auto-save; scoped to a project
- **Artifacts** — save AI-generated outputs (summaries, analyses, etc.) as reusable documents
- **Chat history** — all conversations (per-source and project-level) are persisted and browsable from the Chats tab
- **Web search** — toggleable Tavily-powered search injects live results into every conversation
- **Text selection → chat** — select text in the PDF viewer, click to pre-fill the chat input
- **Inline renaming** — rename projects and sources in-place
- **Google OAuth** — private by default; only allowlisted emails can log in
- **Dark theme** — easy on the eyes

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| PDF rendering | react-pdf (pdfjs) |
| Markdown | react-markdown + remark-gfm |
| Backend | FastAPI + Python |
| Database | SQLite |
| PDF extraction | pdfplumber |
| AI | Claude CLI (`claude --print`) |
| Web search | [Tavily](https://tavily.com) |
| Auth | Google OAuth2 + JWT session cookie |

---

## Architecture

```
Browser (React SPA)
├── ProjectsPage       — list/create/delete projects
├── ProjectView        — sources / notes / artifacts / chats tabs
│   ├── SourcesTab     — add URLs, rename, delete sources
│   ├── NotesTab       — markdown notes with auto-save
│   ├── ArtifactsTab   — saved AI outputs
│   └── ChatsTab       — all chat sessions for this project
├── PaperReader        — split-pane PDF viewer + source chat
└── ProjectChat        — multi-source chat with source toggles
         │
         ▼
   FastAPI backend (port 8200)
         │
   ├── POST /extract                 → resolve URL + extract PDF text → save source
   ├── GET  /proxy-pdf?url=...       → CORS-safe PDF proxy
   ├── POST /chat                    → Tavily search + Claude CLI → SSE stream
   ├── GET  /projects                → CRUD for projects, sources, notes, artifacts
   ├── GET  /projects/{id}/chat      → project-level chat history
   ├── GET  /projects/{id}/chats     → list all chat sessions
   ├── GET  /projects/{id}/sources/{sid}/chat → source chat history
   ├── GET  /auth/google             → OAuth redirect
   ├── GET  /auth/google/callback    → OAuth callback + session cookie
   ├── GET  /auth/me                 → current user
   └── POST /auth/logout             → clear cookie
```

---

## Self-hosting

### Requirements

- Python 3.10+
- Node.js 18+
- [Claude CLI](https://claude.ai/code) installed and authenticated
- A Google Cloud project with OAuth 2.0 credentials
- (Optional) [Tavily API key](https://tavily.com) for web search

---

### 1. Clone

```bash
git clone https://github.com/andrepaim/pdfpal.git
cd pdfpal
```

---

### 2. Set up Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project
3. Navigate to **APIs & Services → Credentials**
4. Click **+ Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Under **Authorized redirect URIs**, add:
   ```
   https://your-domain.com/auth/google/callback
   ```
7. Note your **Client ID** and **Client Secret**

---

### 3. Configure environment

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
# AI
CLAUDE_BIN=/usr/local/bin/claude       # path to claude CLI binary

# Web search (optional)
TAVILY_API_KEY=your_tavily_key_here    # leave empty to disable web search

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
ALLOWED_EMAILS=you@gmail.com           # comma-separated allowlist

# Session
SESSION_SECRET=generate-a-random-secret-here   # openssl rand -hex 32
PUBLIC_URL=https://your-domain.com
```

---

### 4. Install dependencies

```bash
pip install -r backend/requirements.txt

cd frontend && npm install && npm run build && cd ..
```

---

### 5. Run

**Production:**
```bash
cd backend && uvicorn main:app --host 0.0.0.0 --port 8200
```

**Development (hot reload):**
```bash
# Terminal 1
cd backend && uvicorn main:app --reload --port 8200

# Terminal 2
cd frontend && npm run dev
```

---

### 6. Systemd service (Linux)

```bash
sudo cp clawd-reader.service /etc/systemd/system/
# Edit User, Group, and paths in the service file
sudo systemctl daemon-reload
sudo systemctl enable --now clawd-reader
```

---

### 7. Reverse proxy (Apache)

```apache
<VirtualHost *:443>
    ServerName your-domain.com
    SSLEngine On
    SSLCertificateFile    /etc/letsencrypt/live/your-domain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/your-domain.com/privkey.pem
    ProxyPreserveHost On
    ProxyTimeout 600
    ProxyPass        / http://127.0.0.1:8200/
    ProxyPassReverse / http://127.0.0.1:8200/
</VirtualHost>
```

---

### Deploy updates

```bash
bash deploy.sh
```

---

## Usage

1. Sign in with your allowlisted Google account
2. Create a **Project** for your research topic
3. Add sources by pasting a PDF URL (arXiv, DOI, direct PDF, etc.)
4. Click a source to open the **PDF viewer + chat**
5. Use **Project Chat** to ask questions across multiple sources at once
6. Take **Notes** in markdown — auto-saved
7. Save AI responses as **Artifacts** for later reference
8. Browse all past conversations in the **Chats** tab

---

## Limitations

- PDFs with more than **50 pages** are truncated
- **Scanned PDFs** (image-only, no text layer) return empty text — OCR not implemented
- Some publishers (ACM, Elsevier) block automated access; the resolver tries Semantic Scholar and Unpaywall as fallbacks but cannot bypass paywalls with no open-access version
- Claude CLI response is buffered — no true token-by-token streaming

---

## Roadmap

- [ ] RAG chunking for large PDFs (>50 pages)
- [ ] OCR for scanned PDFs (Claude vision)
- [ ] Highlight PDF passages cited in answers
- [ ] Export conversation as markdown
- [ ] True streaming (replace `claude --print` with direct API)
- [ ] Local LLM support (Ollama)

---

## License

MIT

# 📄 pdfpal

> Your AI-powered reading buddy. Load any PDF, ask questions, get web references — all in one clean interface.

A self-hosted web app that combines a PDF viewer with an AI chat interface. Point it at any PDF URL (or open a local file), and start asking questions. The AI has the full document in context and can search the web for references. Sessions are persisted so you can pick up where you left off.

Powered by your local [Claude CLI](https://claude.ai/code) — no API costs beyond your Claude subscription.

---

## Features

- **PDF rendering** — full viewer via `@react-pdf-viewer` with zoom, fit width/page, page navigation
- **Local file support** — open PDFs from disk via file picker
- **AI chat** — Claude has the full PDF text in context; maintains conversation history per session
- **Web search** — toggleable Tavily-powered web search injects results into the conversation
- **Text selection → chat** — select text in the PDF, click "💬 Ask about selection" to pre-fill chat
- **Session management** — sidebar with all past PDFs; sessions (PDF + chat history) persist in SQLite
- **Auto-restore** — last open session is restored on page reload
- **Resizable panels** — drag the divider between PDF and chat
- **Google OAuth** — private by default, only your allowlisted email gets in
- **Dark theme** — easy on the eyes

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| PDF rendering | [@react-pdf-viewer](https://react-pdf-viewer.dev/) |
| Markdown | react-markdown |
| Backend | FastAPI + Python |
| Database | SQLite (via built-in `sqlite3`) |
| PDF extraction | pdfplumber |
| AI | Claude CLI (`claude --print`) |
| Web search | [Tavily](https://tavily.com) |
| Auth | Google OAuth2 + JWT session cookie |

---

## Architecture

```
Browser
├── Sessions sidebar (SQLite-backed history)
├── Left panel: PDF Viewer (@react-pdf-viewer)
└── Right panel: AI Chat
         │
         ▼
   FastAPI backend (port 8200)
         │
   ├── GET  /proxy-pdf?url=...       → CORS-safe PDF proxy
   ├── POST /extract                 → pdfplumber text extraction (URL)
   ├── POST /extract-upload          → pdfplumber text extraction (file upload)
   ├── GET  /sessions                → list sessions
   ├── GET  /sessions/{id}           → get session + chat history
   ├── POST /sessions                → create session
   ├── DELETE /sessions/{id}         → delete session
   ├── POST /chat                    → Tavily search + Claude CLI → SSE
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

You need a Google OAuth 2.0 Client ID to enable login.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project
3. Navigate to **APIs & Services → Credentials**
4. Click **+ Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Under **Authorized redirect URIs**, add:
   ```
   https://your-domain.com/auth/google/callback
   ```
   (Replace `your-domain.com` with your actual domain or DuckDNS subdomain)
7. Click **Create** — note your **Client ID** and **Client Secret**

> If you already have an OAuth client (e.g. from another app on the same project), just add the new redirect URI to the existing client under **Edit → Authorized redirect URIs**.

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
ALLOWED_EMAILS=you@gmail.com           # comma-separated, only these emails can log in

# Session
SESSION_SECRET=generate-a-random-secret-here   # openssl rand -hex 32
PUBLIC_URL=https://your-domain.com
```

Generate a session secret:
```bash
openssl rand -hex 32
```

---

### 4. Install dependencies

```bash
# Backend
pip install -r backend/requirements.txt

# Frontend
cd frontend
npm install
npm run build
cd ..
```

---

### 5. Run

**Production (single process, serves frontend too):**
```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8200
```

**Development (with hot reload):**
```bash
# Terminal 1 — backend
cd backend && uvicorn main:app --reload --port 8200

# Terminal 2 — frontend dev server (proxies /api to backend)
cd frontend && npm run dev
```

---

### 6. Systemd service (Linux)

```bash
sudo cp clawd-reader.service /etc/systemd/system/
# Edit the service file to set correct User, Group, and paths
sudo systemctl daemon-reload
sudo systemctl enable --now clawd-reader
```

The service file expects the backend `.env` at `/path/to/pdfpal/backend/.env`.

Make sure the service user has write access to `backend/` (for the SQLite database):
```bash
chown -R youruser:yourgroup /path/to/pdfpal/backend
```

---

### 7. Reverse proxy (Apache example)

```apache
<VirtualHost *:443>
    ServerName your-domain.com

    SSLEngine On
    SSLCertificateFile    /etc/letsencrypt/live/your-domain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/your-domain.com/privkey.pem

    ProxyPreserveHost On
    ProxyTimeout 300
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

1. Open the app — you'll be prompted to sign in with Google
2. After login, paste a PDF URL in the top bar and press **Enter** or click **Load**
3. Or click **📂 Open file** to load a local PDF
4. The PDF renders on the left; text is extracted automatically
5. Chat on the right — ask questions about the document
6. Toggle **🔍 Web Search** on/off to include live web results
7. Select text in the PDF → click **💬 Ask about selection** to quote it in chat
8. Past sessions are listed in the sidebar (☰) — click to restore any session

---

## Limitations

- PDFs with more than **50 pages** are not supported yet
- **Scanned PDFs** (no text layer) return empty or partial text — OCR not yet implemented
- Local files can't be auto-restored on page reload (browser security) — only the chat history is restored; you'll need to re-open the file
- Claude CLI response is buffered (no true streaming — `--print` waits for full output)

---

## Roadmap

- [ ] OCR for scanned PDFs (Claude vision)
- [ ] RAG chunking for large PDFs (>50 pages)
- [ ] Multiple PDF tabs
- [ ] Export conversation as markdown
- [ ] Highlight PDF passages cited in answers
- [ ] True streaming (replace `claude --print` with API)
- [ ] Local LLM support (Ollama)

---

## License

MIT

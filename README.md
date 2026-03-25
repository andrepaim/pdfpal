# 📄 pdfpal

> Your AI-powered reading buddy. Load any PDF, ask questions, get web references — all in one clean interface.

![pdfpal screenshot](https://pdfpal.duckdns.org)

## What it does

pdfpal is a self-hosted web app that combines a PDF viewer with an AI chat interface. Point it at any PDF URL, and you can immediately start asking questions about the document. The AI has the full document in context and can also search the web for references, related papers, or additional information.

Powered by your local [Claude](https://claude.ai) CLI — no API costs, no data leaving your machine (except for web search queries).

---

## Features

- **PDF rendering** — renders all pages side-by-side using pdf.js, straight in the browser
- **AI chat** — ask anything about the document; Claude has the full text in context
- **Web search** — toggleable Brave/Tavily-powered web search injects relevant results into the conversation
- **Conversation history** — maintains context across multiple messages in a session
- **Streaming responses** — answers appear as soon as Claude finishes (SSE)
- **Markdown rendering** — assistant responses render with full markdown support
- **50-page limit** — clear error message for oversized PDFs (no silent failures)
- **Dark theme** — easy on the eyes for long reading sessions

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind CSS |
| PDF rendering | [pdf.js](https://mozilla.github.io/pdf.js/) (pdfjs-dist) |
| Markdown | react-markdown |
| Backend | FastAPI + Python |
| PDF extraction | pdfplumber |
| AI | Claude CLI (`claude --print`) |
| Web search | [Tavily](https://tavily.com) |
| HTTP client | httpx |

---

## Architecture

```
Browser (split view)
├── Left (55%): PDF Viewer — pdf.js renders pages from proxied URL
└── Right (45%): Chat Panel — message history + input + web search toggle
         │
         ▼
   FastAPI backend (port 8200)
         │
   ├── GET  /proxy-pdf?url=...     → proxies PDF bytes (CORS bypass)
   ├── POST /extract               → pdfplumber extracts text (50 page limit)
   └── POST /chat                  → optional Tavily search → Claude CLI → SSE
```

The backend proxies the PDF to avoid CORS issues in the browser. Text extraction happens server-side via pdfplumber and is passed as context in every chat request.

---

## Self-hosting

### Requirements

- Python 3.10+
- Node.js 18+
- [Claude CLI](https://claude.ai/code) installed and authenticated
- (Optional) [Tavily API key](https://tavily.com) for web search

### Setup

```bash
git clone https://github.com/andrepaim/pdfpal.git
cd pdfpal

# Backend
pip install -r backend/requirements.txt

cp backend/.env.example backend/.env
# Edit backend/.env with your keys

# Frontend
cd frontend
npm install
npm run build
cd ..
```

### Environment variables

```env
# backend/.env
TAVILY_API_KEY=your_tavily_key_here   # optional, disables web search if missing
CLAUDE_BIN=/usr/local/bin/claude      # path to claude CLI binary
```

### Run

```bash
# Development
cd frontend && npm run dev &           # Vite dev server on :5173
cd backend && uvicorn main:app --reload --port 8200

# Production
cd frontend && npm run build
uvicorn backend.main:app --host 0.0.0.0 --port 8200
```

The backend serves the frontend's `dist/` folder at `/`, so in production a single process handles everything.

### Systemd service (Linux)

```bash
sudo cp clawd-reader.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now clawd-reader
```

Edit `clawd-reader.service` to set the correct `User` and paths for your system.

### Deploy updates

```bash
bash deploy.sh
```

---

## Usage

1. Open the app in your browser
2. Paste a PDF URL into the top bar and click **Load** (or press Enter)
3. The PDF renders on the left; text is extracted in the background
4. Type your question in the chat on the right
5. Toggle **🔍 Web Search** on/off to include web results in the answer
6. Press **Enter** to send (Shift+Enter for newlines)

---

## Limitations

- PDFs with more than **50 pages** are not supported yet
- **Scanned PDFs** (image-only, no text layer) will return empty or partial text — OCR support planned
- Response speed depends on Claude CLI performance on your machine
- Web search uses Tavily's free tier (limited requests/month)

---

## Roadmap

- [ ] OCR support for scanned PDFs (pdf2image + Claude vision)
- [ ] RAG-style chunking for large PDFs (>50 pages)
- [ ] Multiple PDF tabs
- [ ] Export conversation as markdown
- [ ] Highlight PDF passages referenced in answers
- [ ] Local LLM support (Ollama)

---

## License

MIT

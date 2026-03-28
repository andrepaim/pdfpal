import asyncio
import io
import os
import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path

import httpx
import pdfplumber
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional

load_dotenv()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
CLAUDE_BIN = os.getenv("CLAUDE_BIN", "/root/.local/bin/claude")
DB_PATH = Path(__file__).parent / "pdfpal.db"

from db import get_db as _get_db_shared

# Auth imports
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse as _JSONResponse, RedirectResponse as _RedirectResponse
from auth import verify_session_token, SESSION_COOKIE, router as auth_router
from pdf_resolver import resolve_pdf_url

class AuthMiddleware(BaseHTTPMiddleware):
    # Paths that don't require auth
    PUBLIC_PREFIXES = ["/auth/", "/assets/", "/favicon", "/pdf.worker"]
    PUBLIC_EXACT = ["/"]

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Only protect /api/* paths — everything else passes through to SPA/static
        if not path.startswith("/api/") and not path.startswith("/auth/"):
            return await call_next(request)

        if (any(path.startswith(p) for p in self.PUBLIC_PREFIXES)
                or path in self.PUBLIC_EXACT
                or path.startswith("/assets")):
            return await call_next(request)

        token = request.cookies.get(SESSION_COOKIE)
        user = verify_session_token(token) if token else None
        if not user:
            # Browser navigation → redirect to login page
            if "text/html" in request.headers.get("accept", ""):
                return _RedirectResponse(url="/?login=1", status_code=302)
            return _JSONResponse({"detail": "Unauthorized"}, status_code=401)

        request.state.user = user
        return await call_next(request)

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT,
                pdf_url TEXT,
                pdf_filename TEXT,
                pdf_text TEXT,
                pages INTEGER DEFAULT 0,
                created_at TEXT,
                accessed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
        """)

init_db()

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="pdfpal")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://pdfpal.duckdns.org"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)

router = APIRouter()

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ExtractRequest(BaseModel):
    url: str
    session_id: Optional[str] = None   # legacy v1
    project_id: Optional[str] = None   # v2: create source in this project
    source_id: Optional[str] = None    # v2: update existing source

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    pdf_text: str
    pdf_url: str
    session_id: Optional[str] = None       # v1 legacy
    project_id: Optional[str] = None       # v2
    source_id: Optional[str] = None        # v2
    active_source_ids: Optional[List[str]] = None  # v2 project-level chat
    conversation_history: List[ChatMessage] = []
    search_web: bool = True

class CreateSessionRequest(BaseModel):
    pdf_url: Optional[str] = None
    pdf_filename: Optional[str] = None
    title: Optional[str] = None
    pdf_text: Optional[str] = None
    pages: Optional[int] = 0

# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def now_iso():
    return datetime.utcnow().isoformat()

def session_to_dict(row) -> dict:
    d = dict(row)
    d.pop("pdf_text", None)  # don't send full text in list
    return d

def touch_session(session_id: str):
    try:
        with get_db() as conn:
            conn.execute("UPDATE sessions SET accessed_at=? WHERE id=?", (now_iso(), session_id))
    except Exception:
        pass  # non-fatal

# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get("/health")
def health():
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# Sessions CRUD
# ---------------------------------------------------------------------------

@router.get("/sessions")
def list_sessions():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, pdf_url, pdf_filename, pages, created_at, accessed_at "
            "FROM sessions ORDER BY accessed_at DESC LIMIT 50"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/sessions")
def create_session(req: CreateSessionRequest):
    session_id = str(uuid.uuid4())
    ts = now_iso()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sessions (id, title, pdf_url, pdf_filename, pdf_text, pages, created_at, accessed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (session_id, req.title, req.pdf_url, req.pdf_filename, req.pdf_text, req.pages, ts, ts)
        )
    return {"session_id": session_id}


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")
        messages = conn.execute(
            "SELECT role, content, created_at FROM messages WHERE session_id=? ORDER BY id ASC",
            (session_id,)
        ).fetchall()
        touch_session(session_id)
    return {
        **dict(row),
        "messages": [dict(m) for m in messages],
    }


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))
    return {"ok": True}


@router.patch("/sessions/{session_id}")
def update_session(session_id: str, req: CreateSessionRequest):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")
        conn.execute(
            "UPDATE sessions SET title=COALESCE(?,title), pdf_url=COALESCE(?,pdf_url), "
            "pdf_filename=COALESCE(?,pdf_filename), pdf_text=COALESCE(?,pdf_text), "
            "pages=COALESCE(?,pages), accessed_at=? WHERE id=?",
            (req.title, req.pdf_url, req.pdf_filename, req.pdf_text, req.pages, now_iso(), session_id)
        )
    return {"ok": True}

# ---------------------------------------------------------------------------
# PDF proxy + extraction
# ---------------------------------------------------------------------------

@router.get("/proxy-pdf")
async def proxy_pdf(url: str):
    try:
        pdf_bytes, _ = await resolve_pdf_url(url)
        return Response(content=pdf_bytes, media_type="application/pdf")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch PDF: {e}")


def _extract_pdf_bytes(pdf_bytes: bytes) -> dict:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page_count = len(pdf.pages)
        if page_count > 50:
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "PDF too large",
                    "message": f"PDFs with more than 50 pages are not supported yet. This PDF has {page_count} pages.",
                },
            )
        text_parts = []
        for i, page in enumerate(pdf.pages):
            page_text = page.extract_text() or ""
            if page_text.strip():
                text_parts.append(f"[Page {i+1}]\n{page_text}")
        meta_title = (pdf.metadata or {}).get("Title", "").strip()
        # Filter out garbage metadata titles (e.g. "Microsoft Word - paper.docx")
        if meta_title and (
            meta_title.lower().startswith("microsoft word")
            or meta_title.lower().startswith("untitled")
            or len(meta_title) > 200
        ):
            meta_title = ""

        # If no usable metadata title, extract from page text
        if not meta_title and text_parts:
            lines = [l.strip() for l in text_parts[0].split("\n") if l.strip()]
            # Skip [Page N] markers and boilerplate lines
            candidates = []
            for l in lines:
                if l.startswith("[Page"):
                    continue
                # Skip boilerplate: no spaces (run-together words), all-caps short, URLs, emails
                has_spaces = " " in l
                looks_like_url = l.startswith("http") or "@" in l
                is_runon = not has_spaces and len(l) > 20
                is_too_long = len(l) > 150
                is_legal = any(kw in l.lower() for kw in [
                    "permission", "reproduce", "copyright", "©", "licens",
                    "doi:", "arxiv:", "preprint", "all rights reserved",
                ])
                if looks_like_url or is_runon or is_too_long or is_legal:
                    continue
                candidates.append(l)

            # Prefer a line that looks like a title: mixed case, reasonable length
            title_candidate = ""
            for l in candidates[:10]:
                word_count = len(l.split())
                if 2 <= word_count <= 20 and len(l) <= 120:
                    title_candidate = l
                    break
            meta_title = title_candidate[:120] if title_candidate else (candidates[0][:120] if candidates else "")

        return {"text": "\n\n".join(text_parts), "pages": page_count, "title": meta_title}


@router.post("/extract-upload")
async def extract_upload(file: UploadFile = File(...), session_id: Optional[str] = None):
    pdf_bytes = await file.read()
    try:
        result = _extract_pdf_bytes(pdf_bytes)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF: {e}")

    result["filename"] = file.filename

    # Create or update session
    if session_id:
        with get_db() as conn:
            conn.execute(
                "UPDATE sessions SET title=?, pdf_filename=?, pdf_text=?, pages=?, accessed_at=? WHERE id=?",
                (result["title"] or file.filename, file.filename, result["text"], result["pages"], now_iso(), session_id)
            )
        result["session_id"] = session_id
    else:
        sid = str(uuid.uuid4())
        ts = now_iso()
        with get_db() as conn:
            conn.execute(
                "INSERT INTO sessions (id, title, pdf_filename, pdf_text, pages, created_at, accessed_at) VALUES (?,?,?,?,?,?,?)",
                (sid, result["title"] or file.filename, file.filename, result["text"], result["pages"], ts, ts)
            )
        result["session_id"] = sid

    return result


@router.post("/extract")
async def extract(req: ExtractRequest):
    try:
        pdf_bytes, resolved_url = await resolve_pdf_url(req.url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch PDF: {e}")

    # Use resolved URL for session storage (the actual PDF URL, not the abstract page)
    canonical_url = resolved_url

    try:
        result = _extract_pdf_bytes(pdf_bytes)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF: {e}")

    result["pdf_url"] = canonical_url
    result["original_url"] = req.url
    title = result["title"] or _url_fallback_title(canonical_url)
    ts = now_iso()

    # ── v2: project-based flow ────────────────────────────────────────────────
    if req.project_id:
        if req.source_id:
            # Update existing source
            with get_db() as conn:
                conn.execute(
                    "UPDATE sources SET title=?, url=?, pdf_text=?, pages=?, accessed_at=? WHERE id=? AND project_id=?",
                    (title, canonical_url, result["text"], result["pages"], ts, req.source_id, req.project_id)
                )
            result["source_id"] = req.source_id
            result["project_id"] = req.project_id
        else:
            # Create new source in project
            sid = str(uuid.uuid4())
            with get_db() as conn:
                conn.execute(
                    "INSERT INTO sources (id, project_id, type, url, title, pdf_text, pages, created_at, accessed_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (sid, req.project_id, "pdf", canonical_url, title, result["text"], result["pages"], ts, ts)
                )
                # Touch the project's accessed_at
                conn.execute("UPDATE projects SET accessed_at=? WHERE id=?", (ts, req.project_id))
            result["source_id"] = sid
            result["project_id"] = req.project_id
        return result

    # ── v1 legacy: session-based flow (keep working) ─────────────────────────
    if req.session_id:
        with get_db() as conn:
            conn.execute(
                "UPDATE sessions SET title=?, pdf_url=?, pdf_text=?, pages=?, accessed_at=? WHERE id=?",
                (title, canonical_url, result["text"], result["pages"], ts, req.session_id)
            )
        result["session_id"] = req.session_id
    else:
        sid = str(uuid.uuid4())
        with get_db() as conn:
            conn.execute(
                "INSERT INTO sessions (id, title, pdf_url, pdf_text, pages, created_at, accessed_at) VALUES (?,?,?,?,?,?,?)",
                (sid, title, canonical_url, result["text"], result["pages"], ts, ts)
            )
        result["session_id"] = sid

    return result

# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

def _url_fallback_title(url: str) -> str:
    from urllib.parse import urlparse
    parsed = urlparse(url)
    # e.g. "arxiv.org · 2403.02545v1"
    path_part = parsed.path.rstrip("/").split("/")[-1]
    return f"{parsed.netloc} · {path_part}" if path_part else parsed.netloc


async def tavily_search(query: str) -> str:
    if not TAVILY_API_KEY:
        return ""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://api.tavily.com/search",
                json={"api_key": TAVILY_API_KEY, "query": query, "max_results": 5},
            )
            r.raise_for_status()
            data = r.json()
            results = data.get("results", [])
            if not results:
                return ""
            lines = ["Web search results:"]
            for res in results:
                lines.append(f"- [{res.get('title','')}]({res.get('url','')}): {res.get('content','')[:300]}")
            return "\n".join(lines)
    except Exception:
        return ""


@router.post("/chat")
async def chat(req: ChatRequest):
    web_context = ""
    if req.search_web:
        web_context = await tavily_search(req.message)

    history_text = ""
    for msg in req.conversation_history[-10:]:
        prefix = "User" if msg.role == "user" else "Assistant"
        history_text += f"{prefix}: {msg.content}\n\n"

    system_prompt = f"""You are a helpful AI assistant analyzing a PDF document.

PDF Source: {req.pdf_url}

PDF Content:
---
{req.pdf_text[:80000]}
---
"""
    if web_context:
        system_prompt += f"\n{web_context}\n"

    full_prompt = system_prompt
    if history_text:
        full_prompt += f"\nConversation so far:\n{history_text}"
    full_prompt += f"\nUser: {req.message}\n\nAssistant:"

    # ── Persist user message ─────────────────────────────────────────────────
    chat_session_id = None

    if req.project_id and req.source_id:
        # v2: find or create a chat_session for this source
        ts = now_iso()
        with get_db() as conn:
            row = conn.execute(
                "SELECT id FROM chat_sessions WHERE project_id=? AND source_id=? ORDER BY created_at DESC LIMIT 1",
                (req.project_id, req.source_id)
            ).fetchone()
            if row:
                chat_session_id = row["id"]
            else:
                chat_session_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO chat_sessions (id, project_id, source_id, title, created_at, accessed_at) VALUES (?,?,?,?,?,?)",
                    (chat_session_id, req.project_id, req.source_id, "Chat", ts, ts)
                )
            conn.execute(
                "INSERT INTO chat_messages (session_id, role, content, sources_used, created_at) VALUES (?,?,?,?,?)",
                (chat_session_id, "user", req.message, "[]", ts)
            )
    elif req.project_id and not req.source_id:
        # v2: project-level chat (source_id=NULL)
        ts = now_iso()
        source_ids_json = json.dumps(list(req.active_source_ids or []))
        with get_db() as conn:
            row = conn.execute(
                "SELECT id FROM chat_sessions WHERE project_id=? AND source_id IS NULL ORDER BY accessed_at DESC LIMIT 1",
                (req.project_id,)
            ).fetchone()
            if row:
                chat_session_id = row["id"]
                conn.execute("UPDATE chat_sessions SET accessed_at=? WHERE id=?", (ts, chat_session_id))
            else:
                chat_session_id = str(uuid.uuid4())
                conn.execute(
                    "INSERT INTO chat_sessions (id, project_id, source_id, title, created_at, accessed_at) VALUES (?,?,?,?,?,?)",
                    (chat_session_id, req.project_id, None, "Project Chat", ts, ts)
                )
            conn.execute(
                "INSERT INTO chat_messages (session_id, role, content, sources_used, created_at) VALUES (?,?,?,?,?)",
                (chat_session_id, "user", req.message, source_ids_json, ts)
            )
    elif req.session_id:
        # v1 legacy
        ts = now_iso()
        with get_db() as conn:
            conn.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)",
                (req.session_id, "user", req.message, ts)
            )
            touch_session(req.session_id)

    async def generate():
        assistant_text = ""
        try:
            proc = await asyncio.create_subprocess_exec(
                CLAUDE_BIN, "--print",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(
                    proc.communicate(input=full_prompt.encode()),
                    timeout=300  # 5 min hard cap
                )
            except asyncio.TimeoutError:
                proc.kill()
                yield f"data: {json.dumps({'text': '⚠️ Request timed out. Try a shorter question or smaller PDF.'})}\n\n"
                yield "data: [DONE]\n\n"
                return
            assistant_text = stdout.decode().strip()
            stderr_text = stderr.decode().strip()

            # Detect Claude API errors in stdout (it prints JSON error objects)
            if '"type":"error"' in assistant_text or '"api_error"' in assistant_text:
                assistant_text = "⚠️ Claude API returned an error (likely a transient server issue). Please try again."
            elif not assistant_text and stderr_text:
                assistant_text = f"Error: {stderr_text}"

            # Save assistant message
            if assistant_text:
                ts2 = now_iso()
                if chat_session_id:
                    sources_tag = json.dumps(list(req.active_source_ids or [])) if (req.project_id and not req.source_id) else "[]"
                    with get_db() as conn:
                        conn.execute(
                            "INSERT INTO chat_messages (session_id, role, content, sources_used, created_at) VALUES (?,?,?,?,?)",
                            (chat_session_id, "assistant", assistant_text, sources_tag, ts2)
                        )
                elif req.session_id:
                    with get_db() as conn:
                        conn.execute(
                            "INSERT INTO messages (session_id, role, content, created_at) VALUES (?,?,?,?)",
                            (req.session_id, "assistant", assistant_text, ts2)
                        )

            yield f"data: {json.dumps({'text': assistant_text})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ── v2 chat history ───────────────────────────────────────────────────────────

@router.get("/projects/{project_id}/sources/{source_id}/chat")
def get_source_chat(project_id: str, source_id: str):
    with get_db() as conn:
        session = conn.execute(
            "SELECT id FROM chat_sessions WHERE project_id=? AND source_id=? ORDER BY created_at DESC LIMIT 1",
            (project_id, source_id)
        ).fetchone()
        if not session:
            return {"messages": []}
        messages = conn.execute(
            "SELECT role, content, sources_used, created_at FROM chat_messages WHERE session_id=? ORDER BY id ASC",
            (session["id"],)
        ).fetchall()
    return {"messages": [dict(m) for m in messages]}


@router.get("/projects/{project_id}/chat")
def get_project_chat(project_id: str):
    """Project-level chat history (source_id IS NULL)."""
    with get_db() as conn:
        session = conn.execute(
            "SELECT id FROM chat_sessions WHERE project_id=? AND source_id IS NULL ORDER BY accessed_at DESC LIMIT 1",
            (project_id,)
        ).fetchone()
        if not session:
            return {"messages": []}
        messages = conn.execute(
            "SELECT role, content, sources_used, created_at FROM chat_messages WHERE session_id=? ORDER BY id ASC",
            (session["id"],)
        ).fetchall()
    rows = []
    for m in messages:
        d = dict(m)
        try:
            d["sources_used"] = json.loads(d["sources_used"] or "[]")
        except Exception:
            d["sources_used"] = []
        rows.append(d)
    return {"messages": rows}


@router.delete("/projects/{project_id}/sources/{source_id}/chat")
def clear_source_chat(project_id: str, source_id: str):
    """Delete all messages for the source's chat session."""
    with get_db() as conn:
        session = conn.execute(
            "SELECT id FROM chat_sessions WHERE project_id=? AND source_id=? ORDER BY created_at DESC LIMIT 1",
            (project_id, source_id)
        ).fetchone()
        if session:
            conn.execute("DELETE FROM chat_messages WHERE session_id=?", (session["id"],))
            conn.execute("DELETE FROM chat_sessions WHERE id=?", (session["id"],))
    return {"ok": True}


@router.delete("/projects/{project_id}/chat")
def clear_project_chat(project_id: str):
    """Delete the project-level chat session and all messages."""
    with get_db() as conn:
        session = conn.execute(
            "SELECT id FROM chat_sessions WHERE project_id=? AND source_id IS NULL ORDER BY accessed_at DESC LIMIT 1",
            (project_id,)
        ).fetchone()
        if session:
            conn.execute("DELETE FROM chat_messages WHERE session_id=?", (session["id"],))
            conn.execute("DELETE FROM chat_sessions WHERE id=?", (session["id"],))
    return {"ok": True}


@router.get("/projects/{project_id}/chats")
def list_project_chats(project_id: str):
    """List all chat sessions for a project (source + project-level)."""
    with get_db() as conn:
        sessions = conn.execute(
            "SELECT cs.id, cs.source_id, cs.title, cs.created_at, cs.accessed_at, "
            "  s.title as source_title, "
            "  (SELECT COUNT(*) FROM chat_messages WHERE session_id=cs.id) as message_count, "
            "  (SELECT content FROM chat_messages WHERE session_id=cs.id AND role='user' ORDER BY id LIMIT 1) as first_message "
            "FROM chat_sessions cs "
            "LEFT JOIN sources s ON s.id=cs.source_id "
            "WHERE cs.project_id=? "
            "ORDER BY cs.accessed_at DESC",
            (project_id,)
        ).fetchall()
    return [dict(s) for s in sessions]

# Auth routes — registered under both /auth and /api/auth
app.include_router(auth_router)
app.include_router(auth_router, prefix="/api")

# v2 project routes (only under /api — not at root to avoid clashing with SPA routes)
from routes.projects import router as projects_router
app.include_router(projects_router, prefix="/api")

# API routes under both /api and /
app.include_router(router, prefix="/api")
app.include_router(router, prefix="")

# SPA catch-all — serve index.html for all non-API routes (react-router handles them)
from fastapi.responses import FileResponse as _FileResponse

frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str, request: Request):
        # Static assets (JS, CSS, images, fonts) — try to serve from dist directly
        static_extensions = ('.js', '.css', '.png', '.svg', '.ico', '.woff', '.woff2', '.mjs', '.json', '.webmanifest', '.txt', '.map')
        if any(full_path.endswith(ext) for ext in static_extensions):
            file_path = frontend_dist / full_path
            if file_path.exists():
                return _FileResponse(str(file_path))
            from fastapi.responses import Response as _Response
            return _Response(status_code=404)
        # Everything else → SPA index.html
        index = frontend_dist / "index.html"
        if index.exists():
            return _FileResponse(str(index), media_type="text/html")
        return _JSONResponse({"detail": "Not Found"}, status_code=404)

    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="static")

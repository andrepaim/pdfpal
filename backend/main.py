import asyncio
import io
import os
import json
from pathlib import Path

import httpx
import pdfplumber
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List

load_dotenv()

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
CLAUDE_BIN = os.getenv("CLAUDE_BIN", "/root/.local/bin/claude")

app = FastAPI(title="Clawd Reader")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Router handles all API endpoints — registered under both / and /api/
router = APIRouter()


class ExtractRequest(BaseModel):
    url: str


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    pdf_text: str
    pdf_url: str
    conversation_history: List[ChatMessage] = []
    search_web: bool = True


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/proxy-pdf")
async def proxy_pdf(url: str):
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        try:
            r = await client.get(url)
            r.raise_for_status()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch PDF: {e}")
    return Response(content=r.content, media_type="application/pdf")


@router.post("/extract-upload")
async def extract_upload(file: UploadFile = File(...)):
    pdf_bytes = await file.read()
    try:
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
            title = pdf.metadata.get("Title", "") if pdf.metadata else ""
            full_text = "\n\n".join(text_parts)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF: {e}")

    return {"text": full_text, "pages": page_count, "title": title, "filename": file.filename}


@router.post("/extract")
async def extract(req: ExtractRequest):
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        try:
            r = await client.get(req.url)
            r.raise_for_status()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch PDF: {e}")

    pdf_bytes = r.content
    try:
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
            title = pdf.metadata.get("Title", "") if pdf.metadata else ""
            full_text = "\n\n".join(text_parts)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF: {e}")

    return {"text": full_text, "pages": page_count, "title": title}


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

    async def generate():
        try:
            proc = await asyncio.create_subprocess_exec(
                CLAUDE_BIN, "--print",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate(input=full_prompt.encode())
            text = stdout.decode().strip()
            if not text and stderr:
                text = f"Error: {stderr.decode().strip()}"
            yield f"data: {json.dumps({'text': text})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# Register routes under both /api (production via Apache) and / (direct access)
app.include_router(router, prefix="/api")
app.include_router(router, prefix="")

# Serve frontend static files (must be last)
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="static")

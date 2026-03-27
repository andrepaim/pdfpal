'Projects CRUD + sources CRUD'
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime
from db import get_db

router = APIRouter(prefix="/projects", tags=["projects"])

def now():
    return datetime.utcnow().isoformat()

# ── Models ────────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    title: str
    description: Optional[str] = ""

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None

class SourceCreate(BaseModel):
    url: Optional[str] = None
    title: Optional[str] = None
    type: Optional[str] = "pdf"   # pdf | text
    content: Optional[str] = None  # for type=text

# ── Projects ─────────────────────────────────────────────────────────────────

@router.get("")
def list_projects():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT p.id, p.title, p.description, p.created_at, p.accessed_at, "
            "  (SELECT COUNT(*) FROM sources WHERE project_id=p.id) as source_count, "
            "  (SELECT COUNT(*) FROM notes WHERE project_id=p.id) as note_count, "
            "  (SELECT COUNT(*) FROM artifacts WHERE project_id=p.id) as artifact_count, "
            "  (SELECT COUNT(*) FROM chat_sessions WHERE project_id=p.id) as chat_count "
            "FROM projects p ORDER BY p.accessed_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("")
def create_project(req: ProjectCreate):
    pid = str(uuid.uuid4())
    ts = now()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO projects (id, title, description, created_at, accessed_at) VALUES (?,?,?,?,?)",
            (pid, req.title.strip(), req.description or "", ts, ts)
        )
    return {"id": pid, "title": req.title, "description": req.description, "created_at": ts, "accessed_at": ts}


@router.get("/{project_id}")
def get_project(project_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.execute("UPDATE projects SET accessed_at=? WHERE id=?", (now(), project_id))
    return dict(row)


@router.patch("/{project_id}")
def update_project(project_id: str, req: ProjectUpdate):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        updates, params = [], []
        if req.title is not None:
            updates.append("title=?"); params.append(req.title)
        if req.description is not None:
            updates.append("description=?"); params.append(req.description)
        updates.append("accessed_at=?"); params.append(now())
        params.append(project_id)
        conn.execute(f"UPDATE projects SET {', '.join(updates)} WHERE id=?", params)
    return {"ok": True}


@router.delete("/{project_id}")
def delete_project(project_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
    return {"ok": True}


# ── Sources ───────────────────────────────────────────────────────────────────

@router.get("/{project_id}/sources")
def list_sources(project_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, project_id, type, url, title, pages, created_at, accessed_at "
            "FROM sources WHERE project_id=? ORDER BY created_at DESC",
            (project_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/{project_id}/sources/{source_id}")
def get_source(project_id: str, source_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM sources WHERE id=? AND project_id=?",
            (source_id, project_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Source not found")
        conn.execute("UPDATE sources SET accessed_at=? WHERE id=?", (now(), source_id))
    return dict(row)


@router.delete("/{project_id}/sources/{source_id}")
def delete_source(project_id: str, source_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM sources WHERE id=? AND project_id=?", (source_id, project_id))
    return {"ok": True}


# ── Notes ─────────────────────────────────────────────────────────────────────

class NoteCreate(BaseModel):
    title: Optional[str] = "Untitled Note"
    content: Optional[str] = ""
    source_id: Optional[str] = None

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


@router.get("/{project_id}/notes")
def list_notes(project_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, project_id, source_id, title, substr(content,1,200) as preview, created_at, updated_at "
            "FROM notes WHERE project_id=? ORDER BY updated_at DESC",
            (project_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/{project_id}/notes")
def create_note(project_id: str, req: NoteCreate):
    nid = str(uuid.uuid4())
    ts = now()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO notes (id, project_id, source_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
            (nid, project_id, req.source_id, req.title, req.content, ts, ts)
        )
    return {"id": nid}


@router.get("/{project_id}/notes/{note_id}")
def get_note(project_id: str, note_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM notes WHERE id=? AND project_id=?", (note_id, project_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note not found")
    return dict(row)


@router.put("/{project_id}/notes/{note_id}")
def update_note(project_id: str, note_id: str, req: NoteUpdate):
    ts = now()
    with get_db() as conn:
        updates, params = [], []
        if req.title is not None:
            updates.append("title=?"); params.append(req.title)
        if req.content is not None:
            updates.append("content=?"); params.append(req.content)
        updates.append("updated_at=?"); params.append(ts)
        params.extend([note_id, project_id])
        conn.execute(f"UPDATE notes SET {', '.join(updates)} WHERE id=? AND project_id=?", params)
    return {"ok": True}


@router.delete("/{project_id}/notes/{note_id}")
def delete_note(project_id: str, note_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM notes WHERE id=? AND project_id=?", (note_id, project_id))
    return {"ok": True}


# ── Artifacts ─────────────────────────────────────────────────────────────────

class ArtifactCreate(BaseModel):
    title: Optional[str] = "Untitled Artifact"
    content: str

class ArtifactUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


@router.get("/{project_id}/artifacts")
def list_artifacts(project_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, project_id, title, substr(content,1,200) as preview, created_at, updated_at "
            "FROM artifacts WHERE project_id=? ORDER BY updated_at DESC",
            (project_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/{project_id}/artifacts")
def create_artifact(project_id: str, req: ArtifactCreate):
    aid = str(uuid.uuid4())
    ts = now()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO artifacts (id, project_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (aid, project_id, req.title, req.content, ts, ts)
        )
    return {"id": aid}


@router.get("/{project_id}/artifacts/{artifact_id}")
def get_artifact(project_id: str, artifact_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM artifacts WHERE id=? AND project_id=?", (artifact_id, project_id)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Artifact not found")
    return dict(row)


@router.put("/{project_id}/artifacts/{artifact_id}")
def update_artifact(project_id: str, artifact_id: str, req: ArtifactUpdate):
    ts = now()
    with get_db() as conn:
        updates, params = [], []
        if req.title is not None:
            updates.append("title=?"); params.append(req.title)
        if req.content is not None:
            updates.append("content=?"); params.append(req.content)
        updates.append("updated_at=?"); params.append(ts)
        params.extend([artifact_id, project_id])
        conn.execute(f"UPDATE artifacts SET {', '.join(updates)} WHERE id=? AND project_id=?", params)
    return {"ok": True}


@router.delete("/{project_id}/artifacts/{artifact_id}")
def delete_artifact(project_id: str, artifact_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM artifacts WHERE id=? AND project_id=?", (artifact_id, project_id))
    return {"ok": True}

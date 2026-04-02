'Annotations CRUD — highlights on PDF sources'
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid
from datetime import datetime
from db import get_db

router = APIRouter(prefix="/projects", tags=["annotations"])

VALID_COLORS = {'yellow', 'green', 'blue', 'pink'}

def now():
    return datetime.utcnow().isoformat()

class AnnotationCreate(BaseModel):
    page_number: int
    x1: float
    y1: float
    x2: float
    y2: float
    text: str
    color: Optional[str] = 'yellow'

class AnnotationUpdate(BaseModel):
    color: Optional[str] = None

# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/{project_id}/sources/{source_id}/annotations")
def list_annotations(project_id: str, source_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM annotations WHERE source_id=? AND project_id=? ORDER BY page_number, y1",
            (source_id, project_id)
        ).fetchall()
    return [dict(r) for r in rows]

# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/{project_id}/sources/{source_id}/annotations")
def create_annotation(project_id: str, source_id: str, body: AnnotationCreate):
    color = body.color if body.color in VALID_COLORS else 'yellow'
    ann_id = str(uuid.uuid4())
    created = now()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO annotations (id, source_id, project_id, page_number, x1, y1, x2, y2, text, color, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (ann_id, source_id, project_id, body.page_number,
             body.x1, body.y1, body.x2, body.y2, body.text, color, created)
        )
        row = conn.execute("SELECT * FROM annotations WHERE id=?", (ann_id,)).fetchone()
    return dict(row)

# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{project_id}/sources/{source_id}/annotations/{annotation_id}", status_code=204)
def delete_annotation(project_id: str, source_id: str, annotation_id: str):
    with get_db() as conn:
        result = conn.execute(
            "DELETE FROM annotations WHERE id=? AND source_id=? AND project_id=?",
            (annotation_id, source_id, project_id)
        )
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Annotation not found")

# ── Update color ──────────────────────────────────────────────────────────────

@router.patch("/{project_id}/sources/{source_id}/annotations/{annotation_id}")
def update_annotation(project_id: str, source_id: str, annotation_id: str, body: AnnotationUpdate):
    if body.color and body.color not in VALID_COLORS:
        raise HTTPException(status_code=400, detail=f"Invalid color. Use one of: {VALID_COLORS}")
    with get_db() as conn:
        if body.color:
            conn.execute(
                "UPDATE annotations SET color=? WHERE id=? AND source_id=? AND project_id=?",
                (body.color, annotation_id, source_id, project_id)
            )
        row = conn.execute("SELECT * FROM annotations WHERE id=?", (annotation_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Annotation not found")
    return dict(row)

"""Integration tests for notes CRUD."""

from tests.conftest import create_project, create_source_in_db


def test_create_note(client):
    pid = create_project(client)
    resp = client.post(f"/api/projects/{pid}/notes", json={"title": "My Note", "content": "Some content"})
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data


def test_create_note_with_source(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    resp = client.post(f"/api/projects/{pid}/notes", json={"title": "Source Note", "source_id": sid})
    assert resp.status_code == 200
    nid = resp.json()["id"]

    resp = client.get(f"/api/projects/{pid}/notes/{nid}")
    assert resp.status_code == 200
    assert resp.json()["source_id"] == sid


def test_create_note_defaults(client):
    pid = create_project(client)
    resp = client.post(f"/api/projects/{pid}/notes", json={})
    assert resp.status_code == 200
    nid = resp.json()["id"]

    resp = client.get(f"/api/projects/{pid}/notes/{nid}")
    assert resp.json()["title"] == "Untitled Note"


def test_list_notes(client):
    pid = create_project(client)
    client.post(f"/api/projects/{pid}/notes", json={"title": "Note A"})
    client.post(f"/api/projects/{pid}/notes", json={"title": "Note B"})
    resp = client.get(f"/api/projects/{pid}/notes")
    assert resp.status_code == 200
    notes = resp.json()
    assert len(notes) >= 2


def test_update_note(client):
    pid = create_project(client)
    nid = client.post(f"/api/projects/{pid}/notes", json={"title": "Original"}).json()["id"]
    resp = client.put(f"/api/projects/{pid}/notes/{nid}", json={"title": "Updated", "content": "New content"})
    assert resp.status_code == 200

    resp = client.get(f"/api/projects/{pid}/notes/{nid}")
    data = resp.json()
    assert data["title"] == "Updated"
    assert data["content"] == "New content"


def test_delete_note(client):
    pid = create_project(client)
    nid = client.post(f"/api/projects/{pid}/notes", json={"title": "To Delete"}).json()["id"]
    resp = client.delete(f"/api/projects/{pid}/notes/{nid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp = client.get(f"/api/projects/{pid}/notes/{nid}")
    assert resp.status_code == 404

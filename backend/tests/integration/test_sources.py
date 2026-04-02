"""Integration tests for sources CRUD within a project."""

from tests.conftest import create_project, create_source_in_db


def test_list_sources_empty(client):
    pid = create_project(client)
    resp = client.get(f"/api/projects/{pid}/sources")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_sources_with_source(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    resp = client.get(f"/api/projects/{pid}/sources")
    assert resp.status_code == 200
    sources = resp.json()
    assert len(sources) >= 1
    assert any(s["id"] == sid for s in sources)


def test_get_source(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    resp = client.get(f"/api/projects/{pid}/sources/{sid}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == sid
    assert data["title"] == "Test Source"


def test_get_source_not_found(client):
    pid = create_project(client)
    resp = client.get(f"/api/projects/{pid}/sources/bad-id")
    assert resp.status_code == 404


def test_update_source_title(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    resp = client.patch(f"/api/projects/{pid}/sources/{sid}", json={"title": "Renamed Source"})
    assert resp.status_code == 200

    resp = client.get(f"/api/projects/{pid}/sources/{sid}")
    assert resp.json()["title"] == "Renamed Source"


def test_update_source_missing_title(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    resp = client.patch(f"/api/projects/{pid}/sources/{sid}", json={})
    assert resp.status_code == 400


def test_delete_source(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    resp = client.delete(f"/api/projects/{pid}/sources/{sid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp = client.get(f"/api/projects/{pid}/sources/{sid}")
    assert resp.status_code == 404

"""Integration tests for projects CRUD endpoints."""

from tests.conftest import create_project


def test_create_project(client):
    resp = client.post("/api/projects", json={"title": "My Project", "description": "A description"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "My Project"
    assert data["description"] == "A description"
    assert "id" in data
    assert "created_at" in data


def test_list_projects(client):
    create_project(client, "Listed Project")
    resp = client.get("/api/projects")
    assert resp.status_code == 200
    projects = resp.json()
    assert isinstance(projects, list)
    assert any(p["title"] == "Listed Project" for p in projects)


def test_get_project(client):
    pid = create_project(client, "Get Me")
    resp = client.get(f"/api/projects/{pid}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == pid
    assert data["title"] == "Get Me"


def test_get_project_not_found(client):
    resp = client.get("/api/projects/nonexistent-id-12345")
    assert resp.status_code == 404


def test_update_project(client):
    pid = create_project(client, "Old Title")
    resp = client.patch(f"/api/projects/{pid}", json={"title": "New Title"})
    assert resp.status_code == 200

    resp = client.get(f"/api/projects/{pid}")
    assert resp.json()["title"] == "New Title"


def test_update_project_description(client):
    pid = create_project(client, "Desc Test")
    resp = client.patch(f"/api/projects/{pid}", json={"description": "Updated desc"})
    assert resp.status_code == 200

    resp = client.get(f"/api/projects/{pid}")
    assert resp.json()["description"] == "Updated desc"


def test_delete_project(client):
    pid = create_project(client, "To Delete")
    resp = client.delete(f"/api/projects/{pid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp = client.get(f"/api/projects/{pid}")
    assert resp.status_code == 404

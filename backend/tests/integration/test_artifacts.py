"""Integration tests for artifacts CRUD."""

from tests.conftest import create_project


def test_create_artifact(client):
    pid = create_project(client)
    resp = client.post(f"/api/projects/{pid}/artifacts", json={"title": "My Artifact", "content": "artifact body"})
    assert resp.status_code == 200
    data = resp.json()
    assert "id" in data


def test_create_artifact_default_title(client):
    pid = create_project(client)
    resp = client.post(f"/api/projects/{pid}/artifacts", json={"content": "body only"})
    assert resp.status_code == 200
    aid = resp.json()["id"]

    resp = client.get(f"/api/projects/{pid}/artifacts/{aid}")
    assert resp.json()["title"] == "Untitled Artifact"


def test_list_artifacts(client):
    pid = create_project(client)
    client.post(f"/api/projects/{pid}/artifacts", json={"content": "a1"})
    client.post(f"/api/projects/{pid}/artifacts", json={"content": "a2"})
    resp = client.get(f"/api/projects/{pid}/artifacts")
    assert resp.status_code == 200
    assert len(resp.json()) >= 2


def test_get_artifact(client):
    pid = create_project(client)
    aid = client.post(f"/api/projects/{pid}/artifacts", json={"title": "Fetchable", "content": "c"}).json()["id"]
    resp = client.get(f"/api/projects/{pid}/artifacts/{aid}")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Fetchable"


def test_get_artifact_not_found(client):
    pid = create_project(client)
    resp = client.get(f"/api/projects/{pid}/artifacts/nonexistent")
    assert resp.status_code == 404


def test_update_artifact(client):
    pid = create_project(client)
    aid = client.post(f"/api/projects/{pid}/artifacts", json={"content": "old"}).json()["id"]
    resp = client.put(f"/api/projects/{pid}/artifacts/{aid}", json={"title": "Renamed", "content": "new"})
    assert resp.status_code == 200

    resp = client.get(f"/api/projects/{pid}/artifacts/{aid}")
    data = resp.json()
    assert data["title"] == "Renamed"
    assert data["content"] == "new"


def test_delete_artifact(client):
    pid = create_project(client)
    aid = client.post(f"/api/projects/{pid}/artifacts", json={"content": "bye"}).json()["id"]
    resp = client.delete(f"/api/projects/{pid}/artifacts/{aid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp = client.get(f"/api/projects/{pid}/artifacts/{aid}")
    assert resp.status_code == 404

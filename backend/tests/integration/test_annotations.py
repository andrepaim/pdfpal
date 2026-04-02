"""Integration tests for annotations CRUD."""

from tests.conftest import create_project, create_source_in_db


def _make_annotation_payload(**overrides):
    base = {
        "page_number": 1,
        "x1": 10.0,
        "y1": 20.0,
        "x2": 100.0,
        "y2": 40.0,
        "text": "highlighted text",
        "color": "yellow",
    }
    base.update(overrides)
    return base


def test_create_annotation(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    resp = client.post(f"/api/projects/{pid}/sources/{sid}/annotations", json=_make_annotation_payload())
    assert resp.status_code == 200
    data = resp.json()
    assert data["text"] == "highlighted text"
    assert data["color"] == "yellow"
    assert data["page_number"] == 1
    assert "id" in data


def test_create_annotation_valid_colors(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    for color in ["yellow", "green", "blue", "pink"]:
        resp = client.post(
            f"/api/projects/{pid}/sources/{sid}/annotations",
            json=_make_annotation_payload(color=color),
        )
        assert resp.status_code == 200
        assert resp.json()["color"] == color


def test_create_annotation_invalid_color_defaults_yellow(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    resp = client.post(
        f"/api/projects/{pid}/sources/{sid}/annotations",
        json=_make_annotation_payload(color="red"),
    )
    assert resp.status_code == 200
    assert resp.json()["color"] == "yellow"


def test_list_annotations_ordered(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    # Create on page 2 first, then page 1
    client.post(f"/api/projects/{pid}/sources/{sid}/annotations", json=_make_annotation_payload(page_number=2, y1=10.0))
    client.post(f"/api/projects/{pid}/sources/{sid}/annotations", json=_make_annotation_payload(page_number=1, y1=50.0))
    client.post(f"/api/projects/{pid}/sources/{sid}/annotations", json=_make_annotation_payload(page_number=1, y1=10.0))

    resp = client.get(f"/api/projects/{pid}/sources/{sid}/annotations")
    assert resp.status_code == 200
    annotations = resp.json()
    assert len(annotations) >= 3
    # Should be ordered by page_number, then y1
    pages_y1 = [(a["page_number"], a["y1"]) for a in annotations[-3:]]
    assert pages_y1 == sorted(pages_y1)


def test_update_annotation_color(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    ann_id = client.post(
        f"/api/projects/{pid}/sources/{sid}/annotations",
        json=_make_annotation_payload(color="yellow"),
    ).json()["id"]

    resp = client.patch(
        f"/api/projects/{pid}/sources/{sid}/annotations/{ann_id}",
        json={"color": "green"},
    )
    assert resp.status_code == 200
    assert resp.json()["color"] == "green"


def test_update_annotation_invalid_color(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    ann_id = client.post(
        f"/api/projects/{pid}/sources/{sid}/annotations",
        json=_make_annotation_payload(),
    ).json()["id"]

    resp = client.patch(
        f"/api/projects/{pid}/sources/{sid}/annotations/{ann_id}",
        json={"color": "purple"},
    )
    assert resp.status_code == 400


def test_delete_annotation(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    ann_id = client.post(
        f"/api/projects/{pid}/sources/{sid}/annotations",
        json=_make_annotation_payload(),
    ).json()["id"]

    resp = client.delete(f"/api/projects/{pid}/sources/{sid}/annotations/{ann_id}")
    assert resp.status_code == 204


def test_delete_annotation_not_found(client):
    pid = create_project(client)
    sid = create_source_in_db(pid)
    resp = client.delete(f"/api/projects/{pid}/sources/{sid}/annotations/nonexistent")
    assert resp.status_code == 404

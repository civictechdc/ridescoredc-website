from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_mock_conn


VALID_PAYLOAD = {
    "route_ogc_fids": [1, 2, 3],
    "contiguous_segments": [
        {
            "sequence_index": 0,
            "route_name": "Test Route",
            "ogc_fids": [1, 2, 3],
            "lts_perceived": 2,
            "safety_rating": 7,
            "stress_factors": ["parked_cars"],
        }
    ],
    "time_of_day": "morning",
    "overall_satisfaction": 4,
    "would_ride_again": "yes",
    "trip_purpose": "commute",
    "comments": "Nice ride",
}


@pytest.fixture
def client():
    with patch("api.main.init_db"), patch("api.main.get_conn", return_value=make_mock_conn()):
        from api.main import app
        with TestClient(app) as c:
            yield c


# ── /health ──────────────────────────────────────────────────────────────────

def test_health_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_db_down():
    with patch("api.main.init_db"), patch("api.main.get_conn", side_effect=Exception("connection refused")):
        from api.main import app
        with TestClient(app) as c:
            response = c.get("/health")
    assert response.status_code == 503


# ── /api/submissions ──────────────────────────────────────────────────────────

def test_submission_invalid_payload(client):
    response = client.post("/api/submissions", json={})
    assert response.status_code == 422


def test_submission_valid(client):
    response = client.post("/api/submissions", json=VALID_PAYLOAD)
    assert response.status_code == 201
    data = response.json()
    assert "submission_id" in data
    # verify it's a valid UUID shape
    assert len(data["submission_id"]) == 36


def test_submission_db_error():
    conn = make_mock_conn()
    conn.__exit__ = MagicMock(side_effect=Exception("db write failed"))
    with patch("api.main.init_db"), patch("api.main.get_conn", return_value=conn):
        from api.main import app
        with TestClient(app) as c:
            response = c.post("/api/submissions", json=VALID_PAYLOAD)
    assert response.status_code == 500

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from tests.conftest import make_mock_conn


VALID_PAYLOAD = {
    "segment_ids": ["110020210", "110020211", "110020212"],
    "contiguous_segments": [
        {
            "sequence_index": 0,
            "route_name": "Test Route",
            "segment_ids": ["110020210", "110020211", "110020212"],
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
    with patch("main.init_db"), patch("main.get_conn", return_value=make_mock_conn()):
        from main import app
        with TestClient(app) as c:
            yield c


# ── /health ──────────────────────────────────────────────────────────────────

def test_health_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_db_down():
    with patch("main.init_db"), patch("main.get_conn", side_effect=Exception("connection refused")):
        from main import app
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


def test_submission_stores_durable_segment_ids():
    """The text segment_id is written, not a row number, and the response
    records which published road data those ids came from."""
    conn = make_mock_conn()
    with patch("main.init_db"), patch("main.get_conn", return_value=conn):
        from main import app
        with TestClient(app) as c:
            assert c.post("/api/submissions", json=VALID_PAYLOAD).status_code == 201

    written = [call.args for call in conn.cursor.return_value.execute.call_args_list]
    submission = next(a for a in written if "app.survey_submissions" in a[0])
    assert submission[1][1] == ["110020210", "110020211", "110020212"]
    assert submission[1][2] == "ridescoredc-data-preview@0.1"

    granular = [a for a in written if "app.survey_granular_segments" in a[0]]
    assert [a[1][1] for a in granular] == ["110020210", "110020211", "110020212"]


def test_submission_refused_when_no_road_data_loaded():
    """Without road data there is nothing the segment ids could refer to, so the
    response is refused rather than stored with an unknown provenance."""
    conn = make_mock_conn(package=None)
    with patch("main.init_db"), patch("main.get_conn", return_value=conn):
        from main import app
        with TestClient(app) as c:
            response = c.post("/api/submissions", json=VALID_PAYLOAD)
    assert response.status_code == 503


def test_submission_db_error():
    conn = make_mock_conn()
    conn.__exit__ = MagicMock(side_effect=Exception("db write failed"))
    with patch("main.init_db"), patch("main.get_conn", return_value=conn):
        from main import app
        with TestClient(app) as c:
            response = c.post("/api/submissions", json=VALID_PAYLOAD)
    assert response.status_code == 500


def _stored_submission(payload):
    conn = make_mock_conn()
    with patch("main.init_db"), patch("main.get_conn", return_value=conn):
        from main import app
        with TestClient(app) as c:
            assert c.post("/api/submissions", json=payload).status_code == 201
    written = [call.args for call in conn.cursor.return_value.execute.call_args_list]
    return next(a for a in written if "app.survey_submissions" in a[0])[1]


def test_comment_is_private_unless_asked():
    """A response that does not tick the box never publishes its comment."""
    assert _stored_submission(VALID_PAYLOAD)[8] is False


def test_comment_public_when_asked():
    assert _stored_submission({**VALID_PAYLOAD, "comment_public": True})[8] is True


def test_comment_public_without_a_comment_publishes_nothing():
    payload = {**VALID_PAYLOAD, "comments": None, "comment_public": True}
    assert _stored_submission(payload)[8] is False


# ── /api/segments/{segment_id}/reviews ───────────────────────────────────────

def _reviews(fetchone, fetchall):
    conn = make_mock_conn()
    cur = conn.cursor.return_value
    # First fetchone is data.load_record (which road network is loaded).
    cur.fetchone.side_effect = [("ridescoredc-data-preview@0.1",), fetchone]
    cur.fetchall.side_effect = fetchall
    with patch("main.init_db"), patch("main.get_conn", return_value=conn):
        from main import app
        with TestClient(app) as c:
            response = c.get("/api/segments/abc123/reviews")
    return response, [call.args for call in cur.execute.call_args_list]


def test_reviews_summarises_a_street():
    from datetime import date
    from decimal import Decimal

    response, executed = _reviews(
        (4, Decimal("3.25"), Decimal("3.0"), Decimal("2.5"), 1, 1, 2, "Evening"),
        [
            [("Motor traffic speed", 3), ("Little separation from traffic", 2)],
            [("Scary at rush hour", date(2026, 10, 3), "Evening")],
        ],
    )
    assert response.status_code == 200
    assert response.json() == {
        "n_reviews": 4,
        "street": {
            "mean_safety": 3.2,
            "mean_lts": 3.0,
            "top_stress_factors": [
                {"factor": "Motor traffic speed", "count": 3},
                {"factor": "Little separation from traffic", "count": 2},
            ],
        },
        "routes": {
            "mean_satisfaction": 2.5,
            "ride_again": {"yes": 1, "probably": 1, "no": 2},
            "common_time": "Evening",
        },
        "comments": [{"text": "Scary at rush hour", "date": "2026-10-03", "time_of_day": "Evening"}],
    }
    # Every query is limited to this street on the loaded road network.
    for sql, params in executed[1:]:
        assert params[:2] == ("abc123", "ridescoredc-data-preview@0.1")


def test_reviews_only_return_published_and_approved_comments():
    _, executed = _reviews((0, None, None, None, 0, 0, 0, None), [[], []])
    comment_sql = executed[-1][0]
    assert "s.comment_public" in comment_sql
    assert "s.comment_status = 'approved'" in comment_sql


def test_reviews_for_an_unrated_street():
    response, _ = _reviews((0, None, None, None, 0, 0, 0, None), [[], []])
    assert response.status_code == 200
    body = response.json()
    assert body["n_reviews"] == 0
    assert body["street"]["mean_safety"] is None
    assert body["comments"] == []


# ── /api/admin/comments ──────────────────────────────────────────────────────

LOGIN = ("admin", "password")


@pytest.fixture
def admin_login(monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", LOGIN[0])
    monkeypatch.setenv("ADMIN_PASSWORD", LOGIN[1])


def _admin(method, path, conn=None, login=LOGIN, **kwargs):
    conn = conn or make_mock_conn()
    with patch("main.init_db"), patch("main.get_conn", return_value=conn):
        from main import app
        with TestClient(app) as c:
            return c.request(method, path, auth=login, **kwargs)


def test_admin_is_off_without_a_configured_password(monkeypatch):
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    assert _admin("GET", "/api/admin/comments").status_code == 503


def test_admin_refuses_a_wrong_or_missing_login(admin_login):
    assert _admin("GET", "/api/admin/comments", login=("admin", "guess")).status_code == 401
    assert _admin("GET", "/api/admin/comments", login=("someone", "password")).status_code == 401
    response = _admin("GET", "/api/admin/comments", login=None)
    assert response.status_code == 401
    # No WWW-Authenticate, or the browser opens its own login box over the page's.
    assert "www-authenticate" not in response.headers


def test_admin_lists_comments_for_review(admin_login):
    from datetime import datetime, timezone

    conn = make_mock_conn()
    cur = conn.cursor.return_value
    cur.fetchall.side_effect = [
        [("pending", 2), ("approved", 1)],
        [("0b6c4f3e-0000-4000-8000-000000000001", datetime(2026, 10, 3, tzinfo=timezone.utc),
          "Trucks in the lane", "Evening", 2, ["U ST NW", "VERMONT AVE NW"])],
    ]
    response = _admin("GET", "/api/admin/comments?status=pending", conn=conn)
    assert response.status_code == 200
    body = response.json()
    assert body["counts"] == {"pending": 2, "approved": 1, "rejected": 0}
    assert body["comments"][0]["text"] == "Trucks in the lane"
    assert body["comments"][0]["streets"] == ["U ST NW", "VERMONT AVE NW"]
    # Only comments their authors asked to publish are ever listed.
    listing_sql = cur.execute.call_args_list[1].args[0]
    assert "s.comment_public" in listing_sql


def test_admin_approves_a_comment(admin_login):
    conn = make_mock_conn()
    sid = "0b6c4f3e-0000-4000-8000-000000000001"
    conn.cursor.return_value.fetchone.return_value = (sid,)
    response = _admin("POST", f"/api/admin/comments/{sid}", conn=conn, json={"status": "approved"})
    assert response.status_code == 200
    sql, params = conn.cursor.return_value.execute.call_args.args
    assert "comment_public" in sql
    assert params == ("approved", sid)


def test_admin_cannot_approve_an_unknown_or_private_comment(admin_login):
    conn = make_mock_conn()
    conn.cursor.return_value.fetchone.return_value = None
    response = _admin("POST", "/api/admin/comments/0b6c4f3e-0000-4000-8000-000000000001",
                      conn=conn, json={"status": "approved"})
    assert response.status_code == 404


def test_admin_rejects_an_unknown_status(admin_login):
    response = _admin("POST", "/api/admin/comments/0b6c4f3e-0000-4000-8000-000000000001",
                      json={"status": "published"})
    assert response.status_code == 422

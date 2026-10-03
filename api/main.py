import hmac
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import List, Literal, Optional

import psycopg
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATABASE_URL = os.environ["DATABASE_URL"]

# This service records survey responses, reports what riders have said about
# one street, lets a reviewer approve comments for the map, and says whether it
# can reach the database. It serves no pages -- nginx does that directly -- and
# it does not serve the map, which the browser gets from Martin.


def get_conn():
    return psycopg.connect(DATABASE_URL)


def init_db(retries: int = 10, delay: float = 2.0):
    # Gate startup on the database being reachable (matters under docker-compose,
    # where db and app boot together). No schema is created here: the survey
    # tables come from this repository's own migrations in api/migrations/, and
    # the road data is loaded from a published package built by ridescoredc-models.
    for attempt in range(retries):
        try:
            # psycopg 3: the connection context manager commits (or rolls back)
            # and closes the connection on exit -- no explicit close needed.
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            return
        except Exception as exc:
            if attempt == retries - 1:
                raise RuntimeError(f"DB init failed after {retries} attempts: {exc}") from exc
            time.sleep(delay)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request models ──────────────────────────────────────────────────────────

class ContiguousSegment(BaseModel):
    sequence_index: int
    route_name: Optional[str] = None
    segment_ids: List[str]
    lts_perceived: Optional[int] = None
    safety_rating: Optional[int] = None
    stress_factors: Optional[List[str]] = None


class SurveySubmission(BaseModel):
    segment_ids: List[str]
    contiguous_segments: List[ContiguousSegment]
    time_of_day: Optional[str] = None
    overall_satisfaction: Optional[int] = None
    would_ride_again: Optional[str] = None
    trip_purpose: Optional[str] = None
    comments: Optional[str] = None
    # The respondent ticked "Show my comment anonymously on the public map".
    # Even then nothing is shown until the comment has been approved.
    comment_public: bool = False


# ── Endpoints ───────────────────────────────────────────────────────────────

def geometry_source(cur) -> str:
    """Which published road data the segment ids in a response refer to.

    Read from the database rather than taken from the browser: the page cannot
    know which package was loaded, and a response that names the wrong one
    cannot be interpreted later.
    """
    cur.execute("SELECT package FROM data.load_record WHERE dataset = 'road_segment'")
    row = cur.fetchone()
    if row is None:
        raise HTTPException(
            status_code=503,
            detail="No road data is loaded, so a response cannot be tied to a road network.",
        )
    return row[0]


@app.post("/api/submissions", status_code=201)
def create_submission(body: SurveySubmission):
    submission_id = str(uuid.uuid4())
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO app.survey_submissions
                        (submission_id, segment_ids, geometry_source, time_of_day,
                         overall_satisfaction, would_ride_again, trip_purpose, comments,
                         comment_public)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        submission_id,
                        body.segment_ids,
                        geometry_source(cur),
                        body.time_of_day,
                        body.overall_satisfaction,
                        body.would_ride_again,
                        body.trip_purpose,
                        body.comments,
                        # Asking to publish nothing is the same as not asking.
                        body.comment_public and bool(body.comments),
                    ),
                )

                for seg in body.contiguous_segments:
                    seg_id = str(uuid.uuid4())
                    cur.execute(
                        """
                        INSERT INTO app.survey_contiguous_segments
                            (id, submission_id, sequence_index, route_name, segment_ids,
                             lts_perceived, safety_rating, stress_factors)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            seg_id,
                            submission_id,
                            seg.sequence_index,
                            seg.route_name,
                            seg.segment_ids,
                            seg.lts_perceived,
                            seg.safety_rating,
                            seg.stress_factors,
                        ),
                    )

                    for seq_idx, segment_id in enumerate(seg.segment_ids):
                        cur.execute(
                            """
                            INSERT INTO app.survey_granular_segments
                                (submission_id, segment_id, contiguous_segment_id,
                                 sequence_index)
                            VALUES (%s, %s, %s, %s)
                            ON CONFLICT (submission_id, segment_id) DO NOTHING
                            """,
                            (submission_id, segment_id, seg_id, seq_idx),
                        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"submission_id": submission_id}


def _avg(value) -> Optional[float]:
    return None if value is None else round(float(value), 1)


# How many approved comments one request returns, newest first. Enough for a
# popup to show a few and offer the rest; a street with more than this has
# outgrown a popup anyway.
COMMENT_LIMIT = 20


@app.get("/api/segments/{segment_id}/reviews")
def segment_reviews(segment_id: str):
    """What riders have said about one street, for the main map's popup.

    Two kinds of answer, kept apart because they mean different things. The
    `street` answers were given about this segment. The `routes` answers and the
    comments were given about a whole painted route, so they come from every
    route that included this street and may be about another part of it.

    Only responses collected on the road network now loaded are counted, the
    same rule the map's hazard colours follow. A comment is returned only if its
    author asked for it to be shown and someone has approved it.
    """
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                source = geometry_source(cur)
                joins = """
                    FROM app.survey_granular_segments g
                    JOIN app.survey_contiguous_segments c ON c.id = g.contiguous_segment_id
                    JOIN app.survey_submissions s         ON s.submission_id = g.submission_id
                """
                this_street = "WHERE g.segment_id = %s AND s.geometry_source = %s"
                # A response covers a segment at most once (the primary key of
                # survey_granular_segments), so each row here is one response.
                cur.execute(
                    f"""
                    SELECT count(*),
                           avg(c.safety_rating), avg(c.lts_perceived),
                           avg(s.overall_satisfaction),
                           count(*) FILTER (WHERE s.would_ride_again = 'yes'),
                           count(*) FILTER (WHERE s.would_ride_again = 'probably'),
                           count(*) FILTER (WHERE s.would_ride_again = 'no'),
                           mode() WITHIN GROUP (ORDER BY s.time_of_day)
                    {joins} {this_street}
                    """,
                    (segment_id, source),
                )
                (n_reviews, safety, lts, satisfaction,
                 again_yes, again_probably, again_no, common_time) = cur.fetchone()

                cur.execute(
                    f"""
                    SELECT f, count(*)
                    {joins} CROSS JOIN LATERAL unnest(c.stress_factors) AS f
                    {this_street}
                    GROUP BY f ORDER BY count(*) DESC, f LIMIT 3
                    """,
                    (segment_id, source),
                )
                stress = cur.fetchall()

                cur.execute(
                    f"""
                    SELECT s.comments, s.submitted_at::date, s.time_of_day
                    {joins} {this_street}
                      AND s.comments IS NOT NULL
                      AND s.comment_public
                      AND s.comment_status = 'approved'
                    ORDER BY s.submitted_at DESC
                    LIMIT %s
                    """,
                    (segment_id, source, COMMENT_LIMIT),
                )
                comments = cur.fetchall()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "n_reviews": n_reviews,
        "street": {
            "mean_safety": _avg(safety),
            "mean_lts": _avg(lts),
            "top_stress_factors": [{"factor": f, "count": n} for f, n in stress],
        },
        "routes": {
            "mean_satisfaction": _avg(satisfaction),
            "ride_again": {"yes": again_yes, "probably": again_probably, "no": again_no},
            "common_time": common_time,
        },
        "comments": [
            {"text": text, "date": str(day), "time_of_day": time_of_day}
            for text, day, time_of_day in comments
        ],
    }


# ── Comment review ──────────────────────────────────────────────────────────
#
# Used by the page at /admin/. Every request carries the reviewer's username and
# password as HTTP Basic credentials, checked against ADMIN_USERNAME and
# ADMIN_PASSWORD from the environment.
#
# With ADMIN_PASSWORD unset, review is switched off entirely rather than left
# open, so a server nobody has configured publishes nothing and lets nobody in.
# One shared login is enough for a handful of reviewers; it is not accounts,
# and should be replaced by real sign-in before more people need access.

CommentStatus = Literal["pending", "approved", "rejected"]

# auto_error off, so a failed login is answered by require_admin without the
# WWW-Authenticate header that would make the browser open its own login box
# over the page's.
basic_auth = HTTPBasic(auto_error=False)


def require_admin(credentials: Optional[HTTPBasicCredentials] = Depends(basic_auth)):
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "")
    if not password:
        raise HTTPException(
            status_code=503,
            detail="Comment review is turned off: ADMIN_PASSWORD is not set on the server.",
        )
    # compare_digest, so the time taken does not reveal how much of a guess
    # matched. Both are always compared, so neither can be found on its own.
    ok = credentials is not None
    ok &= hmac.compare_digest((credentials.username if credentials else "").encode(), username.encode())
    ok &= hmac.compare_digest((credentials.password if credentials else "").encode(), password.encode())
    if not ok:
        raise HTTPException(status_code=401, detail="That username and password are not right.")


class CommentDecision(BaseModel):
    status: CommentStatus


@app.get("/api/admin/comments", dependencies=[Depends(require_admin)])
def list_comments(status: CommentStatus = "pending"):
    """Comments respondents asked to publish, with a status, for review.

    Comments nobody asked to publish are never listed: there is nothing to
    decide about them. Waiting comments come oldest first, so the queue is
    worked in order; decided ones newest first.
    """
    order = "ASC" if status == "pending" else "DESC"
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT comment_status, count(*)
                    FROM app.survey_submissions
                    WHERE comments IS NOT NULL AND comment_public
                    GROUP BY comment_status
                    """
                )
                counts = dict(cur.fetchall())

                # The streets on the route, so a reviewer can tell what the
                # comment is about without opening the database.
                cur.execute(
                    f"""
                    SELECT s.submission_id, s.submitted_at, s.comments, s.time_of_day,
                           s.overall_satisfaction,
                           array_remove(array_agg(DISTINCT c.route_name), NULL)
                    FROM app.survey_submissions s
                    LEFT JOIN app.survey_contiguous_segments c USING (submission_id)
                    WHERE s.comments IS NOT NULL AND s.comment_public
                      AND s.comment_status = %s
                    GROUP BY s.submission_id
                    ORDER BY s.submitted_at {order}
                    LIMIT 200
                    """,
                    (status,),
                )
                rows = cur.fetchall()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "counts": {s: counts.get(s, 0) for s in ("pending", "approved", "rejected")},
        "comments": [
            {
                "submission_id": str(sid),
                "submitted_at": submitted_at.isoformat(),
                "text": text,
                "time_of_day": time_of_day,
                "overall_satisfaction": satisfaction,
                "streets": streets or [],
            }
            for sid, submitted_at, text, time_of_day, satisfaction, streets in rows
        ],
    }


@app.post("/api/admin/comments/{submission_id}", dependencies=[Depends(require_admin)])
def decide_comment(submission_id: uuid.UUID, body: CommentDecision):
    """Approve or reject a comment, or send it back to waiting.

    Only a comment its author asked to publish can be approved; anything else
    is answered as not found, so this cannot publish a private comment.
    """
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE app.survey_submissions SET comment_status = %s
                    WHERE submission_id = %s AND comments IS NOT NULL AND comment_public
                    RETURNING submission_id
                    """,
                    (body.status, str(submission_id)),
                )
                found = cur.fetchone()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if found is None:
        raise HTTPException(status_code=404, detail="No comment its author asked to publish has that id.")
    return {"submission_id": str(submission_id), "status": body.status}


@app.get("/health")
def health():
    try:
        conn = get_conn()
        conn.close()
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

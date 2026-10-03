import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import List, Optional

import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DATABASE_URL = os.environ["DATABASE_URL"]

# This service answers three things: it records a survey response, it reports
# what riders have said about one street, and it says whether it can reach the
# database. It serves no pages -- nginx does that
# directly -- and it does not serve the map, which the browser gets from Martin.


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


@app.get("/health")
def health():
    try:
        conn = get_conn()
        conn.close()
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

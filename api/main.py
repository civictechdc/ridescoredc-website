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

# This service answers two things: it records a survey response, and it says
# whether it can reach the database. It serves no pages -- nginx does that
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
                         overall_satisfaction, would_ride_again, trip_purpose, comments)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
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


@app.get("/health")
def health():
    try:
        conn = get_conn()
        conn.close()
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

-- The app schema: what users create.
--
-- Separated from the bike-safety data, which is reloaded wholesale from a
-- published package. Survey responses are the original and cannot be
-- regenerated, so nothing that reloads the map data can reach them.
--
-- This repository owns these tables because the code that writes them is here.

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE app.survey_submissions (
    submission_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- The road segments the respondent marked, by the pipeline's own key.
    -- Text, not the integer row number used before: that number was assigned by
    -- the database on import and changed every time the map data was reloaded,
    -- so responses quietly came loose from the streets they were about.
    segment_ids          TEXT[] NOT NULL,

    -- Which published map data those segment ids belong to, for example
    -- "ridescoredc-data-preview@0.1". Segment identity does not survive the
    -- move to OpenStreetMap, so this records which network a response was
    -- collected against. It does not allow the response to be re-attached to a
    -- different network; it allows responses on a superseded network to be
    -- found and set aside rather than silently misread.
    geometry_source      TEXT NOT NULL,

    time_of_day          VARCHAR(20),
    overall_satisfaction INTEGER CHECK (overall_satisfaction BETWEEN 1 AND 5),
    would_ride_again     VARCHAR(20),
    trip_purpose         VARCHAR(30),
    comments             TEXT
);

CREATE TABLE app.survey_contiguous_segments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id    UUID NOT NULL
                       REFERENCES app.survey_submissions(submission_id) ON DELETE CASCADE,
    sequence_index   INTEGER NOT NULL,

    -- Recorded when the response was given, rather than looked up later. The
    -- street's name is what a person can still recognise once the segment ids
    -- have changed underneath.
    route_name       VARCHAR,

    segment_ids      TEXT[] NOT NULL,
    lts_perceived    INTEGER CHECK (lts_perceived BETWEEN 1 AND 4),
    safety_rating    INTEGER CHECK (safety_rating BETWEEN 1 AND 10),
    stress_factors   TEXT[]
);

CREATE TABLE app.survey_granular_segments (
    submission_id          UUID NOT NULL
                             REFERENCES app.survey_submissions(submission_id) ON DELETE CASCADE,
    segment_id             TEXT NOT NULL,
    contiguous_segment_id  UUID NOT NULL
                             REFERENCES app.survey_contiguous_segments(id) ON DELETE CASCADE,
    sequence_index         INTEGER NOT NULL,
    PRIMARY KEY (submission_id, segment_id)
);

-- No foreign key points at the road data. Those tables are dropped and rebuilt
-- whenever new map data is loaded, which a foreign key would prevent. Responses
-- refer to segments by value, and the loader reports how many now point at
-- nothing.

CREATE INDEX idx_survey_contiguous_submission ON app.survey_contiguous_segments(submission_id);
CREATE INDEX idx_survey_granular_submission   ON app.survey_granular_segments(submission_id);
CREATE INDEX idx_survey_granular_segment      ON app.survey_granular_segments(segment_id);

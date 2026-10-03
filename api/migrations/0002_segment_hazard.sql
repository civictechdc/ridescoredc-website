-- How hazardous riders say each road segment is, from their survey answers.
--
-- One row per segment per road network. A response is counted only against
-- the network it was collected on (geometry_source), because a segment id from
-- one network names nothing reliable in another. Choosing which network to
-- show is left to whoever draws the map: serving.rider_hazard, in the bundle
-- built by ridescoredc-models, joins this view to the loaded road data and
-- keeps only the rows for the network that is loaded.
--
-- Reads the app schema and nothing else. The road data is dropped with CASCADE
-- on every load, and a view reading it from here would be dropped along with
-- it, silently.
--
-- serving.rider_hazard depends on this view, so a later migration may add
-- columns at the end with CREATE OR REPLACE VIEW, but renaming or removing one
-- means dropping that serving view too and reloading the data to rebuild it.
--
-- The rating used is safety_rating: "How safe did you feel?", 1 (very unsafe)
-- to 10 (very safe). Each rated stretch of a route counts once for every
-- segment in it, and a respondent can rate a segment once per submission.

CREATE VIEW app.segment_hazard AS
SELECT
    g.segment_id,
    s.geometry_source,
    count(*)::int                                   AS n_ratings,
    round(avg(c.safety_rating), 2)                  AS mean_safety,
    count(*) FILTER (WHERE c.safety_rating <= 4)::int AS n_unsafe,

    -- The mean, pulled toward the middle of the scale as though every segment
    -- had already been rated 5.5 by five riders. One rating of 1 lands at 4.75
    -- rather than at 1, so a single bad review cannot mark a street as the
    -- worst in the city; it takes four or five consistent ones to get there.
    -- More riders agreeing moves the score further, which is the point.
    round((5 * 5.5 + sum(c.safety_rating)) / (5 + count(*)), 2) AS adjusted_safety
FROM app.survey_granular_segments g
JOIN app.survey_contiguous_segments c ON c.id = g.contiguous_segment_id
JOIN app.survey_submissions s         ON s.submission_id = g.submission_id
WHERE c.safety_rating IS NOT NULL
GROUP BY g.segment_id, s.geometry_source;

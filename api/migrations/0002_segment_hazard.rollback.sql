-- CASCADE takes serving.rider_hazard with it, if it exists. Reloading the data
-- recreates that view, once this one is back.
DROP VIEW IF EXISTS app.segment_hazard CASCADE;

DROP VIEW IF EXISTS app.comments_awaiting_review;

ALTER TABLE app.survey_submissions
    DROP COLUMN IF EXISTS comment_status,
    DROP COLUMN IF EXISTS comment_public;

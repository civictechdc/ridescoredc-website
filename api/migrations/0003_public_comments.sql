-- Letting a respondent's comment appear on the public map, and reviewing it first.
--
-- A comment is shown only when both are true:
--
--   comment_public    the respondent ticked "Show my comment anonymously on the
--                     public map". Off by default, and off for every response
--                     collected before the box existed: those respondents were
--                     never told their words might be published.
--
--   comment_status    someone has read it and approved it. Free text on a public
--                     page will sooner or later contain abuse or someone's
--                     personal details, so nothing is shown until a person has
--                     looked at it.
--
-- To review, read app.comments_awaiting_review and then, for each one:
--
--   UPDATE app.survey_submissions SET comment_status = 'approved'
--    WHERE submission_id = '<id>';
--
-- or 'rejected' to keep it off the map. Rejecting leaves the comment stored,
-- because it is still part of the response.

ALTER TABLE app.survey_submissions
    ADD COLUMN comment_public BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN comment_status VARCHAR(10) NOT NULL DEFAULT 'pending'
        CHECK (comment_status IN ('pending', 'approved', 'rejected'));

-- Only comments a respondent asked to publish need a decision; the rest are
-- never shown whatever their status.
CREATE VIEW app.comments_awaiting_review AS
SELECT submission_id, submitted_at, comments
FROM app.survey_submissions
WHERE comments IS NOT NULL
  AND comment_public
  AND comment_status = 'pending'
ORDER BY submitted_at;

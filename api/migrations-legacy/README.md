# Before yoyo

One-off SQL applied by hand to the production database before this repository
used a migration tool. Kept as a record of what was run; nothing applies these,
and nothing should.

They are not in `api/migrations/` because yoyo would treat them as migrations
and try to run them. `001_survey_submissions_v2.sql` begins by dropping columns
from a table, so on an empty database it fails.

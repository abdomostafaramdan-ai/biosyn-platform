-- Videos can live in any Bunny Stream library (one library per course is common).
-- A Bunny *account* API key lets the server look up each library's own API key.
alter table lecture_videos add column if not exists bunny_library_id text;
alter table proposal_lessons add column if not exists bunny_library_id text;
-- integration_keys() gains BUNNY_ACCOUNT_KEY; uploads_ready() accepts it; accept_course_proposal() copies bunny_library_id
-- (full definitions applied in the database; see 0021 for the base versions).

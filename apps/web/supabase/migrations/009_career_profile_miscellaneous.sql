-- Miscellaneous: facts the user saved about themselves from the notes canvas
-- on the tailoring review / JD Analyzer, each already tidied by
-- POST /ai/restructure-notes. Items are
--   { id, text, section, created_at }
-- where section is one of experience, project, achievements, awards,
-- leadership, volunteer, skills, miscellaneous. Offered (off by default) in
-- every later tailoring review.
-- Run in Supabase SQL editor after 008_security_hardening.sql.

ALTER TABLE career_profiles
  ADD COLUMN IF NOT EXISTS miscellaneous jsonb NOT NULL DEFAULT '[]';

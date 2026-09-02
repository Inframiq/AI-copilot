-- Profile photo: the user's default headshot, reused across resumes.
-- Managed in "My Profile"; the Resume Builder only prompts to use/replace it.
-- Run in the Supabase SQL editor after 004_career_profile_projects.sql.

ALTER TABLE career_profiles
  ADD COLUMN IF NOT EXISTS photo_url  text,   -- public URL in the "avatars" bucket
  ADD COLUMN IF NOT EXISTS photo_path text;   -- storage object key "<uid>/profile.<ext>"

-- No backfill: existing rows keep NULL (no profile photo). RLS unchanged —
-- career_profiles_own already covers every column on the row.

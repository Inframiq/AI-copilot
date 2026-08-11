-- Adds a standalone Projects section — students typically have projects
-- (academic, personal, hackathon) instead of work experience, and working
-- professionals often have side/portfolio projects too. Separate from
-- `experience`, which stays for actual employment/internships.
-- Run in Supabase SQL editor after 003_career_profile_role_status.sql.

ALTER TABLE career_profiles
  ADD COLUMN IF NOT EXISTS projects jsonb NOT NULL DEFAULT '[]';

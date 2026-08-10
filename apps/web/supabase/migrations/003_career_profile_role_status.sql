-- Adds the mandatory "working professional / student" onboarding field.
-- Run in Supabase SQL editor after 002_career_profile.sql.

ALTER TABLE career_profiles
  ADD COLUMN IF NOT EXISTS role_status text CHECK (role_status IN ('working', 'student'));

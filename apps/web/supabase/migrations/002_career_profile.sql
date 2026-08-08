-- Career Profile: private source-of-truth for a user's full career data.
-- Run in Supabase SQL editor after 001_networking.sql.

CREATE TABLE IF NOT EXISTS career_profiles (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  master_resume_id  uuid,          -- FK to resumes table (set after first save)
  contact           jsonb NOT NULL DEFAULT '{}',
  experience        jsonb NOT NULL DEFAULT '[]',
  education         jsonb NOT NULL DEFAULT '[]',
  skills            text[]         DEFAULT '{}',
  certifications    jsonb NOT NULL DEFAULT '[]',
  headline          text,
  created_at        timestamptz    DEFAULT now(),
  updated_at        timestamptz    DEFAULT now()
);

-- RLS: users can only read/write their own row
ALTER TABLE career_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "career_profiles_own" ON career_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_career_profile_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER career_profiles_updated_at
  BEFORE UPDATE ON career_profiles
  FOR EACH ROW EXECUTE FUNCTION update_career_profile_timestamp();

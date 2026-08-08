-- Run this in your Supabase SQL editor before using the Networking feature.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Profiles ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  headline      text,
  bio           text,
  location      text,
  skills        text[] DEFAULT '{}',
  open_to_work  boolean DEFAULT false,
  available_for text[] DEFAULT '{}',
  linkedin_url  text,
  github_url    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_authenticated"
  ON profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated USING (id = auth.uid());

CREATE POLICY "profiles_delete_own"
  ON profiles FOR DELETE TO authenticated USING (id = auth.uid());

-- ── Connection Requests ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connection_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status     text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (from_user, to_user)
);

ALTER TABLE connection_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conn_select_participant"
  ON connection_requests FOR SELECT TO authenticated
  USING (from_user = auth.uid() OR to_user = auth.uid());

CREATE POLICY "conn_insert_sender"
  ON connection_requests FOR INSERT TO authenticated
  WITH CHECK (from_user = auth.uid());

CREATE POLICY "conn_update_recipient"
  ON connection_requests FOR UPDATE TO authenticated
  USING (to_user = auth.uid());

CREATE POLICY "conn_delete_sender"
  ON connection_requests FOR DELETE TO authenticated
  USING (from_user = auth.uid());

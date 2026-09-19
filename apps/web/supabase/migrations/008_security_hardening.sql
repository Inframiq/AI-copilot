-- Security audit fixes (2026-09-19). Safe to run at any time, in any order
-- relative to deploys: it only narrows what the database accepts.

-- ── Storage: enforce size and type on the server, not just in the browser ───
-- The upload form checks these, but anyone can call Storage directly with the
-- public key and their own session. Without limits here, a user could fill
-- their folder with multi-gigabyte files of any type.
UPDATE storage.buckets
  SET file_size_limit = 5242880,  -- 5 MB, matching lib/photo-upload.ts
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
  WHERE id = 'avatars';

UPDATE storage.buckets
  SET file_size_limit = 10485760,  -- 10 MB, matching the API's upload limit
      allowed_mime_types = ARRAY['application/pdf']
  WHERE id = 'resumes';

-- ── profiles: a user's row must stay theirs ─────────────────────────────────
-- The update rule checked the row before the change but not after, so a user
-- could set their row's id to another user's id and publish a networking
-- profile under that person's identity.
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── connection_requests: only the other person can accept ───────────────────
-- A sender could insert a request already marked "accepted", connecting to
-- anyone without their say, or send one to themselves.
DROP POLICY IF EXISTS "conn_insert_sender" ON connection_requests;
CREATE POLICY "conn_insert_sender"
  ON connection_requests FOR INSERT TO authenticated
  WITH CHECK (from_user = auth.uid() AND status = 'pending' AND from_user <> to_user);

-- The recipient could rewrite who a request was from and to. They may now
-- change its status and nothing else.
DROP POLICY IF EXISTS "conn_update_recipient" ON connection_requests;
CREATE POLICY "conn_update_recipient"
  ON connection_requests FOR UPDATE TO authenticated
  USING (to_user = auth.uid())
  WITH CHECK (to_user = auth.uid());
REVOKE UPDATE ON connection_requests FROM authenticated, anon;
GRANT UPDATE (status) ON connection_requests TO authenticated;

-- Step 3 of making the "avatars" bucket private. Run AFTER the code that
-- shows photos through signed links is live (see 006 for step 1).
--
-- Turns off the bucket's public URLs: /storage/v1/object/public/avatars/...
-- stops serving anything, so knowing a user's id no longer gets you their
-- photo. Saved photo URLs keep that public shape; the app treats it as an
-- identifier and signs it before showing it.

UPDATE storage.buckets SET public = false WHERE id = 'avatars';

-- Step 4: any older rule on the bucket that lets more than the owner read
-- (one made in the dashboard when it was set up, say) would still let a
-- signed-in user sign a link to someone else's photo. List what's there:
--
--   SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'storage' AND tablename = 'objects';
--
-- and drop every rule touching 'avatars' other than the four avatars_*_own
-- rules from 006:
--
--   DROP POLICY "<policy name>" ON storage.objects;

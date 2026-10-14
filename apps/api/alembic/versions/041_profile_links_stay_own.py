"""a career profile may only point at its owner's résumé and photo

Revision ID: 041
Revises: 040
Create Date: 2026-10-14 00:00:00.000000

The browser writes career_profiles itself, and RLS only checks the row's own
user_id, so a user could save someone else's résumé as their master résumé
or someone else's photo as their photo_path (test RLS-020). The photo one
mattered: account deletion removes the file photo_path names with the service
key (the API now also refuses paths outside the user's folder).

Now the database refuses both:
- master_resume_id must be one of the same user's résumés: a foreign key on
  (master_resume_id, user_id) against resumes (id, user_id). Deleting the
  résumé clears the link, as routers/resumes.py already did by hand. NOT
  VALID so profiles saved before this, still pointing at a résumé deleted
  back then, keep loading and saving (the profile page tells the user it was
  deleted); every new link is checked.
- photo_path must be a file in the user's own folder ("<user id>/<file>"),
  with no empty, "." or ".." parts.

Links to another user's résumé or photo already saved are cleared first.
Skipped where career_profiles doesn't exist (the local test database).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "041"
down_revision: Union[str, None] = "040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPGRADE_SQL = r"""
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL OR to_regclass('public.resumes') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.career_profiles cp SET master_resume_id = NULL
  WHERE EXISTS (SELECT 1 FROM public.resumes r WHERE r.id = cp.master_resume_id AND r.user_id <> cp.user_id);

  UPDATE public.career_profiles SET photo_path = NULL
  WHERE photo_path IS NOT NULL
    AND (split_part(photo_path, '/', 1) <> user_id::text
         OR position('/' in photo_path) = 0
         OR photo_path ~ '(^|/)\.{0,2}(/|$)');

  ALTER TABLE public.resumes ADD CONSTRAINT resumes_id_user_id_key UNIQUE (id, user_id);

  ALTER TABLE public.career_profiles
    ADD CONSTRAINT career_profiles_master_resume_owner_fkey
    FOREIGN KEY (master_resume_id, user_id) REFERENCES public.resumes (id, user_id)
    ON DELETE SET NULL (master_resume_id) NOT VALID;

  ALTER TABLE public.career_profiles
    ADD CONSTRAINT career_profiles_photo_path_own_folder
    CHECK (photo_path IS NULL OR (
      split_part(photo_path, '/', 1) = user_id::text
      AND position('/' in photo_path) > 0
      AND photo_path !~ '(^|/)\.{0,2}(/|$)'));
END $$;
"""

DOWNGRADE_SQL = """
DO $$
BEGIN
  IF to_regclass('public.career_profiles') IS NULL OR to_regclass('public.resumes') IS NULL THEN
    RETURN;
  END IF;
  ALTER TABLE public.career_profiles DROP CONSTRAINT IF EXISTS career_profiles_photo_path_own_folder;
  ALTER TABLE public.career_profiles DROP CONSTRAINT IF EXISTS career_profiles_master_resume_owner_fkey;
  ALTER TABLE public.resumes DROP CONSTRAINT IF EXISTS resumes_id_user_id_key;
END $$;
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.execute(DOWNGRADE_SQL)

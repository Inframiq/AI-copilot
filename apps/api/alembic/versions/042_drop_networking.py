"""drop external_contacts, connection_requests and profiles

Revision ID: 042
Revises: 041
Create Date: 2026-10-15 00:00:00.000000

Networking was removed from the app (it was already out of the menu).
Its three tables held one networking profile, no connection requests and
no contacts. profiles and connection_requests were made by the Supabase SQL
in apps/web/supabase/migrations (001, 008), so they are dropped only where
they exist (not in the local test database).

Downgrade recreates all three empty: external_contacts as 004 made it, and,
where Supabase's auth schema and browser roles exist, profiles and
connection_requests with the policies from 001 and 008 and the grants 040
left them.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "042"
down_revision: Union[str, None] = "041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

UPGRADE_SQL = """
DROP TABLE IF EXISTS public.connection_requests;
DROP TABLE IF EXISTS public.profiles;
"""

DOWNGRADE_SQL = """
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;

  CREATE TABLE public.profiles (
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
  ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "profiles_select_authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
  CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
  CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());
  CREATE POLICY "profiles_delete_own" ON public.profiles FOR DELETE TO authenticated USING (id = auth.uid());

  CREATE TABLE public.connection_requests (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    to_user    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status     text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at timestamptz DEFAULT now(),
    UNIQUE (from_user, to_user)
  );
  ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "conn_select_participant" ON public.connection_requests FOR SELECT TO authenticated
    USING (from_user = auth.uid() OR to_user = auth.uid());
  CREATE POLICY "conn_insert_sender" ON public.connection_requests FOR INSERT TO authenticated
    WITH CHECK (from_user = auth.uid() AND status = 'pending' AND from_user <> to_user);
  CREATE POLICY "conn_update_recipient" ON public.connection_requests FOR UPDATE TO authenticated
    USING (to_user = auth.uid()) WITH CHECK (to_user = auth.uid());
  CREATE POLICY "conn_delete_sender" ON public.connection_requests FOR DELETE TO authenticated
    USING (from_user = auth.uid());

  GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
  GRANT SELECT, INSERT, DELETE ON public.connection_requests TO authenticated;
  GRANT UPDATE (status) ON public.connection_requests TO authenticated;
END $$;
"""


def upgrade() -> None:
    op.drop_table("external_contacts")
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    op.create_table(
        "external_contacts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(255), nullable=False),
        sa.Column("company", sa.String(255), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="new"),
        sa.Column("notes", sa.Text, nullable=False, server_default=""),
        sa.Column("email", sa.String(255), nullable=False, server_default=""),
        sa.Column("linkedin_url", sa.Text, nullable=False, server_default=""),
        sa.Column("last_contact", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False),
    )
    op.create_index("ix_external_contacts_user_id", "external_contacts", ["user_id"])
    op.execute(DOWNGRADE_SQL)

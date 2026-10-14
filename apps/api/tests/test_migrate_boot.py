import pathlib

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.migrate import unknown_revision

INI = pathlib.Path(__file__).parents[1] / "alembic.ini"
ENV_PY = pathlib.Path(__file__).parents[1] / "alembic/env.py"


def _script() -> ScriptDirectory:
    return ScriptDirectory.from_config(Config(str(INI)))


def test_a_database_ahead_of_the_code_does_not_block_the_boot():
    # The outage: the database was at 039 while the deployed code stopped at 037.
    assert unknown_revision(_script(), "999") is True


def test_known_and_empty_databases_still_migrate():
    script = _script()
    assert unknown_revision(script, script.get_current_head()) is False
    assert unknown_revision(script, "001") is False
    assert unknown_revision(script, None) is False


def test_boot_commands_use_the_resilient_migrate_step():
    root = pathlib.Path(__file__).parents[1]
    for name in ("Dockerfile", "Procfile"):
        src = (root / name).read_text(encoding="utf-8")
        assert "python -m app.migrate &&" in src
        assert "alembic upgrade head" not in src


def test_hand_migrations_of_a_remote_database_are_refused():
    src = ENV_PY.read_text(encoding="utf-8")
    assert "_refuse_hand_migrating_a_shared_database()" in src
    assert "ALLOW_REMOTE_MIGRATION" in src

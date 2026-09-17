import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/021_reverted_bullets.py"


def test_migration_021_adds_reverted_bullets_and_chains_from_020():
    spec = importlib.util.spec_from_file_location("m021", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "021"
    assert m.down_revision == "020"
    src = MIG.read_text()
    assert "reverted_bullets" in src
    assert "add_column" in src and "drop_column" in src  # up + down


def test_tailoring_session_model_has_the_column():
    from app.db.models import TailoringSession
    assert "reverted_bullets" in TailoringSession.__table__.columns
    assert TailoringSession.__table__.columns["reverted_bullets"].nullable

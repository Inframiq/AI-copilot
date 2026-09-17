import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/022_bullet_rationale.py"


def test_migration_022_adds_bullet_rationale_and_chains_from_021():
    spec = importlib.util.spec_from_file_location("m022", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "022"
    assert m.down_revision == "021"
    src = MIG.read_text()
    assert "bullet_rationale" in src
    assert "add_column" in src and "drop_column" in src


def test_tailoring_session_model_has_the_rationale_column():
    from app.db.models import TailoringSession
    assert "bullet_rationale" in TailoringSession.__table__.columns
    assert TailoringSession.__table__.columns["bullet_rationale"].nullable

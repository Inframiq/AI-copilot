import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/023_ats_score_before.py"


def test_migration_023_adds_ats_score_before_and_chains_from_022():
    spec = importlib.util.spec_from_file_location("m023", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "023"
    assert m.down_revision == "022"
    src = MIG.read_text()
    assert "ats_score_before" in src
    assert "add_column" in src and "drop_column" in src


def test_the_session_model_has_the_column():
    from app.db.models import TailoringSession
    assert "ats_score_before" in TailoringSession.__table__.columns
    assert TailoringSession.__table__.columns["ats_score_before"].nullable

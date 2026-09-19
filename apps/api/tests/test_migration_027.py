import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/027_session_quantify_prompts.py"


def test_migration_027_adds_quantify_prompts_and_chains_from_026():
    spec = importlib.util.spec_from_file_location("m027", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "027"
    assert m.down_revision == "026"
    src = MIG.read_text(encoding="utf-8")
    assert "quantify_prompts" in src
    assert "add_column" in src and "drop_column" in src
    # Older sessions have no questions: the column must accept NULL.
    assert "nullable=True" in src


def test_the_session_model_has_the_column():
    from app.db.models import TailoringSession
    assert "quantify_prompts" in TailoringSession.__table__.columns
    assert TailoringSession.__table__.columns["quantify_prompts"].nullable

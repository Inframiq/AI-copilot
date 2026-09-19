import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/026_resume_font_sizes.py"


def test_migration_026_adds_the_size_columns_and_chains_from_025():
    spec = importlib.util.spec_from_file_location("m026", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "026"
    assert m.down_revision == "025"
    src = MIG.read_text()
    assert "heading_size_delta" in src and "body_size_delta" in src
    assert "add_column" in src and "drop_column" in src


def test_it_backfills_existing_rows_with_standard():
    """server_default, not just default.

    A Python-side default only applies to rows this process inserts. Without
    the server default the column would be NULL on every existing résumé, and
    NOT NULL would refuse to add it at all.
    """
    src = MIG.read_text()
    assert 'server_default="0"' in src
    assert "nullable=False" in src


def test_the_resume_model_has_the_columns():
    from app.db.models import Resume
    for column in ("heading_size_delta", "body_size_delta"):
        assert column in Resume.__table__.columns
        assert not Resume.__table__.columns[column].nullable

import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/056_resume_page_size.py"


def test_migration_056_adds_page_size_and_chains_from_055():
    spec = importlib.util.spec_from_file_location("m056", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "056"
    assert m.down_revision == "055"
    src = MIG.read_text(encoding="utf-8")
    assert "add_column" in src and "drop_column" in src


def test_existing_rows_get_a4_and_only_known_sizes_are_allowed():
    """server_default, so every résumé saved so far keeps the A4 it always
    rendered on; the check constraint keeps anything else out of the column
    whatever writes to it."""
    src = MIG.read_text(encoding="utf-8")
    assert 'server_default="A4"' in src and "nullable=False" in src
    assert "page_size IN ('A4', 'Letter')" in src


def test_the_resume_model_has_the_column():
    from app.db.models import Resume
    column = Resume.__table__.columns["page_size"]
    assert not column.nullable

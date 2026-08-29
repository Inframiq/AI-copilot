import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/014_ats_fixes_and_bullet_importance.py"


def test_migration_014_declares_the_two_columns_and_chains_from_013():
    spec = importlib.util.spec_from_file_location("m014", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "014"
    assert m.down_revision == "013"
    src = MIG.read_text()
    assert "ats_fixes" in src and "bullet_importance" in src
    assert "add_column" in src and "drop_column" in src  # up + down

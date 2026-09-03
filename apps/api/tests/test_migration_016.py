import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/016_ai_usage_events.py"


def test_migration_016_creates_ai_usage_events_and_chains_from_015():
    spec = importlib.util.spec_from_file_location("m016", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "016"
    assert m.down_revision == "015"
    src = MIG.read_text()
    assert "ai_usage_events" in src
    assert "create_table" in src and "drop_table" in src  # up + down
    for col in ("user_id", "action", "call_name", "input_tokens", "output_tokens", "total_tokens"):
        assert col in src

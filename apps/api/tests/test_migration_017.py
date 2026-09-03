import importlib.util
import pathlib

MIG = pathlib.Path(__file__).parents[1] / "alembic/versions/017_subscriptions.py"


def test_migration_017_creates_subscriptions_and_chains_from_016():
    spec = importlib.util.spec_from_file_location("m017", MIG)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "017"
    assert m.down_revision == "016"
    src = MIG.read_text()
    assert "subscriptions" in src
    assert "create_table" in src and "drop_table" in src
    for col in ("user_id", "plan", "status", "credits_remaining", "credits_allotment",
                "current_period_end", "provider_subscription_id"):
        assert col in src

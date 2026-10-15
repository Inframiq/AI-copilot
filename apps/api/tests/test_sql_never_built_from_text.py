"""No SQL is ever built from pieces of text (test DB-002).

User input reaches the database only as a bound value: through SQLAlchemy's
query builder, or a text() query with :placeholders. Joining a value into the
SQL itself (f-string, %, .format, +) would let that value change the query,
so this fails on any such query anywhere in app/, whether or not the value
looks user-controlled today."""
import ast
import pathlib

APP = pathlib.Path(__file__).parents[1] / "app"

# Calls that take SQL text as their first argument.
SQL_TAKING = {"text", "exec_driver_sql", "literal_column", "literal"}
# Calls that run their first argument as SQL when it is a string.
SQL_RUNNING = {"execute", "executemany", "fetch", "fetchrow", "fetchval"}


def _name(func: ast.expr) -> str | None:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def _built_from_pieces(node: ast.expr) -> bool:
    """An f-string, %-formatting, .format(), or + / join on strings."""
    if isinstance(node, ast.JoinedStr):
        return True
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Mod, ast.Add)):
        return True
    if isinstance(node, ast.Call) and _name(node.func) == "format":
        return True
    # ", ".join(parts), not SQLAlchemy's select(...).join(...)
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "join"
            and isinstance(node.func.value, ast.Constant) and isinstance(node.func.value.value, str)):
        return True
    return False


def _offences(root: pathlib.Path = APP) -> list[str]:
    found = []
    for path in sorted(root.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not node.args:
                continue
            name, first = _name(node.func), node.args[0]
            where = f"{path.relative_to(root.parent)}:{node.lineno}"
            if name in SQL_TAKING and not (isinstance(first, ast.Constant) and isinstance(first.value, str)):
                found.append(f"{where}: {name}() must get one plain string literal with :placeholders")
            elif name in SQL_RUNNING and _built_from_pieces(first):
                found.append(f"{where}: {name}() runs SQL built from pieces of text")
    return found


def test_no_query_is_built_from_pieces_of_text():
    assert _offences() == [], "\n".join(_offences())


def test_the_check_catches_the_patterns_it_exists_for(tmp_path):
    bad = tmp_path / "app"
    bad.mkdir()
    (bad / "bad.py").write_text(
        "from sqlalchemy import text\n"
        "def a(db, title):\n"
        "    db.execute(text(f\"SELECT 1 WHERE title = '{title}'\"))\n"
        "    db.execute(text(\"SELECT 1 WHERE title = '\" + title + \"'\"))\n"
        "    db.execute(text(\"SELECT 1 WHERE title = '%s'\" % title))\n"
        "    db.execute(text(\"SELECT {}\".format(title)))\n"
        "    db.execute(f\"DELETE FROM t WHERE id = {title}\")\n"
        "    db.execute(\" AND \".join(parts))\n"
        "def ok(db, title):\n"
        "    db.execute(select(t).join(u))\n"
        "    db.execute(text(\"SELECT 1 WHERE title = :title\"), {\"title\": title})\n",
        encoding="utf-8",
    )
    found = _offences(bad)
    assert len(found) == 6, found
    assert not any(f":{n}:" in f for f in found for n in (10, 11)), "the safe queries are fine"

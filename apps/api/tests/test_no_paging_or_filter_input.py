"""No route takes paging, filtering or sorting from the query string (test
ATK-048).

Every list the API serves is the signed-in account's own records, whole: the
owner filter is written into the route, and nothing a caller adds to the
URL (?limit=, ?offset=, ?user_id=, ?filter=…) reaches a query. A route that
starts reading the query string fails here, so a paging or filter feature
is added on purpose — with its own owner check and tests — never by a
stray parameter.
"""
from fastapi.routing import APIRoute

from app.main import app


def _query_params(dependant) -> list[str]:
    names = [p.name for p in dependant.query_params]
    for sub in dependant.dependencies:
        names += _query_params(sub)
    return names


def test_no_route_reads_the_query_string():
    found = {
        f"{sorted(route.methods)} {route.path}": params
        for route in app.routes
        if isinstance(route, APIRoute) and (params := _query_params(route.dependant))
    }
    assert found == {}, f"routes that take query-string input: {found}"


def test_the_check_sees_a_query_parameter():
    # Proof the walk above would catch one, including inside a dependency.
    from fastapi import Depends, FastAPI

    probe = FastAPI()

    def page(limit: int = 50):
        return limit

    @probe.get("/things")
    async def things(offset: int = 0, size: int = Depends(page)):
        return []

    route = next(r for r in probe.routes if isinstance(r, APIRoute))
    assert sorted(_query_params(route.dependant)) == ["limit", "offset"]

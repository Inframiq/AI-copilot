"""No request a user can send carries a privileged field (test ATK-013).

Plan, credits, role and ownership are decided by the server: plan and
credits live in subscriptions, which only app.core.credits and the admin
routes write; admin is the token's email plus its Google provider; the
owner is the token's subject. So no non-admin request schema may even
declare a field like that, and none may pass unknown fields through
(extra="allow"), or a client could set them by adding them to the body."""
import types
import typing

import pytest
from pydantic import BaseModel

from app.main import app
from tests.test_admin_routes_guarded import ADMIN_ROUTES, _flatten, _method

PRIVILEGED = {
    "role", "roles", "is_admin", "admin", "is_superuser", "permissions", "scopes",
    "plan", "tier", "subscription", "credits", "credits_remaining", "credits_allotment",
    "user_id", "owner_id", "owner", "app_metadata",
}
ADMIN = {(path, _method(route)) for path, route, _ in ADMIN_ROUTES}


def _models(annotation) -> list[type[BaseModel]]:
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return [annotation]
    if typing.get_origin(annotation) in (typing.Union, types.UnionType, list, dict, tuple):
        return [m for arg in typing.get_args(annotation) for m in _models(arg)]
    return []


def _fields(model: type[BaseModel], seen=None) -> dict[str, type[BaseModel]]:
    """Every field name in the model and the models nested in it."""
    seen = seen or set()
    if model in seen:
        return {}
    seen.add(model)
    out = {}
    for name, info in model.model_fields.items():
        out[name] = model
        for nested in _models(info.annotation):
            out |= _fields(nested, seen)
    return out


BODIES = [
    (f"{_method(route)} {path}", param)
    for path, route, _ in _flatten(app.routes)
    if (path, _method(route)) not in ADMIN
    for param in route.dependant.body_params
]


def test_the_scan_sees_the_request_bodies():
    assert len(BODIES) >= 25


@pytest.mark.parametrize("route,param", BODIES, ids=[f"{r} {p.name}" for r, p in BODIES])
def test_no_privileged_field_in_a_user_request(route, param):
    assert param.name not in PRIVILEGED, f"{route} takes a privileged form field {param.name!r}"
    for model in _models(param.field_info.annotation):
        hits = {name: m.__name__ for name, m in _fields(model).items() if name in PRIVILEGED}
        assert hits == {}, f"{route} accepts privileged fields {hits}"
        for m in {model, *_fields(model).values()}:
            assert m.model_config.get("extra") != "allow", f"{m.__name__} passes unknown fields through"

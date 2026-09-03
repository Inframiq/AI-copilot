from fastapi import APIRouter

from app.core.credits import PLANS

router = APIRouter(tags=["plans"])


@router.get("/plans")
async def list_plans():
    """Static plan catalog for the pricing UI. No auth — no user data."""
    return {"plans": PLANS}

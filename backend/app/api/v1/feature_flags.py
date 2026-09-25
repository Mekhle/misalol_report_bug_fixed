from fastapi import APIRouter

from app.db import admin_db

router = APIRouter(prefix="/feature-flags", tags=["feature-flags"])


@router.get("")
async def feature_flags() -> dict:
    return {"flags": await admin_db.public_flags()}

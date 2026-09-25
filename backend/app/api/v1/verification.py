from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.v1.profile import require_user
from app.core.profile_sanitize import public_social_href
from app.core.rate_limit import rate_limit
from app.db import admin_db
from app.models import User

router = APIRouter(prefix="/verification", tags=["verification"])


class VerificationApplyRequest(BaseModel):
    reason: str = Field(min_length=12, max_length=400)
    proofUrl: str = Field(default="", max_length=500)


def _plain_reason(value: str) -> str:
    return " ".join((value or "").split())[:400]


def _public_request(row: dict[str, Any] | None, verified: bool) -> dict[str, Any]:
    if verified:
        return {"status": "verified"}
    if not row:
        return {"status": "none"}
    return {
        "status": str(row.get("status") or "none"),
        "reason": str(row.get("reason") or ""),
        "proofUrl": str(row.get("proof_url") or ""),
        "reviewNote": str(row.get("review_note") or ""),
        "createdAt": row.get("created_at").isoformat() if row.get("created_at") else None,
    }


@router.get("/me")
async def my_verification(user: User = Depends(require_user)) -> dict[str, Any]:
    verified = await admin_db.user_has_badge(user.id, "verified")
    return _public_request(await admin_db.get_verification_for_user(user.id), verified)


@router.post("/me")
async def apply_verification(payload: VerificationApplyRequest, user: User = Depends(require_user)) -> dict[str, Any]:
    await rate_limit(f"rl:verify:{user.id}", 3, 86400)
    if await admin_db.user_has_badge(user.id, "verified"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This account is already verified.")
    existing = await admin_db.get_verification_for_user(user.id)
    if existing and existing.get("status") == "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A verification request is already pending.")
    reason = _plain_reason(payload.reason)
    if len(reason) < 12:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tell us a bit more about why you should be verified.")
    proof = ""
    if payload.proofUrl.strip():
        proof = public_social_href(payload.proofUrl.strip(), "Custom URL") or ""
        if not proof:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use an http or https proof link.")
    try:
        saved = await admin_db.create_verification_request(user.id, reason, proof)
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A verification request is already pending.") from None
    return _public_request(saved, False)

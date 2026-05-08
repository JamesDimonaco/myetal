"""``/me/*`` — calling-user routes that survive the Better Auth cutover.

Path separation rationale: ``/auth/*`` is owned by Better Auth on the
Next.js side post-cutover (sign-in, sign-up, OAuth, password reset,
session management). ``/me/*`` belongs to FastAPI and exposes only
domain operations on the calling user's row that BA does not own:

* ``GET /me`` — return the calling user's profile in our existing
  ``UserResponse`` shape. Web/mobile clients that today call
  ``GET /auth/me`` repoint here as part of Phase 3 / Phase 4 (a
  one-line URL change in each caller).
* ``PATCH /me/orcid`` — manual ORCID iD entry with dup-check semantics.
  Survived from the legacy ``PATCH /auth/me`` body shape; mounted
  under ``/me/orcid`` to make the noun explicit.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from myetal_api.api.deps import CurrentUser, DbSession
from myetal_api.schemas.user import UpdateMeRequest, UserResponse
from myetal_api.services import users as users_service

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserResponse)
async def get_me(user: CurrentUser) -> UserResponse:
    """Return the calling user's profile.

    Same JSON shape as the legacy ``GET /auth/me``. Auth via the BA
    JWT (cookie or Bearer); see ``api/deps.py::get_current_user``.
    """
    return UserResponse.model_validate(user)


@router.patch("/orcid", response_model=UserResponse)
async def update_me_orcid(
    body: UpdateMeRequest, user: CurrentUser, db: DbSession
) -> UserResponse:
    """Set or clear the calling user's ``orcid_id`` (manual entry).

    409 when the iD is already linked to another user — same contract
    the web profile screen relies on. ``orcid_id: null`` clears.
    """
    fields = body.model_dump(exclude_unset=True)
    if "orcid_id" in fields:
        try:
            user = await users_service.set_user_orcid_id(
                db, user.id, fields["orcid_id"]
            )
        except users_service.OrcidIdAlreadyLinked as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="orcid_id is already linked to another account",
            ) from exc
    return UserResponse.model_validate(user)

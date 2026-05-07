import uuid

from fastapi import APIRouter, HTTPException, Request, status

from myetal_api.api.deps import CurrentUser, DbSession
from myetal_api.core.rate_limit import AUTH_LIMIT, limiter
from myetal_api.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    SessionResponse,
    TokenPair,
)
from myetal_api.schemas.user import UpdateMeRequest, UserResponse
from myetal_api.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


# Note on slowapi: each `@limiter.limit(...)` decorated route MUST have a
# `request: Request` parameter — slowapi reads `request.client.host` from it
# to derive the per-IP key. Drop the param and slowapi raises at request time.


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
@limiter.limit(AUTH_LIMIT)
async def register(request: Request, body: RegisterRequest, db: DbSession) -> TokenPair:
    try:
        _, access, refresh = await auth_service.register_with_password(
            db, body.email, body.password, body.name
        )
    except auth_service.EmailAlreadyRegistered as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="email already registered",
        ) from exc
    return TokenPair(access_token=access, refresh_token=refresh)


@router.post("/login", response_model=TokenPair)
@limiter.limit(AUTH_LIMIT)
async def login(request: Request, body: LoginRequest, db: DbSession) -> TokenPair:
    try:
        _, access, refresh = await auth_service.login_with_password(db, body.email, body.password)
    except auth_service.InvalidCredentials as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid credentials",
        ) from exc
    return TokenPair(access_token=access, refresh_token=refresh)


@router.post("/refresh", response_model=TokenPair)
@limiter.limit(AUTH_LIMIT)
async def refresh(request: Request, body: RefreshRequest, db: DbSession) -> TokenPair:
    try:
        access, new_refresh = await auth_service.rotate_refresh_token(db, body.refresh_token)
    except auth_service.InvalidRefreshToken as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid refresh token",
        ) from exc
    return TokenPair(access_token=access, refresh_token=new_refresh)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest, db: DbSession) -> None:
    await auth_service.logout(db, body.refresh_token)


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser) -> UserResponse:
    return UserResponse.model_validate(user)


@router.patch("/me", response_model=UserResponse)
async def update_me(body: UpdateMeRequest, user: CurrentUser, db: DbSession) -> UserResponse:
    """Partial update of the calling user's profile. Currently only
    ``orcid_id`` is updatable here. Fields omitted from the request body
    are left unchanged; sending ``null`` (or ``""``) clears the field."""
    fields = body.model_dump(exclude_unset=True)
    if "orcid_id" in fields:
        try:
            user = await auth_service.set_user_orcid_id(db, user.id, fields["orcid_id"])
        except auth_service.OrcidIdAlreadyClaimed as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="orcid_id is already linked to another account",
            ) from exc
    return UserResponse.model_validate(user)


@router.get("/me/sessions", response_model=list[SessionResponse])
async def list_my_sessions(user: CurrentUser, db: DbSession) -> list[SessionResponse]:
    """List the calling user's refresh-token rows (= signed-in devices).
    Hash is intentionally omitted by `SessionResponse`."""
    sessions = await auth_service.list_sessions(db, user.id)
    return [SessionResponse.model_validate(s) for s in sessions]


@router.post("/me/sessions/{session_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_my_session(session_id: uuid.UUID, user: CurrentUser, db: DbSession) -> None:
    """Sign a specific device out. 204 on success, 404 if the session doesn't
    belong to the caller (or doesn't exist — we don't distinguish)."""
    ok = await auth_service.revoke_session(db, user.id, session_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="session not found")

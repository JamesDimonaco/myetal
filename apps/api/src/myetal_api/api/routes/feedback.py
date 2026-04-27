"""User feedback: feature requests and bug reports.

Per `docs/tickets/user-feedback-system.md`. Anonymous and authenticated
submissions are both allowed. Feedback is persisted in the DB and a
best-effort Telegram notification is sent.
"""

import uuid

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field

from myetal_api.api.deps import DbSession, OptionalUser
from myetal_api.core.rate_limit import FEEDBACK_LIMIT, limiter
from myetal_api.models.feedback import Feedback, FeedbackType
from myetal_api.services.telegram import send_feedback_notification

router = APIRouter(tags=["feedback"])


class FeedbackSubmit(BaseModel):
    type: FeedbackType
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)
    email: str | None = Field(default=None, max_length=320)


class FeedbackResponse(BaseModel):
    id: uuid.UUID
    message: str = "feedback received"


@router.post(
    "/feedback",
    response_model=FeedbackResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit(FEEDBACK_LIMIT)
async def submit_feedback(
    body: FeedbackSubmit,
    request: Request,
    user: OptionalUser,
    db: DbSession,
) -> FeedbackResponse:
    """Submit a feature request or bug report.

    Works both signed-in and anonymously. Rate-limited to 5/hour per IP.
    On success the feedback is saved to the DB and a best-effort Telegram
    notification is sent.
    """
    feedback = Feedback(
        user_id=user.id if user else None,
        type=body.type,
        title=body.title,
        description=body.description,
        email=body.email,
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)

    # Best-effort Telegram notification — never fails the request.
    await send_feedback_notification(
        feedback_id=feedback.id,
        feedback_type=feedback.type,
        title=feedback.title,
        description=feedback.description,
        user_name=user.name if user else None,
        user_email=user.email if user else None,
        reply_email=feedback.email,
    )

    return FeedbackResponse(id=feedback.id)

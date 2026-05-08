# Ticket: User Feedback System (Feature Requests + Bug Reports)

**Status:** Draft
**Owner:** James
**Created:** 2026-04-27
**Estimate:** 1–1.5 days

---

## Goal

Let users submit feedback (feature requests or bug reports) from inside the app. Feedback goes to a Telegram bot so James gets instant push notifications. Users can optionally provide an email for follow-up.

---

## User flow

### Web: `/feedback` page + footer link

1. User lands on `/feedback` (linked from footer + profile page)
2. Two big cards: **"Request a feature"** and **"Report an issue"**
3. User picks one → form appears:
   - **Type** (pre-selected from card choice): `feature_request` | `bug_report`
   - **Title** (required, max 200 chars): "What would you like?" / "What went wrong?"
   - **Description** (required, max 2000 chars): textarea with placeholder text
   - **Email for follow-up:**
     - If signed in: pre-filled with their email, shown as "We'll reply to {email}" with an option to change
     - If not signed in: input field with label "Want us to follow up? Leave your email (optional)"
     - Make it visually clear whether they will or won't get a response
   - **Submit** button
4. On success: "Thanks! We've received your feedback." If email provided: "We'll get back to you at {email}."

### Mobile: Feedback screen accessible from Profile tab

Same flow, native UI. Accessible via a "Send feedback" row in the Profile screen.

---

## API

### `POST /feedback`

```python
class FeedbackType(StrEnum):
    FEATURE_REQUEST = "feature_request"
    BUG_REPORT = "bug_report"

class FeedbackSubmit(BaseModel):
    type: FeedbackType
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)
    email: str | None = Field(default=None, max_length=320)

class FeedbackResponse(BaseModel):
    id: uuid.UUID
    message: str = "feedback received"
```

- Auth: `OptionalUser` — works signed in or anon
- Rate limit: 5/hour per IP (anon), 10/hour per user (authed)
- Stores in a `feedback` table (for record-keeping) AND sends to Telegram

### `feedback` table

```sql
CREATE TABLE feedback (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NULL REFERENCES users(id) ON DELETE SET NULL,
    type            VARCHAR(20) NOT NULL,  -- 'feature_request' | 'bug_report'
    title           VARCHAR(200) NOT NULL,
    description     TEXT        NOT NULL,
    email           VARCHAR(320) NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Telegram notification

On every feedback submission, send a message to a Telegram bot:

```
🐛 Bug Report  /  💡 Feature Request

Title: {title}
---
{description}
---
From: {user.name} ({user.email}) / anon
Reply-to: {email or "no email provided"}
ID: {id}
```

Implementation:
- Use the Telegram Bot API: `POST https://api.telegram.org/bot{token}/sendMessage`
- Env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- Best-effort: if Telegram fails, the feedback is still saved in the DB. Log the error, don't fail the request.
- Use `httpx` (already a dependency) for the outbound call

### How to set up the Telegram bot

1. Message @BotFather on Telegram → `/newbot` → name it "MyEtAl Feedback"
2. Copy the bot token → set as `TELEGRAM_BOT_TOKEN`
3. Create a group/channel, add the bot, send a message
4. Get the chat ID: `curl https://api.telegram.org/bot{token}/getUpdates` → find `chat.id`
5. Set as `TELEGRAM_CHAT_ID`

---

## UI details

### Feedback type cards

Two side-by-side cards on desktop, stacked on mobile:

**Feature request card:**
- Icon: lightbulb or sparkle
- Title: "Request a feature"
- Subtitle: "Tell us what would make MyEtAl better for your research"

**Bug report card:**
- Icon: bug or warning
- Title: "Report an issue"
- Subtitle: "Something broken or not working as expected?"

### Email field UX

This is the key UX decision. Make it crystal clear:

- **Signed in:** Show "We'll reply to **james@example.com**" with a small "use a different email" toggle. No extra input needed.
- **Not signed in:** Show the email input with label "Want a reply? Leave your email" and a helper: "Without an email, we can't follow up — but we still read every submission."
- **Visual indicator:** When email is provided, show a green checkmark + "You'll hear back from us." When not, show a muted note: "Anonymous — no reply possible."

### Success state

Don't just flash a toast. Show a full success screen:
- Checkmark animation (or static icon)
- "Thanks for your feedback!"
- If email: "We'll get back to you at {email}"
- If no email: "We read every submission, even anonymous ones"
- "Submit another" link + "Back to app" link

---

## Decisions needed

1. **Telegram bot name** — "MyEtAl Feedback" or "MyEtAl Alerts" (could reuse for other notifications later)
2. **Admin UI for feedback?** — For now, just Telegram + raw DB access. A `/dashboard/admin/feedback` page can be a follow-up.
3. **Categorisation beyond feature/bug?** — Keep it simple for v1. Add tags/priority later if volume warrants it.

---

## Out of scope

- Admin dashboard for feedback (follow-up)
- Email auto-replies to the user (follow-up — needs email sending infra)
- Voting / upvoting on feature requests (community feature, way later)
- Integration with Linear/GitHub Issues (follow-up when volume warrants)
- In-app notification when feedback is resolved

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Case-convention rules (locked)

Mixing `camelCase` and `snake_case` across language boundaries has bitten us
multiple times. The conventions below are the locked answers — do not
"normalise" them, do not argue with them. If something looks wrong, re-read
the table.

| Layer | Convention | Why |
|---|---|---|
| Postgres columns (SQL) | `snake_case` | Postgres / Alembic convention. 15+ migrations baked in. |
| SQLAlchemy attributes (`apps/api`) | `snake_case` | Python convention; matches the columns. |
| Drizzle JS field names (`apps/web/src/lib/db-schema.ts`) | `camelCase` | TS convention. The string passed to `boolean('is_admin')` is the DB column; the JS key on the object is the JS field name. |
| Better Auth config keys (`auth.ts`, `additionalFields`, `fields`) | `camelCase` | Must match drizzle JS field names. BA's defaults are camelCase. |
| Better Auth client / server queries on user/session/account objects | `camelCase` | e.g. `users.orcidId`, `account.providerId`, `user.isAdmin`, `user.emailVerified`. |
| Mobile TS code (`apps/mobile`) | `camelCase` | TS convention. |
| FastAPI JSON request/response bodies | `snake_case` | Pydantic serialises Python attrs as-is. The TS types in `apps/web/src/types/auth.ts` and `apps/mobile/types/auth.ts` mirror this — `email_verified`, `is_admin`, `orcid_id`, `avatar_url`, etc. |
| JWT claims wire format (BA mints, FastAPI verifies) | `snake_case` | BA's `definePayload` builds the dict; pyjwt reads it. The single `is_admin: ...` line in `apps/web/src/lib/auth.ts` is intentional — it's the wire payload, not a JS access. |
| External API responses (Crossref, ORCID, GitHub, Resend) | whatever the vendor returns | Map to internal camelCase types at the seam (see `lib/github.ts::nullableString(data.owner?.avatar_url)`). |

### Common mistakes to NOT make

- `user.is_admin` on a Better Auth user/session object → wrong, BA returns `isAdmin`.
- `eq(users.orcid_id, ...)` in a drizzle query → wrong, drizzle field is `orcidId`.
- Adding `additionalFields: { is_admin: {...} }` to BA config → wrong, the key must be the JS field name (`isAdmin`).
- Renaming `email_verified` → `emailVerified` in `apps/web/src/types/auth.ts` → wrong, it's the FastAPI wire shape.
- "Fixing" the `is_admin: (user as ...).isAdmin ?? false` line in `definePayload` → wrong, the LEFT side is the JWT claim (snake_case wire), the RIGHT side is the JS access (camelCase). Both are correct.

When in doubt: which side of the seam are you on? JS object → camelCase. SQL column / JSON wire / JWT claim → snake_case.

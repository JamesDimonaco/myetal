# Surface form errors so users understand them

**Status:** Backlog — small, high-value-per-effort
**Created:** 2026-05-11
**Owner:** James
**Effort estimate:** ~30-60 min
**Depends on:** none

---

## TL;DR

Today a user saw `"Too small: expected number to be greater than zero"` when trying to save a share. The actual cause was `file_size_bytes=0` on a non-PDF item (a hidden field they could neither see nor edit). The raw Zod error message leaked through to the UI as if it were addressed to them.

Pattern issue: when a Zod validation fails on a field the user can't reach, the form should surface a generic, friendly error — not the raw schema error.

---

## Where it surfaces today

Primary offender: `apps/web/src/components/share-editor.tsx`. Likely also relevant:
- `apps/web/src/app/sign-up/sign-up-form.tsx` if any hidden fields exist
- `apps/web/src/app/forgot-password/page.tsx`, `/reset-password/page.tsx`
- Future forms with computed fields

Common pattern: a `react-hook-form` form using `zodResolver(schema)`, where validation errors come back keyed by field path and the form renders the error string verbatim under each field. Hidden fields have no UI to render under, so the error appears in the form-level `errors._root` slot (or worse — silently fails to submit with no surfaced message).

---

## What "good" looks like

For each form:

1. **User-editable fields**: inline error directly under the field. Use the schema's bespoke error message (e.g., `'Item title required'`) — these are written for users.
2. **Hidden / computed fields**: route to a top-of-form banner with friendly copy: *"Something didn't validate. Try again or contact support."*
3. **Always log the underlying Zod issue to PostHog** so we can spot patterns of users hitting this without it leaking the technical message.

---

## Implementation sketch

```ts
// somewhere shared
const USER_FIELDS = new Set([
  'name', 'description', 'type',
  'items.*.title', 'items.*.doi', 'items.*.url', // etc
]);

function partitionErrors(errors: z.ZodIssue[]) {
  const inline: Record<string, string> = {};
  const generic: z.ZodIssue[] = [];
  for (const issue of errors) {
    const path = issue.path.join('.').replace(/\d+/g, '*');
    if (USER_FIELDS.has(path)) {
      inline[issue.path.join('.')] = issue.message;
    } else {
      generic.push(issue);
    }
  }
  return { inline, generic };
}
```

Or — simpler — define the schema's error messages with `.refine` so the surface text is already user-friendly, and just always render whatever Zod says. The bug was upstream (schema rejected something it shouldn't have, not the surface text per se), but the surface improvement is a defense-in-depth measure.

Actually the cheapest fix: on every form, wrap submit handler in a try/catch around `schema.parse(formData)`. On failure, check if all errors are in user-editable paths. If yes, render inline as today. If any error is in a hidden path, render a generic banner *and* log the technical detail to PostHog.

---

## Out of scope

- Don't redesign the form UI
- Don't switch form libraries
- Don't restructure schemas

This is purely a surface-routing fix. ~30-60 min of careful work.

---

## Why deferred (slightly)

- The class of bug (validating against a hidden field) is rare. Today's hit was the first.
- The fix is meaningful but not load-bearing for current users.
- Polish-y tickets get done in batches; bundle with the next "form polish day."

---

## Triggers to expedite

- Another user reports an opaque Zod error → ticket jumps the queue
- New form with hidden / computed fields → fix as part of that PR rather than retroactively
- Mobile rollout (when mobile responsive sweep is done) → mobile users are more error-message-sensitive

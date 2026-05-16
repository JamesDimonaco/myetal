# Big-files health review

Read-only review of the four largest / most-edited files after the 11 UX-stream
changes. `staging`.

## TL;DR

- `share-editor.tsx`: multi-responsibility (form + autosave + QR + dirty guard + 5 mutations). Cheapest win: split presentational tail at line 1082 to a sibling file (~470 LOC) — zero logic change.
- `add-item-modal.tsx`: structurally OK but ships a dead branch (`add-item-modal.tsx:1303-1313`) that yields an infinite "Saving draft…" spinner, and `PdfKindPane` (470 LOC, 9 useState + 3 refs) wants `usePdfAutoSaveDraft` extracted.
- `auth.ts` + `ba_security.py`: security-clean. Two low-severity input-hardening nits in `withWwwVariant` (case/port) and `mapOrcidProfileToUser` (unbounded name).

---

## share-editor.tsx — yellow

- **14 useState + 1 ref + 5 mutations** in `ShareEditor` (`share-editor.tsx:314-367`). Most are independently observed and fine.
- **Derived state masquerading as state — `qrMode`** (`share-editor.tsx:353-355`): always `'post-save'` from `handleSave` (line 575), always `'quick-access'` from the Show-QR button (line 832). Ref or compute-at-open. Minor.
- **`justSaved` setTimeout-on-unmounted** (`share-editor.tsx:358, 582`): post-save flow navigates away (line 661) before the 3s timer fires. Replace with `sonner` `toast.success` (already imported, line 23) — portals across routes.
- **`handleSave` is 134 lines** (`share-editor.tsx:454-588`). Extract the payload-mapping block (lines 505-533) to a pure `toApiItems(parsedItems)` — testable, makes the PDF round-trip wire shape (lines 510-517) reviewable. Leave the imperative remainder inline.
- **Non-exhaustive switch** (`share-editor.tsx:1169-1180`): the paper | repo | pdf | link ternary has no type-level exhaustiveness check; a future fifth kind silently falls into `LinkFields`. Switch on `item.kind` and TS will catch it.
- **Split at line 1082** — everything below (`SortableItemRow`, four `*Fields`, `KindBadge`, `PdfFields`, `Field`, `ItemField`, `IconBtn`, `ArrowIcon`, `TrashIcon`, `GripIcon`) is leaf presentational. Move to `share-editor-rows.tsx`. Halves the file, zero logic change. **Worth doing.**

## add-item-modal.tsx — yellow

- **Dead branch** (`add-item-modal.tsx:1303-1313`): "No share AND no auto-save handler — should not happen." Correct — the only caller (`share-editor.tsx:980`) always passes `onAutoSaveDraft`. If it did fire the user sticks on an infinite "Saving draft…" spinner. Delete or replace with `console.error` + close.
- **`PdfKindPane` is 470 lines, 9 useState + 3 refs** (`add-item-modal.tsx:1030-1498`). Three (`draftSaving`, `draftError`, `draftAttemptedRef`) own the W1 auto-save; rest own upload. **Extract `usePdfAutoSaveDraft(onAutoSaveDraft)` → `{saving, error, retry}`** — removes the early-return chain at lines 1270-1313. **Worth doing.**
- **`SearchPane` is 343 lines, 8 useState** (`add-item-modal.tsx:350-692`). Filter/sort helpers (lines 50-116) already pure. Extract `useSearchFilters()` → `{sort, oaOnly, activeTypes, yearFrom, yearTo, authorFilter, hasActiveFilters, processed}`. ~80 LOC saved. **Worth doing.**
- **Type-safety hole.** `filterResults` (`add-item-modal.tsx:78-116`) uses `r.year ?? 0` / `?? 9999` sentinels — silently miscompares if the API ever returns string years. Comment the assumption.
- **Leaky** — `handleFetch` (`add-item-modal.tsx:779-810`) mixes lookup + buffer population; can't be reused for a future "refresh metadata" button. Optional.

## auth.ts — green-yellow

- **Security (low) — `withWwwVariant` (`auth.ts:107-121`) ignores case and port.** `https://WWW.myetal.app:443` won't match either generated variant (BA origin check is a string compare). Risk small (Vercel canonicalises) but normalise: `u.host.toLowerCase()`, strip default ports, replace the 4-char `.slice(4)` with `.replace(/^www\./, '')`.
- **Security (informational) — `mapOrcidProfileToUser` (`auth.ts:380-426`) accepts unbounded `name`/`given_name`/`family_name` from ORCID.** Written to `users.name` (varchar with no max declared in drizzle). Add `name.slice(0, 200)` clamp at line 420. Email fallback is bounded by the `${orcidId}@orcid.invalid` template.
- **JWT verification — clean.** `definePayload` (`auth.ts:330-338`) intentionally snake-cases `is_admin` for the JWT wire (matches AGENTS rules + the Python consumer). The `(user as { isAdmin?: boolean })` cast (line 337) is the documented pattern.
- **`BA_SECRET` only `console.warn`s in prod** (`auth.ts:46-55`); BA itself throws at first request — belt-and-braces, fine.

## ba_security.py — green

- **JWT verification — no holes.** `kid` fail-closed (lines 182-187). `alg` allow-list pinned to EdDSA at both unverified-header check (178-180) and `algorithms=["EdDSA"]` in `jwt.decode` (197) — defends against alg-confusion. `iss` required + matched (200). No path returns claims without `jwt.decode` succeeding.
- **JWKS cache — not poisonable.** Only 2xx response writes `_jwks_fresh` / `_jwks_last_known` (lines 136-138). Malformed JSON raises (121, 134-135) before any cache write. Stale-if-error only reads; an attacker controlling the JWKS host can't substitute a wrong key because `kid` lookup still has to match a verifiable JWK.
- **`time.monotonic()`** (lines 124, 128, 138) is correct for elapsed-time. Flag for future hands: a "expire at midnight" change would want wall-clock.
- **Type hole — `cachetools` is `# type: ignore[import-untyped]`** (line 39). Unavoidable; the `TTLCache[str, dict[str, Any]]` annotation is honest.

---

## Verdict

| File | Status | Reason |
|---|---|---|
| `share-editor.tsx` | yellow | Split at line 1082 + `toApiItems` extract removes ~400 LOC of structural debt without changing behaviour. |
| `add-item-modal.tsx` | yellow | One dead branch, one hook to extract (`usePdfAutoSaveDraft`), one bloated pane (`SearchPane`). |
| `auth.ts` | green-yellow | Two low-severity input nits (`withWwwVariant` case/port, ORCID name length). No exploitable gap. |
| `ba_security.py` | green | Fail-closed everywhere it matters. The `follow_redirects` fix is the right shape. |

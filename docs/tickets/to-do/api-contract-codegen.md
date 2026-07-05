# API contract codegen — one typed source of truth for web + mobile

**Status:** Proof slice DONE (2026-07-05) — package + codegen + CI gate live; `share` migrated on web *and* mobile, both typecheck green; the true types surfaced 8 contract mismatches the hand-written types were hiding (1 substantive, 7 type-lies), all resolved. Reviewed by Luke: verdict SHIP. Roll-out of remaining domains (paper, user, admin, reports) is follow-up. See "Proof slice results" at the bottom.
**Created:** 2026-07-05
**Owner:** James (decisions) / Anakin (design + build)
**Branch:** `feat/api-contract-codegen`

---

## TL;DR

Domain types are hand-maintained in **three** places — the FastAPI Pydantic schemas (the real source of truth), `apps/web/src/types/*`, and a separate copy in `apps/mobile/types/*`. They have already drifted (web `share.ts` exports 18 types, mobile 16; mobile is missing `ShareItemInput` / `ShareItemOut` / `PresignResponse`). Adding one field means editing five files, and web/mobile can silently disagree about the shape of a response.

FastAPI already emits a complete OpenAPI spec for free (`app.openapi()` → **48 paths, 85 component schemas**, no server or DB needed). Nothing consumes it.

**Fix:** generate TypeScript types from that spec into a shared workspace package (`@myetal/api-contract`, which finally fills the empty `packages/` dir), make both frontends consume it, and delete the two hand-written type trees. Type flow becomes one-directional and enforced:

```
Pydantic schemas ──► app.openapi() ──► openapi-typescript ──► packages/api-contract ──┬─► web
  (the source)         (free, static)      (codegen)          (generated .d.ts)       └─► mobile
```

The transport wrappers are **not** the problem and are left alone — see below.

---

## What we already have (and what's actually wrong)

**The transport layer is fine.** There is one core fetch wrapper (`apps/web/src/lib/api.ts`, mirrored in `apps/mobile/lib/api.ts`) plus two thin auth-context adapters on web:

| Wrapper | Auth context | Legitimate? |
|---|---|---|
| `api()` | none / caller-supplied bearer | yes — the shared core |
| `serverFetch()` | RSC mints a Better-Auth JWT via `auth.api.getToken` | yes — RSC-only capability |
| `clientApi()` | routes via `/api/proxy/*` so the httpOnly cookie attaches server-side | yes — client can't mint |
| mobile `api()` | bearer from secure storage + forced-sign-out hook | yes — native context |

Three genuinely different auth contexts exist. Collapsing these into "one wrapper" would throw away real layering. The only transport-level waste is that `ApiError` + `RequestOptions` + the fetch/error/204 logic are copy-pasted between web and mobile (~40 lines). Minor; folded into the package as a bonus.

**The contract is the rot:**

1. `api<T>(path, ...)` — the `T` is a hand-asserted claim. Nothing checks that `path`, method, request body, or response actually match what FastAPI serves. Rename an endpoint → runtime 404, not a compile error.
2. Domain types hand-maintained in three copies, already drifted (numbers above).
3. The OpenAPI spec — a perfect, always-accurate description of the contract — is generated for free and ignored.

**Coverage that makes this worth doing now:** 40 of 55 route decorators already declare `response_model=` (~73%). So codegen produces real, accurate types for the bulk of the surface on day one. The remaining ~15 routes (and the `response_model=list` ones that generate as loose arrays) are the actual work — see "the honest part".

---

## Decisions

### 1. Types-only codegen, not a generated client — **decided**
`openapi-typescript` emits zero-runtime types (`paths`, `components['schemas']`); we keep our own transport. A full client generator (orval, openapi-generator) wants to *own* fetch + auth, which would fight all three auth contexts and the mobile forced-sign-out hook. Types-only gives full compile-time safety without touching the transport model.

### 2. Zero-dep typed wrapper, not `openapi-fetch` — **decided (revisit if it gets fiddly)**
A ~40-line `createApi` factory types `path` / method / body / response against the generated `paths`. No new runtime dependency. `openapi-fetch` (2 kB, typed via middleware) is a clean fallback if hand-rolling the path-param typing gets annoying.

### 3. Generation is deterministic and staleness is CI-enforced — **decided**
`app.openapi()` runs with no server/DB. The generate script dumps the spec and runs `openapi-typescript`; the output `.d.ts` is committed. A CI job regenerates and fails if the committed file is stale — so "changed a Pydantic model, forgot to regen" is a red build, not silent drift. This CI gate is what makes the whole thing trustworthy.

---

## The honest part (where the effort actually is)

The tooling is one command. The value is gated on the ~27% of routes without `response_model=`, which generate as `unknown`. So the real work is **~80% annotating the untyped routes + deleting the two mirror trees, ~20% wiring codegen.** Anyone who says the codegen is the work is wrong.

---

## Package shape

```
packages/api-contract/
  package.json            # @myetal/api-contract, ships TS source, "generate" script
  tsconfig.json
  scripts/generate.mjs    # dump spec via api/.venv python → openapi-typescript → generated/schema.d.ts
  src/
    generated/schema.d.ts # GENERATED, committed. do not hand-edit.
    schemas.ts            # convenience aliases: ShareResponse = components['schemas']['ShareResponse']
    transport.ts          # ApiError, RequestOptions, createApi() typed vs `paths`
    index.ts
```

Consumed as TS source — `tsc` and Next `transpilePackages` handle that directly. Mobile/Metro runtime bundling of a workspace TS package is a separate packaging concern (see risks).

---

## Phased plan

1. **Scaffold + codegen + CI gate.** Package, generate script, commit `schema.d.ts`, add the stale-check to CI.
2. **Prove one vertical slice (`share`).** Wire web + mobile to depend on the package; collapse `web/src/types/share.ts` and `mobile/types/share.ts` from ~250 lines of hand-written definitions into thin re-export shims over the generated types (kills the drift source, leaves all 42 consumers untouched); `tsc --noEmit` green on both. ← *proof that the generated types are structurally real.*
3. **Roll out the rest.** paper → user → admin → reports, each a compile-checked step; delete each mirror as it's proven; eventually delete the shims and import from the package directly.
4. **Annotate untyped routes** as hit; fold `ApiError`/`RequestOptions` into the package; verify Metro bundling with a real `eas build`.

Blast radius: purely client/contract plumbing. **None of it touches Nicholas's research/domain logic.** Flag to Nicholas: the `packages/` addition and the new "types are generated — don't hand-edit `types/`" convention.

---

## Risks

- **OpenAPI fidelity = Pydantic honesty.** Untyped routes generate as `unknown`. Mitigation: annotate them; the CI gate makes gaps visible.
- **Metro workspace resolution.** Expo/Metro needs config to bundle a symlinked workspace TS package at runtime. Typecheck (tsc) proves the types regardless; runtime bundling verified separately with `eas build`.
- **Name remap.** Hand-written types were renamed off the Pydantic names (`Tag`↔`TagOut`, `ShareCreateInput`↔`ShareCreate`). The shim layer aliases these so consumers don't churn; a genuine structural mismatch surfaces as a typecheck error, which is the drift becoming visible — a feature, not a bug.

---

## Proof slice results (2026-07-05)

Built on branch `feat/api-contract-codegen`. Package `@myetal/api-contract` scaffolded, codegen wired (`pnpm --filter @myetal/api-contract generate`), **85 component schemas** generated from the live spec, CI staleness gate (`generate.mjs --check`) verified working. Both `share.ts` mirror trees collapsed to ~50-line re-export shims over the generated types. **web + mobile both typecheck green.** Net −507 lines of hand-maintained app code (460 of it removed hand-written type definitions).

### Decision confirmed: `--default-non-nullable false`
Request models carry server-side defaults (`ShareCreate.is_public`/`type`, `ShareItemCreate.kind`). With openapi-typescript's default (`true`) those become **required** in the generated type — wrong for a request body the client may omit. Setting the flag to `false` optionalises **any** field that carries a `default` — request OR response.

⚠️ **This flag is global and it DOES touch response models** — do not carry away "responses are unaffected." That was true only in the *share* domain (whose response schemas happen to carry no defaults). Phase-2 rollout is the counterexample: `PaperSearchResult`, `OpenAccessInfo`, `ReportSubmitResponse`, `OrcidSyncResponse`, and `UserResponse.handle` all got optionalised, which is what forced the 17 read-guards. The trade is acceptable because optionalising a *read* only ever *tightens* safety (forces a guard on an always-present-but-nullable field), never loosens it. The genuinely clean fix — per-direction typing so responses stay required — needs a backend request/response model split (no `= None` on response models); logged as separate debt, not worth blocking on. Baked into `generate.mjs`.

### What the true types surfaced (8 mismatches, all resolved)
The moment the true contract replaced the hand-written types, the compiler flagged 8 issues. Being precise about severity (Luke pushed back on the first framing):
- **1 substantive:** `share-editor.tsx` build-create payloads were missing `is_public` and building items without `kind`. The fake `ShareCreateInput`/`ShareItemInput` made required fields optional and carried PDF fields the real `ShareItemCreate` doesn't accept. Resolved correctly by the `default-non-nullable` codegen setting (the client legitimately omits server-defaulted fields), *not* by sending a wrong payload.
- **7 type-lies (compile errors, not live crashes):** `related_shares` / `similar_shares` read as `x?.length > 0` in *both* the web viewer (`app/c/[code]/page.tsx`) and the mobile viewer (`app/c/[code].tsx`) — 4 sites. The optional-chaining meant no runtime crash existed (`undefined > 0` → `false` → renders nothing); but the honest types (these fields are optional) turned `number | undefined > 0` into a compile error. Rewritten as `x && x.length > 0`, which also narrows the array for the `.map`. Value here is that the type now *tells the truth* about what the API can omit.

The mobile viewer issue being an exact mirror of the web one is still the thesis in miniature: two hand-copies drift into the *same* wrong assumption independently.

## Rollout — phase 2 (2026-07-05, branch `feat/api-contract-rollout`)

Extended the pattern to **paper, works, reports, user/auth**. Both frontends green.

- **Mobile is now fully migrated** — no hand-written type mirrors remain (`share`, `paper`, `auth`, `works` all shims).
- **Web** has only `admin.ts` left (deferred to its own PR — 40+ types, and its filter/sort enums are query-param types with no standalone component schema, so it needs a different aliasing approach).
- Legacy remaps: `Paper`→`PaperMetadata`, mobile `AuthUser`→`UserResponse`. The four enums (`PaperSource`, `UserPaperAddedVia`, `ShareReportReason`, `ShareReportStatus`) are standalone components — aliased directly.

### The `default-non-nullable false` tension is now confirmed on BOTH sides
The share slice showed the flag fixing over-strict *request* types. This phase shows its cost: paper/works **response** fields carry `= None` defaults, so with `false` they generate as `T | undefined` — over-strict for reads of fields that are always serialized (present-but-nullable). This surfaced 17 drift sites (11 web + 6 mobile), all in the add-item search UIs + profile/header: unguarded reads of `cited_by_count`, `keywords`, `open_access`, `handle`, paper fields.

**Resolution: read-guards, not a flag flip.** `?? 0` on count arithmetic, `x != null && x > 0` narrowing, `?? null` when passing to `string|null` params. Flipping to `true` would re-break the already-merged share editor (it deliberately omits `kind` on PDF-merge, which `true` marks required) and every request builder — a bigger blast radius than defensive guards that are, in fairness, better code. The genuinely clean fix (per-direction typing: `true` for responses, `false` for requests) isn't natively supported by openapi-typescript for shared component schemas; logged as a possible future refinement, not worth it now.

### Remaining (follow-up)
1. **admin domain** — its own PR (query-param enums need extracting from `operations`, or kept as local literal types; the response objects alias cleanly).
2. Delete the shims entirely and import from `@myetal/api-contract` at call sites.
3. Fold `ApiError` / `RequestOptions` out of `apps/*/lib/api.ts` onto `transport.ts`. Also fold the still-hand-written `PresignResponse` in `apps/mobile/lib/pdf-upload.ts:40` onto the generated `PdfUploadUrlResponse` during the mobile PDF rollout (its `fields` is required there but optional in the contract — latent drift).
4. Add the `generate.mjs --check` gate to CI.
5. **Verify Metro runtime bundling** of the workspace TS package with a real `eas build` — typecheck passes, but Metro's symlink/transpile handling is a separate concern from tsc.
6. Flag to Nicholas: the `packages/` addition + "types are generated, don't hand-edit `types/`" convention.

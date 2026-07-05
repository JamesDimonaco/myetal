/**
 * Calling-user shape — re-exported from `@myetal/api-contract` (generated from
 * the FastAPI OpenAPI spec; source of truth `schemas/user.py::UserResponse`).
 * This shim maps the legacy local name `AuthUser` onto `UserResponse`.
 *
 * Do not hand-edit. Change the Pydantic schema, then
 *   pnpm --filter @myetal/api-contract generate
 * See docs/tickets/to-do/api-contract-codegen.md.
 */
import type { UserResponse } from '@myetal/api-contract';

/** Legacy local name for the backend `UserResponse` shape. */
export type AuthUser = UserResponse;

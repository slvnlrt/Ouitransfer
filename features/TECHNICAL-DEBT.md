# Technical Debt — Items to Fix in Future Sessions

Items discovered during feature work that are out of scope for the current session
but must be addressed. Each item includes context and the fix needed.

---

## TD-1 — API endpoint return types are type-unsafe (I-7 from 7.1 review)

**Pattern:** All API client functions in `apps/web/src/http/endpoints/` use a generic
`<TData = AxiosResponse<X>>` pattern that casts `axios.get()` return through `unknown`.
If a caller overrides `TData`, the cast is a lie — TypeScript won't catch mismatches.

**Example:** `apps/web/src/http/endpoints/admin/index.ts:9-13`

```ts
export const getAdminStats = <TData = AdminStatsResult>(
  options?: AxiosRequestConfig,
): Promise<TData> => {
  return apiInstance.get("/api/admin/stats", options);
};
```

**Fix:** Remove the generic `TData` parameter. Return `Promise<AxiosResponse<AdminStats200>>`
directly. Apply to all endpoint files. This is a mechanical refactor across ~15 files.

**Found during:** 7.1 review (finding I-7)
**Severity:** Low — no runtime bug today, but a type-safety footgun

---

## TD-2 — Account lockout throws ForbiddenError without specific error code

**Context:** `apps/server/src/modules/auth/service.ts:41-44` throws:
```ts
throw new ForbiddenError(
  `Account temporarily locked. Try again in ${lockStatus.remainingMinutes} minutes.`,
);
```

This uses the generic `FORBIDDEN` code. The frontend cannot distinguish "account locked"
from "access denied" without matching on the English message string.

**Fix:**
1. Add `ACCOUNT_LOCKED` to `packages/shared/src/error-codes.ts`
2. Replace with `throw new AppError(403, "Account temporarily locked...", ErrorCodes.ACCOUNT_LOCKED, { remainingMinutes: lockStatus.remainingMinutes })`
3. Frontend login hook can then match on `ErrorCodes.ACCOUNT_LOCKED` and show the remaining time from `details`

**Severity:** Medium — affects login UX and i18n correctness

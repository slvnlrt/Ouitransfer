# Bug Report

> Bugs discovered during testing and development.
> **Voir aussi :** [`TECHNICAL-DEBT.md`](TECHNICAL-DEBT.md) — dettes techniques · [`SECURITY.md`](SECURITY.md) — findings sécurité
>
> All resolved bugs are archived:
> - B-1 through B-20: `features/archive/BUGS-2026-05.md`
> - B-21 through B-25: `features/archive/BUGS-2026-05-31.md`

## Open

### B-26: TOCTOU race condition on invite token single-use enforcement

- **Severity**: Medium
- **File**: `apps/server/src/modules/invite/service.ts:59-115`
- **Description**: `validateInviteToken` checks `usedAt` is null, then the `$transaction` does an unconditional `inviteToken.update({ data: { usedAt } })`. Two concurrent requests with the same valid token can both pass validation and both create users before either sets `usedAt` — the single-use guarantee is not enforced atomically.
- **Fix**: Make token consumption atomic: use `updateMany({ where: { token, usedAt: null }, data: { usedAt: new Date() } })` and throw `INVITE_TOKEN_USED` if `count === 0`. Only proceed with user creation after the token is successfully claimed.
- **Priority**: Low (requires intentional concurrent exploitation; invite tokens are short-lived and typically used once interactively)

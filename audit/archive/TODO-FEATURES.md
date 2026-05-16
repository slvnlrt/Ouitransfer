# Features Roadmap

Upcoming features identified during the wire-up audit. Each requires brainstorming before implementation.

**Implementation order** (dependencies drive sequencing):
1. **5.1 Quotas** — foundation for everything (groups need quotas, reverse shares need quotas)
2. **5.4 Groups** — depends on quota model being in place
3. **5.2 Auto-cleanup** — depends on notification system (emails), independent of groups
4. **5.3 LDAP/AD sync** — depends on groups being in place (to map AD groups → app groups)

---

## 5.1 — Per-User Storage Quotas & Groups

**Goal**: Prevent employees from uploading unlimited data without cleanup.

**Quota hierarchy** (resolved from top to bottom):
1. Per-user override (admin sets explicitly on a user) — highest priority
2. Group quota (user belongs to a group with a quota) — if no per-user override
3. Global default quota (admin-configurable, e.g. 10 GB) — fallback

**Design requirements**:
- Global default quota per user (admin-configurable setting)
- Groups with configurable quotas (see 5.4 — Groups below)
- Per-user admin override (nullable, takes precedence over group and default)
- Quota applies to all user content: personal files + shares + reverse share received files
- Reverse share creation: user chooses max total size for the reverse share, capped at their remaining quota
- Upload rejection when quota exceeded (both direct uploads and reverse share uploads count toward the creator's quota)
- User-facing quota indicator ("X of Y used") in dashboard and/or upload modal
- Admin-facing per-user consumption view in user management

**Server changes needed**:
- New `User.storageQuotaOverride` field (nullable bigint)
- Quota resolution logic: `user.storageQuotaOverride ?? user.group?.storageQuota ?? globalDefault`
- New endpoint or extend existing: calculate per-user total storage consumption
- Enforce quota on presigned URL generation (reject before upload, not after)
- Reverse share creation: validate requested `maxTotalSize` against creator's remaining quota

**Frontend changes needed**:
- Dashboard: user storage quota widget ("X of Y GB used")
- Upload flow: quota check before upload
- Reverse share create/edit: max size field capped by remaining quota
- Admin user management: view per-user consumption, set quota overrides

**Open questions** (for brainstorming):
- What counts toward quota? Files only, or also S3 overhead (multipart fragments, etc.)?
- Should there be a "soft limit" warning (e.g. 80% used notification)?
- When quota is exceeded: block new uploads only, or also block creating new shares?

---

## 5.2 — Automatic Cleanup of Expired Content

**Goal**: Expired shares and reverse shares accumulate in DB and S3 forever. Need automated cleanup.

**Decisions**:
- **Grace period**: Configurable (admin sets days, e.g. 7 days after expiration before deletion)
- **Notification**: Email the owner before cleanup (e.g. "your share X expires in 3 days and will be deleted")
- Relies on the existing email system (SMTP already used for share notifications, password reset, invites)

**Design requirements**:
- Server-side scheduled task (cron-like) that runs periodically
- Deletes shares past their `expiration` date + grace period (and their S3 objects)
- Deletes reverse shares past their `expiration` date + grace period (and their S3 objects)
- Configurable grace period in days (admin setting)
- Email notification to owner N days before cleanup (configurable N)
- Admin-configurable via settings page
- Audit log entries for automated deletions

**Server changes needed**:
- Scheduled task mechanism (Fastify plugin, `node-cron`, or `setInterval`-based)
- Cleanup service: query expired items past grace period, cascade-delete S3 objects + DB records
- Notification service: query items approaching cleanup, send warning emails
- New config keys: `autoCleanupEnabled`, `autoCleanupGracePeriodDays`, `autoCleanupIntervalHours`,
  `autoCleanupNotifyDaysBefore`

**Frontend changes needed**:
- Admin settings: auto-cleanup toggle, grace period, notification timing configuration
- Optional: admin dashboard card showing "X items pending cleanup"

**Open questions** (for brainstorming):
- Should cleanup also handle shares that exceed max views (already blocked but still in storage)?
- Run as in-process Fastify task, or separate worker process for production reliability?

---

## 5.3 — LDAP / Active Directory Synchronization

**Goal**: Sync user accounts from corporate Active Directory.

**Decisions**:
- **Target**: Active Directory only (no OpenLDAP/FreeIPA for V1)
- **Groups**: Fetch AD groups from the start. V1 stores them but doesn't enforce quotas via groups yet — that comes when Groups (5.4) is implemented. Groups will eventually map to Ouitransfer groups with per-group quotas.
- **Auth approach**: To be decided in brainstorming (Option A vs B — see below)

**Two possible auth approaches** (brainstorming needed):

### Option A: LDAP as Auth Backend
- Users authenticate directly against AD (LDAP bind with their domain credentials)
- No local password stored — auth always goes through AD
- Pro: single source of truth, password policies enforced by AD, no separate password to manage
- Con: requires AD connectivity at every login, no offline/fallback auth

### Option B: LDAP as User Import Source
- AD syncs user accounts (create/update/deactivate) on a schedule
- Authentication uses app-specific passwords (set via invite email + password reset flow)
- Pro: works if AD is down, simpler auth flow, existing invite/reset email system is reused
- Con: two sets of credentials, users must manage a separate password

**Design requirements (common to both)**:
- Admin AD configuration page (server URL, bind DN/password, search base, LDAP filter, attribute mapping)
- Scheduled sync (configurable interval, e.g. every 6 hours)
- Manual sync trigger button in admin UI
- User create/update/deactivate based on AD state (disabled AD accounts → deactivated app accounts)
- Group sync: fetch AD group memberships and store them (for future group-based quotas)
- Sync log / history visible to admin
- LDAP-synced users visually distinguished in admin UI (badge/icon)

**Open questions** (for brainstorming):
- Auth approach: Option A (AD bind) vs Option B (import + app passwords)?
- If Option A: fallback auth when AD is unreachable?
- If Option B: auto-send invite email on first sync to let users set their app password?
- Conflict resolution: if a user exists locally and in AD with different email, which wins?
- Nested group support? (AD commonly uses nested groups via `memberOf:1.2.840.113556.1.4.1941:=`)
- TLS/STARTTLS requirements for AD connection?

---

## 5.4 — Groups

**Goal**: Organizational groups with per-group quotas and settings. Foundation for LDAP group mapping.

**Depends on**: 5.1 (Quotas), partially on 5.3 (LDAP — provides group data to map from)

**Design requirements**:
- `Group` model with: name, description, storageQuota (bigint), optional AD group DN (for LDAP mapping)
- Users belong to 0 or 1 group (or many-to-many if needed — brainstorm)
- Group quota overrides global default, per-user override overrides group
- Admin CRUD for groups
- Admin page: group list with member count, storage consumption per group
- LDAP sync maps AD groups → Ouitransfer groups (by DN or name)
- Manual group assignment for non-LDAP users

**Open questions** (for brainstorming):
- One group per user, or multiple groups? (simpler = one; AD users often belong to many groups)
- If multiple groups: which quota applies? Highest? Lowest? Sum?
- Should groups have permissions beyond quotas? (e.g. max file size, allowed file types)

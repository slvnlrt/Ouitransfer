Controller Migration Complexity Analysis
Summary Table
Module	Complexity	Deps Injected	Mutable State	Shared Private Methods	Fastify API Beyond body/params/query + send
auth	HIGH	0 (field init)	No	1 (getClientInfo)	reply.jwtSign, reply.setCookie, reply.clearCookie, request.jwtVerify, request.cookies, request.ip, request.socket, request.headers
auth-providers	HIGH	0 (ctor)	No	6 private methods	reply.jwtSign, reply.setCookie, reply.redirect, request.protocol, request.headers
user	MEDIUM	0 (field init)	No	0 (but has module-level serializeUser)	reply.jwtSign, reply.setCookie, reply.status(201), request.file(), request.ip, request.headers
file	MEDIUM	0 (field init)	No	1 (getAllUserFilesRecursively)	reply.status(201), request.log
file/download	MEDIUM	0 (field init)	No	0	request.jwtVerify, reply.header, request.log
file/embed	LOW	0 (field init)	No	0	reply.header
file/multipart	LOW	0 (field init)	No	0	reply.status(200)
share	LOW	0 (field init)	No	0	reply.status(201), request.jwtVerify
reverse-share	LOW	0 (field init)	No	0	reply.status(201)
reverse-share/multipart	TRIVIAL	0 (field init)	No	0	reply.status(200)
folder	MEDIUM	0 (field init)	No	1 (isDescendantOf)	reply.status(201)
two-factor	LOW	0 (field init)	No	0	None beyond basics
health	TRIVIAL	0	No	0	None (returns plain object, no reply used)
health/status	TRIVIAL	0	No	0	reply.status(200)
app	LOW	0 (field init)	No	0	request.file()
quota	TRIVIAL	0	No	0	None beyond basics
group	TRIVIAL	0	No	0 (module-level serializeGroup/serializeMember)	reply.status(201)
ldap	LOW	0 (field init)	No	0	None beyond basics
s3-storage	LOW	0 (field init)	No	0	reply.status(200)
storage	TRIVIAL	0	No	0	request.user.userId (direct access)
invite	TRIVIAL	0 (field init)	No	0	None beyond basics
audit	TRIVIAL	0	No	0	None beyond basics
admin/stats	TRIVIAL	0 (module-level service)	No	0	reply.status(200)
Detailed Findings Per Module
1. auth/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\auth\controller.ts
Constructor/Dependencies: No constructor. Services initialized as field initializers:
- private authService = new AuthService()
Mutable State: None.
Shared Private Methods:
- private getClientInfo(request) -- extracts IP + UserAgent from headers. Called by login, completeTwoFactorLogin, logout, resetPassword.
Handler Methods (10):
Method	Behavior
login	Complex: parses body, calls getClientInfo, calls service, branches on requiresTwoFactor, creates challenge token, signs JWT via reply.jwtSign, sets 2 cookies via reply.setCookie, fires audit events
completeTwoFactorLogin	Complex: verifies challenge token, calls service, signs JWT, sets 2 cookies, fires audit. Duplicates cookie-setting logic from login.
logout	Medium: attempts request.jwtVerify() (may fail), clears 2 cookies, revokes refresh tokens, fires audit
requestPasswordReset	Pure delegation to service
resetPassword	Mostly delegation + getClientInfo + audit fire-and-forget
getCurrentUser	Attempts request.jwtVerify() (may fail), calls service, returns null if not authed
getTrustedDevices	Checks request.user?.userId, delegates to service
removeTrustedDevice	Checks userId, extracts params, delegates
removeAllTrustedDevices	Checks userId, delegates
getAuthConfig	Pure delegation to getConfigValue (no service)
Direct Fastify Access: reply.jwtSign(), reply.setCookie(), reply.clearCookie(), request.jwtVerify(), request.ip, request.socket.remoteAddress, request.headers, request.user, request.cookies
2. auth/routes.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\auth\routes.ts
Instantiation: const authController = new AuthController()
Hooks:
- Inline preValidation on 3 routes (/auth/trusted-devices GET, DELETE /:id, DELETE all) -- all identical JWT verify pattern
- preValidation: validatePasswordMiddleware on /auth/reset-password (imported from user module)
- config.csrfExempt and config.rateLimit on several routes
Inline handlers: YES -- /auth/refresh is a fully inline handler (lines 385-428) that does reply.jwtSign, reply.setCookie x2, reads request.cookies. This route does NOT use the controller at all.
3. user/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\user\controller.ts
Constructor/Dependencies: Field initializers:
- private userService = new UserService()
- private avatarService = new AvatarService()
Mutable State: None.
Shared Private Methods: None in the class. Module-level serializeUser() helper function is used by all handlers.
Handler Methods (10):
Method	Behavior
register	Complex: parses body with dynamic schema, calls service, auto-login for first user (JWT sign + 2 cookies), audit
listUsers	Delegates, maps through serializeUser
getUserById	Delegates, serializeUser
updateUser	Parses body, delegates, conditional audit for password change
activateUser	Extract params, delegate, serialize
deactivateUser	Extract params, delegate, serialize
deleteUser	Extract params, delegate, audit, serialize
updateUserImage	Parses body with UpdateUserSchema (note: same schema as updateUser), delegates
uploadAvatar	Complex: checks request.user, calls request.file(), streams + buffers chunks manually, validates MIME + size, calls avatarService then userService
removeAvatar	Checks userId, delegates to avatarService + userService
Direct Fastify Access: reply.jwtSign(), reply.setCookie(), reply.status(201), request.file(), request.ip, request.headers, request.user
4. user/routes.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\user\routes.ts
Instantiation: const userController = new UserController()
Hooks:
- Shared preValidation function (lines 15-32): checks user count, if >0 requires JWT + admin. Used on most routes.
- Separate inline preValidation on /users/avatar POST and DELETE -- just JWT verify (no admin check).
- preValidation: [preValidation, validatePasswordMiddleware] on register route.
Inline handlers: None.
5. file/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\file\controller.ts
Constructor/Dependencies: private fileService = new FileService()
Mutable State: None.
Shared Private Methods:
- private async getAllUserFilesRecursively(userId) -- called only by listFiles. Single caller, so not truly "shared".
Handler Methods (7):
Method	Behavior
getPresignedUrl	Extract query params, validate, generate unique objectName, call service, call quotaService
registerFile	Complex: validates ownership, MIME consistency, magic bytes (with S3 error handling), quota checks, duplicate filename handling, creates DB record, serializes BigInt
checkFile	Quota checks, duplicate filename check
listFiles	Parses query, branches on recursive/non-recursive, lazy-imports FolderService, maps BigInt
deleteFile	Ownership check, deletes from S3 + DB
updateFile	Ownership check, rename dedup, updates DB
moveFile	Ownership check, validates target folder, updates DB
Direct Fastify Access: request.log.warn/debug, reply.status(201/200), request.user
Notable: Significant inline business logic -- quota checks, MIME validation, magic byte verification. These are NOT pure delegation.
6. file/download.controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\file\download.controller.ts
Dependencies: private fileService = new FileService()
Handler Methods (2):
Method	Behavior
getDownloadUrl	Complex: finds file, checks share access (iterates shares, bcrypt password comparison), falls back to JWT auth, generates presigned URL
downloadFile	Complex: similar access check logic (duplicated from getDownloadUrl), also handles reverse-share files, streams response with headers
Direct Fastify Access: request.jwtVerify(), reply.header(), reply.send(stream), request.log
Notable: Significant duplicated access-check logic between getDownloadUrl and downloadFile.
7. file/embed.controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\file\embed.controller.ts
Dependencies: private fileService = new FileService()
Handler Methods (2): embedFile (token verification + streaming), generateEmbedToken (ownership check + token creation). Both have inline business logic.
Direct Fastify Access: reply.header() (Content-Type, Disposition, Length, Cache-Control)
8. file/multipart.controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\file\multipart.controller.ts
Dependencies: private fileService = new FileService()
Handler Methods (5): createMultipartUpload, getMultipartPartUrl, completeMultipartUpload, abortMultipartUpload, listParts. All parse input, validate, delegate to fileService.
Direct Fastify Access: reply.status(200) only.
9. share/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\share\controller.ts
Dependencies: private shareService = new ShareService()
Handler Methods (13): createShare, listUserShares, getShare, updateShare, updatePassword, addItems, removeItems, deleteShare, addRecipients, removeRecipients, createOrUpdateAlias, getShareByAlias, notifyRecipients, getShareMetadataByAlias.
Most are pure delegation. getShare does an optional request.jwtVerify() (may fail, used to pass userId context). deleteShare has an ownership check.
Direct Fastify Access: request.jwtVerify() (in getShare), reply.status(201).
10. reverse-share/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\reverse-share\controller.ts
Dependencies:
- private reverseShareService = new ReverseShareService()
- private uploadService = new ReverseShareUploadService()
Handler Methods (17): All are pure delegation with userId extraction and body parsing. No complex branching.
Direct Fastify Access: reply.status(201) only.
11. reverse-share/multipart.controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\reverse-share\multipart.controller.ts
Dependencies: private multipartService = new ReverseShareMultipartService()
Handler Methods (5): Pure delegation.
Direct Fastify Access: reply.status(200) only.
12. folder/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\folder\controller.ts
Dependencies: private folderService = new FolderService()
Shared Private Methods:
- private async isDescendantOf(potentialDescendantId, ancestorId, userId) -- called only by moveFolder. Walks parent chain to prevent circular moves.
Handler Methods (6): registerFolder, checkFolder, listFolders, updateFolder, moveFolder, deleteFolder. Several have inline DB queries (prisma direct access) for ownership checks, rename dedup logic.
Direct Fastify Access: reply.status(201)
13. two-factor/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\two-factor\controller.ts
Dependencies: private twoFactorService = new TwoFactorService()
Handler Methods (6): generateSetup, verifySetup, verifyToken, disable2FA, generateBackupCodes, getStatus. All parse body with inline Zod schemas (defined at module level), then delegate. Two methods fire audit events.
Direct Fastify Access: None beyond standard request.user, request.ip, request.headers.
14. health/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\health\controller.ts
Dependencies: None (imports directly from config modules).
Handler Methods (1): check() -- does not even take request/reply parameters! Returns a plain object. The route wraps it in an inline handler.
Direct Fastify Access: None.
15. health/status.controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\health\status.controller.ts
Dependencies: None (imports directly).
Handler Methods (1): getStatus. Direct DB/S3 checks.
Direct Fastify Access: reply.status(200)
16. app/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\app\controller.ts
Dependencies:
- private appService = new AppService()
- private logoService = new LogoService()
- private emailService = new EmailService()
Handler Methods (8): getAppInfo, getSystemInfo, getAllConfigs, getPublicConfigs, updateConfig, bulkUpdateConfigs, testSmtpConnection, uploadLogo, removeLogo. Most delegate. uploadLogo has file streaming logic (same pattern as avatar upload). updateConfig/bulkUpdateConfigs fire audit events.
Direct Fastify Access: request.file() in uploadLogo.
17. quota/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\quota\controller.ts
Dependencies: None (uses quotaService singleton import, prisma direct).
Handler Methods (2): getUserQuota, updateUserQuota. Pure delegation with BigInt serialization.
Direct Fastify Access: None beyond basics.
18. group/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\group\controller.ts
Dependencies: private groupService = new GroupService()
Handler Methods (7): All pure delegation with serializeGroup/serializeMember helpers (module-level functions).
Direct Fastify Access: reply.status(201) only.
19. ldap/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\ldap\controller.ts
Dependencies:
- private configRepository = new LdapConfigRepository()
- private syncLogRepository = new LdapSyncLogRepository()
- private syncService = new LdapSyncService()
Handler Methods (6): getConfig, updateConfig, testConnection, triggerSync, getSyncLogs, getSyncLogDetail, getStatus. updateConfig has non-trivial logic: password masking, encryption handling, scheduler restart.
Direct Fastify Access: None beyond basics.
20. s3-storage/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\s3-storage\controller.ts
Dependencies: private storageProvider = new S3StorageProvider()
Handler Methods (4): getUploadUrl, getDownloadUrl, upload (stub), deleteObject, checkExists. Each has path traversal validation + ownership checks.
Direct Fastify Access: reply.status(200).
21. storage/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\storage\controller.ts
Dependencies: private storageService = new StorageService()
Handler Methods (2): getDiskSpace, checkUploadAllowed. Pure delegation.
Direct Fastify Access: request.user.userId and request.user.isAdmin (direct property access, no jwtVerify).
22. invite/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\invite\controller.ts
Dependencies: private inviteService = new InviteService()
Handler Methods (3): generateInviteToken, validateInviteToken, registerWithInvite. Pure delegation.
Direct Fastify Access: request.user.userId in generateInviteToken.
23. audit/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\audit\controller.ts
Dependencies: None (imports getAuditLogs function directly).
Handler Methods (1): listAuditLogs. Pure delegation.
Direct Fastify Access: None.
24. auth-providers/controller.ts
File: D:\Code\Ouitransfer\apps\server\src\modules\auth-providers\controller.ts
Dependencies: private authProvidersService: AuthProvidersService (created in explicit constructor).
Shared Private Methods (6):
- buildRequestContext(request) -- extracts protocol/host from headers
- buildBaseUrl(requestContext) -- constructs base URL string
- sendSuccessResponse(reply, data?, message?) -- wraps response in { success: true, data, message }
- validateCustomEndpoints(data) -- validates OIDC endpoint config
- validateIssuerUrl(issuerUrl) -- URL format validation
- setAuthCookie(reply, token, isSecure) -- sets JWT cookie
- determineCallbackError(error, provider) -- maps error messages to error types
- updateOfficialProvider(reply, id, data) -- update flow for built-in providers
- updateCustomProvider(reply, id, data) -- update flow for custom providers
- handleCallbackError(request, reply, error) -- callback error redirect logic
Handler Methods (8): getProviders, getAllProviders, createProvider, updateProvider, updateProvidersOrder, deleteProvider, authorize, callback.
callback is the most complex handler: signs JWT, sets auth cookie, creates refresh token, sets refresh cookie, does redirect. Has try/catch that redirects to login page with error params.
Direct Fastify Access: reply.jwtSign(), reply.setCookie(), reply.redirect(), request.protocol, request.headers, request.ip, request.socket
Route Files: Hook Patterns
Shared preValidation (defined in route file, reused across routes):
- auth/routes.ts: 3 routes share identical inline JWT verify
- user/routes.ts: shared preValidation (JWT + admin check with first-user bypass); separate avatar-specific JWT-only hooks
- file/routes.ts: shared preValidation (JWT verify)
- share/routes.ts: shared preValidation (JWT verify)
- reverse-share/routes.ts: shared preValidation (JWT verify)
- folder/routes.ts: shared preValidation (JWT verify)
- two-factor/routes.ts: shared preValidation (JWT verify)
- s3-storage/routes.ts: shared preValidation (JWT verify)
- storage/routes.ts: shared preValidation (JWT verify)
- quota/routes.ts: shared preValidation (JWT + admin)
Imported middleware:
- createAdminPreValidation (from middleware/admin-prevalidation.ts): used in app, group, ldap, invite, audit, admin routes
- validatePasswordMiddleware (from user/middleware.ts): used in auth/routes.ts (reset-password) and user/routes.ts (register)
Per-route hooks (unique to one route):
- config.csrfExempt: true -- on login, 2FA login, forgot-password, reset-password, refresh, several reverse-share public routes, share access routes, invite register
- config.rateLimit -- on login (5/min), 2FA login (5/min), forgot-password (3/min), reset-password (3/min), refresh (10/min), presigned-url (30/min), download-url (20/min), download (20/min), s3 upload-url (30/min), 2FA verify (5/min)
- bodyLimit -- auth routes (64KB), app config routes (64KB)
Routes WITHOUT Controllers (Inline Handlers)
1. auth/routes.ts -- /auth/refresh (lines 366-428): Fully inline handler. Reads refresh token from cookie, rotates it, signs new JWT, sets 2 cookies. This is a complete auth flow handler with NO controller involvement.
2. health/routes.ts -- /health (lines 21-39): Inline wrapper that calls healthController.check() and sets status code. The controller's check() method returns a plain object (does not take request/reply).
3. admin/routes.ts: Uses AdminStatsController from stats.controller.ts (not the standard controller.ts pattern).
Controller Instantiation Pattern
Every route file follows the same pattern:
const controller = new SomeController();
// ...
app.post("/path", options, controller.method.bind(controller));
No controllers receive constructor arguments. All use new Controller() with zero args. Services are created as field initializers (private service = new Service()) or in parameterless constructors.
Migration Difficulty Tiers
TRIVIAL (pure delegation, no Fastify APIs, zero shared methods -- mechanical conversion):
- audit/controller.ts (1 method)
- admin/stats.controller.ts (1 method)
- health/status.controller.ts (1 method)
- health/controller.ts (1 method, does not even use request/reply)
- quota/controller.ts (2 methods)
- storage/controller.ts (2 methods)
- invite/controller.ts (3 methods)
- reverse-share/multipart.controller.ts (5 methods)
LOW (mostly delegation with light request parsing, no complex Fastify API usage):
- group/controller.ts (7 methods, module-level serializers)
- two-factor/controller.ts (6 methods, module-level Zod schemas, audit fire-and-forget)
- share/controller.ts (13 methods, one optional jwtVerify)
- reverse-share/controller.ts (17 methods, pure delegation)
- ldap/controller.ts (6 methods, some config logic but no Fastify-specific APIs)
- s3-storage/controller.ts (4 methods, path validation logic but no complex Fastify APIs)
- app/controller.ts (8 methods, one uses request.file())
- file/multipart.controller.ts (5 methods)
MEDIUM (inline business logic, DB queries, or file streaming):
- file/controller.ts -- 1 private method, significant inline quota/validation logic, lazy imports
- file/download.controller.ts -- duplicated access-check logic, request.jwtVerify(), reply.header(), stream responses
- file/embed.controller.ts -- token verification, stream responses with headers
- folder/controller.ts -- 1 private method (isDescendantOf), inline DB queries
- user/controller.ts -- file upload streaming (request.file()), JWT sign + cookies for first user
HIGH (heavy Fastify API usage, shared private methods, cookie/JWT/redirect logic):
- auth/controller.ts -- 1 shared private method, reply.jwtSign(), reply.setCookie() x2, reply.clearCookie(), request.jwtVerify(), duplicated cookie-setting logic between login and completeTwoFactorLogin
- auth-providers/controller.ts -- 6+ shared private methods (helper utilities), reply.jwtSign(), reply.setCookie(), reply.redirect(), complex callback handler with try/catch redirect logic
Key Observations for Migration
1. No constructor injection anywhere. Every controller creates its own services as field initializers. No dependency injection container exists. This means migration to plain functions is straightforward -- services become module-level or function-scoped instances.
2. No mutable state. No controller holds state that changes between requests. Every service instance created via field initializer is effectively a stateless singleton.
3. Cookie/JWT logic is the main blocker. Only 3 controllers interact with reply.jwtSign/reply.setCookie: auth, auth-providers, and user (for first-user auto-login). This could be extracted into a shared utility function.
4. Duplicated patterns are rampant. The cookie-setting logic is copy-pasted across auth/controller.ts login, completeTwoFactorLogin, and the inline /auth/refresh handler, plus auth-providers/controller.ts callback, plus user/controller.ts register. This is a strong argument for extracting a setAuthCookies(reply, user) utility.
5. The inline /auth/refresh handler is already a plain function -- it proves the pattern works without a class.
6. preValidation hooks in route files are all identical (JWT verify + throw UnauthorizedError). These are already effectively plain functions.
7. Private methods that could become module-level functions:
- AuthController.getClientInfo -> getClientInfo(request)
- FolderController.isDescendantOf -> isDescendantOf(potentialDescendantId, ancestorId, userId)
- FileController.getAllUserFilesRecursively -> getAllUserFilesRecursively(userId)
- All 6 AuthProvidersController private helpers -> module-level functions
8. reply.header() usage is limited to download/embed/streaming scenarios. These just need the reply parameter passed through

# Cascade — Decision Log & Dev Workarounds

Tracks architectural decisions, temporary workarounds, and cleanup items. Every workaround must have a removal condition. Review this document before each release milestone.

---

## Architectural Decisions

### AD-001: Soft-delete for store pairings (Phase 2)
**Date:** 2026-04-02
**Decision:** `removePairing` sets `status: "disconnected"` instead of hard-deleting.
**Why:** Preserves ResourceMap history so re-pairing doesn't lose ID mappings from previous syncs. A merchant who disconnects and reconnects a store shouldn't have to re-sync everything from scratch.
**Trade-off:** Disconnected pairings accumulate in the database. Acceptable for expected scale (<100 pairings per merchant lifetime).

### AD-002: Content hash for timestamp-less resources (Phase 3)
**Date:** 2026-04-02
**Decision:** Metafield definitions, navigation menus, and URL redirects use SHA-256 content hashing for diff comparison instead of timestamps.
**Why:** These Shopify resource types don't expose an `updatedAt` field. Hashing relevant fields gives deterministic change detection.
**Trade-off:** Hash comparison is slightly slower than timestamp comparison, but these resource types are typically small in count (<100 per store).

### AD-003: Subscription tier detected by plan name, not ID (Phase 1)
**Date:** 2026-04-02
**Decision:** `determineTier()` uses case-insensitive substring matching on the subscription `name` field.
**Why:** Plan IDs don't exist yet — plans haven't been created in the Partner Dashboard. Name matching works for now.
**Cleanup:** When plans are created in Partner Dashboard, switch to ID-based matching. See WA-002.

### AD-004: `createAdminApiClient` for cross-store API calls (Phase 3)
**Date:** 2026-04-02
**Decision:** Use `@shopify/admin-api-client` directly (not the framework's `unauthenticated.admin`) to create GraphQL clients for paired stores.
**Why:** Simplest API — direct function call with explicit parameters. No dependency on framework internals. Works from any context (routes, background jobs).
**Trade-off:** Different interface than `authenticate.admin()` — resolved via `wrapAuthAdmin()` adapter that normalizes both to `StoreClient`.

### AD-005: PostgreSQL for all environments (Phase 3 → Production)
**Date:** 2026-04-09
**Decision:** Migrate from SQLite (dev) / PostgreSQL (prod) to PostgreSQL exclusively for all environments (dev, test, production).
**Why:** The DigitalOcean deployment requires PostgreSQL. Running SQLite locally masked real PostgreSQL behavior in tests (constraint differences, type coercions). A single database engine eliminates dev/prod parity issues.
**Trade-off:** Developers need a running PostgreSQL instance for local development and testing. Acceptable — DigitalOcean managed DB is already provisioned.

### AD-006: Multi-store install flow validated against the deployed app, not a local tunnel
**Date:** 2026-04-11
**Decision:** Multi-store dev testing uses the DigitalOcean App Platform deployment as its app URL. Both dev stores install against the deployed URL. `shopify app dev` remains the inner-loop workflow for single-store iteration only.
**Why:** `shopify app dev --tunnel-url` only rewrites the app URL for the store it is actively tunneling to — a second store installed against the same Partner app would hit a stale URL the moment the dev server restarts. ngrok (the originally documented workaround) is blocked on the Steadro network due to SSL/TLS interception and is not a viable fallback. A permanent deployed URL is the only topology where two stores can coexist on the same Partner app, and it mirrors the production install flow merchants will eventually use.
**Trade-off:** Validating multi-store flows requires a deploy step (push config, wait for container build) rather than a hot-reload cycle. Acceptable — multi-store install is a low-frequency validation, not an inner-loop activity. Single-store UI and logic work still uses `shopify app dev` unchanged.
**See also:** SPEC_TECHNICAL.md § "Multi-Store Development Testing" for the concrete install steps.

### AD-007: PRE_DEPLOY job for Prisma migrations (Phase 3.5)
**Date:** 2026-04-11
**Decision:** Run `prisma migrate deploy` as a DigitalOcean PRE_DEPLOY job instead of in the Dockerfile CMD.
**Why:** Running migrations in CMD creates race conditions if the app scales to multiple container instances. PRE_DEPLOY runs once before any containers start, and if it fails, the deployment is rolled back automatically.
**Trade-off:** Adds a job component to the app spec. Negligible cost — uses the smallest instance size and runs for seconds.

### AD-008: node:20-slim over node:20-alpine for Docker (Phase 3.5)
**Date:** 2026-04-11
**Decision:** Use `node:20-slim` (Debian-based) instead of `node:20-alpine` for the production Docker image.
**Why:** Prisma ORM has known binary target mismatches on Alpine Linux. The Prisma query engine expects `debian-openssl-3.0.x` targets. Alpine uses musl libc instead of glibc, which can cause silent runtime failures.
**Trade-off:** Slightly larger image (~50MB more). Acceptable — image size is not a bottleneck on App Platform.

---

## Dev Workarounds (Temporary — Must Be Removed)

### WA-001: DEFAULT_TIER set to "business" (no billing configured yet)
**Date:** 2026-04-02
**Phase:** Added during Phase 3 testing
**What:** The `DEFAULT_TIER` constant in `subscription.server.ts` is set to `"business"` instead of `"free"`. When no active Shopify subscription is found, every store gets business-tier access (3 paired stores, full sync).
**Why:** Managed Pricing plans aren't created in the Partner Dashboard yet. The Shopify subscription query always returns empty, so without this every store is locked to free tier (0 pairings), making the app untestable and unusable.
**Where:** `app/utils/subscription.server.ts` — `DEFAULT_TIER` constant near the top of the file.
**Risk:** All merchants get free access to business-tier features until this is changed. Acceptable during development since the app is not yet on the App Store.
**Removal condition:** Change `DEFAULT_TIER` back to `"free"` when Managed Pricing plans are created and billing is live.
**Removal checklist:**
- [ ] Create Pro, Business, Enterprise plans in Partner Dashboard
- [ ] Activate a test subscription on a dev store
- [ ] Change `DEFAULT_TIER` from `"business"` to `"free"` in `subscription.server.ts`
- [ ] Update tests that expect "business" as the default (marked with WA-001 comments)
- [ ] Verify free-tier stores see upgrade prompts and pairing is blocked
- [ ] Switch to plan ID-based tier detection (AD-003 / WA-002)

### WA-002: Plan tier by name instead of ID
**Date:** 2026-04-02
**Phase:** Phase 1
**What:** `determineTier()` matches subscription names with `includes("pro")`, `includes("business")`, etc.
**Why:** Plan IDs don't exist yet.
**Risk:** Plan rename silently breaks tier detection. A plan named "pro business" matches the wrong tier.
**Removal condition:** Same as WA-001 — when plans are created in Partner Dashboard, switch to ID-based matching using the `id` field from `activeSubscriptions`.

---

## Phase Completion Status

| Phase | Status | Tests | Commit |
|-------|--------|-------|--------|
| 1: Foundation | Complete | 32 | `d03427c` |
| 2: Store Pairing | Complete | 80 (cumulative) | `d03427c` |
| 3: Sync Read & Diff | Complete | 112 (cumulative) | `5ef50f2` |
| 3.5: PostgreSQL migration + DB validation | Complete | 112 (all passing on PG) | — |
| 3.6: DigitalOcean deployment + multi-store unblock | Complete | 112 (all passing against DO PostgreSQL) | — |
| 4: Sync Transform & Execute | Not started | — | — |
| 5: History & Polish | Not started | — | — |

---

## Phase 3 Cleanup Backlog

Non-blocking issues surfaced during Phase 3.6 deployment and smoke testing. Address opportunistically before or during Phase 4; none block Phase 4 from starting.

### CU-001: Duplicate `authenticate.admin` on embedded iframe first-load
**Observed:** 2026-04-11 in DO runtime logs during Store B first-install. Two parallel requests both hit `authenticate.admin(request)` at the same millisecond, both logged "No valid session found", both ran the full offline token exchange, both wrote a session row. Returned 200 on `/app` so user flow was unaffected, but this is a race that could duplicate sessions in the DB under load.
**Impact:** Low. Prisma session storage likely upserts on primary key so duplicates are deduped, but worth confirming. Also wastes one token-exchange roundtrip per first-load.
**Possible causes:** React Router parallel subrequests for the iframe + data loader, or embedded iframe initialization doing a redundant auth check.
**Investigation:** trace which two requests are racing. If it's the iframe document request + the loader data fetch, consider whether one can wait on the other. If it's a single request hitting a loader twice, that's a React Router or framework bug.

### CU-002: Stale `trycloudflare.com/extensions` WebSocket reference
**Observed:** 2026-04-11 in browser console on the deployed app. Shopify's admin-side rendering JS (`render-common-*.js`, served from `cdn.shopify.com`) tries to open a WebSocket to `wss://listed-sale-bangkok-stretch.trycloudflare.com/extensions` and fails. This looks like a stale extensions-dev-server URL persisted in the Partner Dashboard from a previous `shopify app dev` session.
**Impact:** None observed. The WebSocket failure doesn't break anything — extensions don't exist in the repo (`extensions/` is empty) and the embedded app renders fine.
**Investigation:** check Partner Dashboard → Cascade → extension development settings for a stale tunnel URL. May auto-clear next time `shopify app dev` runs and registers a fresh tunnel. Safe to ignore unless it causes user-visible breakage.

### CU-003: Polaris cosmetic baseline cleanup
**Resolved:** 2026-04-11. Swept `app/routes/app._index.tsx`, `app.stores.tsx`, `app.sync.tsx` to use correct Polaris web component attributes per Shopify's `polaris-app-home` docs (`<s-box>` instead of non-existent `<s-card>`, `color="subdued"` instead of `tone="subdued"` on `<s-text>`, `type="strong"` instead of `variant="headingSm"`, `gap="small-200"` instead of invalid `gap="tight"`, removed unsupported `helpText` prop from `<s-text-field>`). Done pre-emptively to give the upcoming styling/UX pass a correct-by-construction baseline.

---

## Phase 4 Handoff

**Status as of 2026-04-11:** Phase 3.6 is complete and **manually validated end-to-end against two real dev stores**. The app is deployed to DigitalOcean App Platform at `https://cascade-app-off6g.ondigitalocean.app`, both dev stores are installed via the deployed URL (primary + `steadro-prod-2.myshopify.com` paired), all 112 tests pass against the production PostgreSQL locally (after the local IP was added to Trusted Sources), and Kyle has walked through the 5-test smoke checklist with all green: app loads embedded on both stores with correct role banners, pairing card renders with active status, sync preview ran cross-store reads and produced a correct diff summary (0 create / 26 update / 2 unchanged across Products, Collections, Pages, Blogs & Articles, Navigation Menus), "Start Sync" correctly disabled, Back navigation works.

**Phase 4 is cleared to begin.** The "Start Sync" button is intentionally disabled in Phase 3 and should remain disabled until Phase 4's mutation execution work is ready.

**Decision on scope of Phase 4 work before deploy:** Phase 4 coding (mutation execution, ID remapping, CDN rewriting, progress tracking) can proceed against unit tests and single-store `shopify app dev` without a deploy. But the first real end-to-end sync from Store A → Store B requires the deploy to have happened. Plan the deploy for when the first mutation execution is ready to exercise, or sooner if convenient.

**What Phase 4 covers** (from SPEC_TECHNICAL.md):
- ID remapping using ResourceMap (cross-store GID translation)
- CDN URL rewriting for HTML content (Shopify CDN domains differ per store)
- Mutation execution for each resource type (productSet, collectionCreate/Update, pageCreate/Update, etc.)
- ResourceMap updates after successful creates (persist new GID mappings)
- Progress tracking and SyncJob status updates (pending → running → completed/failed)
- Execution progress UI

**What's already in place:**
- Sync engine reads source and target stores (reader.server.ts)
- Handle-based matcher resolves cross-store resources (matcher.server.ts)
- Diff engine detects create/update/skip changes (diff.server.ts)
- Preview UI renders diffs before sync
- ResourceMap table stores GID mappings
- SyncJob table tracks job state
- All tested against PostgreSQL

**Key dependencies for Phase 4:**
- `productSet` mutation must include ALL variants (AD in SPEC — omitted variants get deleted)
- Sync order: metafield definitions → products → collections → pages → blogs → menus → redirects
- CDN URL rewriting must handle `cdn.shopify.com/s/files/...` patterns in HTML content (pages, blog posts, metafields)
- `createAdminApiClient` is used for cross-store API calls (AD-004)

---

## Session Log

Reverse-chronological record of major development sessions.

### Phase 3.6: DigitalOcean Deployment & Multi-Store Unblock
**Date:** 2026-04-11 — 2026-04-12 (Kyle + Claude)

**Major actions:**
- Deployed app to DigitalOcean App Platform (`cascade-app-off6g.ondigitalocean.app`)
- Replaced Dockerfile: Alpine → `node:20-slim`, multi-stage build, removed CMD migrations (AD-007, AD-008)
- Added `/health` endpoint for DO health check
- Configured PRE_DEPLOY job for `prisma migrate deploy`
- Updated `shopify.app.toml` with deployed URL, ran `shopify app deploy` (version `cascade-2`)
- Installed Cascade on both dev stores via deployed URL, verified multi-store install flow
- Fixed sync page dropdown (`<option>` → `<s-option>` per Polaris web components API)
- Ran 5-test multi-store smoke test: all green (app loads both stores, pairing renders, sync preview produces correct diff)
- Fixed CI pipeline: collapsed 9-job matrix to single npm+Node22, fixed Prisma validate env, removed unused JS branch workflow
- Polaris cosmetic sweep: corrected `s-card` → `s-box`, `variant` → `type`/drop, `tone="subdued"` → `color="subdued"`, `gap="tight"` → `gap="small-200"`, removed invalid `helpText`
- Fixed TypeScript: narrowed env var types in `shopify.server.ts`, cast test fixtures for React Router 7 `LoaderFunctionArgs`
- Fixed ESLint: added test override for `no-explicit-any`, removed unused vars, typed event handlers
- Locked `automatically_update_urls_on_dev = false` in `shopify.app.toml` to prevent `shopify app dev` from overwriting the deployed URL
- Added local/cloud workflow docs to CLAUDE.md
- Cleaned up `.env` for local development
- Committed `package-lock.json` (was gitignored, broke `npm ci` on DO)
- Added security headers (X-Content-Type-Options, HSTS, Referrer-Policy)
- Cleaned up debug logging in webhook handler
- Added control character stripping to label input
- Expanded `.dockerignore`, removed stale SQLite refs from `.gitignore`
- Added developer onboarding path to CLAUDE.md
- Deleted one-time `DEPLOY_TASKS.md`

**Key commits:** `bd86d5b` through `f8f5c7a` (see `git log` for full list)

**Validation:** 112 tests pass on DO PostgreSQL; CI green; `/health` returns 200; multi-store smoke test 5/5 green.

**Status:** Phase 3.6 complete. Phase 4 (sync execution) cleared to begin.

---

### Phases 1–3.5: Foundation through PostgreSQL Migration
**Dates:** 2026-04-01 — 2026-04-09

**Summary:** Scaffolded from Shopify React Router template, corrected to RR7 patterns. Implemented store pairing (soft-delete, handle-based matching), subscription tier detection (name-based, WA-001/WA-002), sync read engine (7 resource types), diff engine (timestamp + content-hash comparison), preview UI. Migrated from SQLite to PostgreSQL-only (AD-005). 112 tests across unit and integration suites.

**Phase completion:** See table above for per-phase status, test counts, and commit hashes.

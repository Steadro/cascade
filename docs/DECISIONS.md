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
| 4: Sync Transform & Execute | Not started | — | — |
| 5: History & Polish | Not started | — | — |

---

## Phase 4 Handoff

**Status as of 2026-04-11:** Phases 1–3 are complete in code. PostgreSQL is validated and all 112 tests pass against DigitalOcean managed PostgreSQL. Before Phase 4 end-to-end work begins, Phases 1–3 must be validated against the deployed app on DigitalOcean App Platform with two real dev stores installed (per AD-006 and SPEC_TECHNICAL.md § "Multi-Store Development Testing"). Any issues surfaced there belong in Phase 3 cleanup, not Phase 4 scope.

**Immediate blocker:** The app has not been deployed yet. The DO App Platform project exists and the GitHub main branch is linked, but the component has not been configured, no env vars are set, and no container has been built. `shopify.app.toml` still has `application_url = "https://example.com"`. The concrete next action is the **First-Time Deploy Runbook** in `docs/CLAUDE.md` § "Deployment" — nine ordered steps that take the project from "branch linked" to "two stores installed and Phase 1–3 validated."

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

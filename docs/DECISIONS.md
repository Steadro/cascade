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

---

## Dev Workarounds (Temporary — Must Be Removed)

### WA-001: DEV_PLAN_OVERRIDE environment variable
**Date:** 2026-04-02
**Phase:** Added during Phase 3 testing
**What:** Setting `DEV_PLAN_OVERRIDE=pro|business|enterprise` in the environment bypasses the Shopify subscription check and returns that tier directly.
**Why:** Managed Pricing plans aren't set up in the Partner Dashboard yet. Without this, the app returns "free" tier on dev stores, which blocks pairing (limit: 0) and makes the sync feature untestable.
**Where:** `app/utils/subscription.server.ts` — checked at the top of `getSubscriptionStatus()`.
**Risk:** If this leaks to production, all merchants get free access to paid features.
**Removal condition:** Remove when Managed Pricing plans are created in the Partner Dashboard and at least one dev store has an active test subscription.
**Removal checklist:**
- [ ] Create Pro, Business, Enterprise plans in Partner Dashboard
- [ ] Activate a test subscription on the dev store
- [ ] Verify `getSubscriptionStatus` returns the correct tier without the override
- [ ] Delete the `DEV_PLAN_OVERRIDE` check from `subscription.server.ts`
- [ ] Remove `DEV_PLAN_OVERRIDE` from `.env` and `.env.example`
- [ ] Switch to plan ID-based tier detection (AD-003)

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
| 4: Sync Transform & Execute | Not started | — | — |
| 5: History & Polish | Not started | — | — |

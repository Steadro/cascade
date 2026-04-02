# Steadro Shopify Environment Sync App

## Project Overview

**Product Name:** Cascade
**Company:** Steadro (developer/publisher)
**Repo:** `cascade` (to be created)
**Company:** Steadro
**Goal:** Build a Shopify app that enables enterprise merchants to promote store content and configuration between development, staging, and production environments.
**Secondary Goal:** First publicly launched AI-developed app for Steadro — a showcase of Shopify expertise and AI-driven development methodology.

---

## Problem Statement

Enterprise Shopify merchants commonly maintain multiple stores (dev, staging, production) but have no reliable, automated way to keep them in parity. The resources most often neglected by existing tools are the "forgotten" data types: products, collections, navigation menus, pages, and content assets. Teams end up manually recreating these across environments, which is slow, error-prone, and creates drift between environments.

**Core user flow:** Dev → Staging → Production (and reverse for pulling prod data down to dev/staging).

---

## Decisions Made (from Research)

These decisions are confirmed and should not be revisited without new information. They form the constraints for all downstream specification and development.

### Platform & API Decisions

1. **GraphQL Admin API exclusively.** As of April 1, 2025, all new public apps must use GraphQL. No REST Admin API anywhere in the codebase. REST is legacy and receives no new features.

2. **Embedded app using App Bridge.** Shopify strongly pushes embedded apps. Must load `app-bridge.js` from Shopify's CDN in the `<head>` of every page, before any other scripts. Required by October 15, 2025 for all App Store apps.

3. **Polaris design system for all UI.** Use Shopify's Polaris web components for visual consistency with the admin. Not strictly mandatory for our category but strongly recommended and reduces rejection risk.

4. **Session token authentication.** Embedded apps must use session tokens (short-lived JWTs, 1-minute lifetime, HS256). No reliance on third-party cookies or localStorage. Must work in Chrome incognito mode.

5. **Shopify managed installation flow.** Configure in `shopify.app.toml`. Eliminates redirect flicker and lets Shopify handle the install process.

6. **`productSet` is the primary product sync mutation.** Designed explicitly for syncing from external sources. Handles create-or-update for products with variants, options, metafields, media, and collection membership in a single call. Supports sync and async modes.

7. **Bulk Operations API for large-scale sync.** Up to 5 concurrent bulk queries and 5 bulk mutations per store (API version 2026-01+). Not rate-limited themselves. JSONL format, 100MB file limit, 10-day timeout. Use for initial full sync and large batch operations.

8. **Handle-based matching for cross-store resource identification.** Products, collections, pages, menus, metaobject types all have unique handles. Use handles to match resources between stores when no ID mapping exists yet. Store GID mappings for subsequent syncs.

### Billing Decisions

9. **Managed Pricing for MVP.** Define plans in Partner Dashboard. Shopify hosts the plan selection page. Handles recurring charges, free trials (with 180-day abuse prevention), proration, and test charges automatically. No billing code needed beyond redirecting merchants to the plan page and checking subscription status.

10. **Bill only on the production store.** Paired dev/staging stores install the app for free. Our backend validates pairing relationships and gates features based on the production store's active subscription. This is the simplest model and abuse risk is genuinely low.

11. **Dev store detection is unreliable — don't attempt it.** There is no official API field to detect dev vs paid stores. The `shop.plan` query can give hints but isn't officially supported. Use the billing relationship itself as the gating mechanism instead.

### Compliance Decisions

12. **Three mandatory compliance webhooks must be implemented.** `customers/data_request`, `customers/redact`, and `shop/redact`. Configure in `shopify.app.toml`. Must validate HMAC signatures and respond with 200-series status. Missing these = automatic rejection.

13. **Privacy policy URL is required.** Must cover: data collected, how it's used, retention periods, cross-border storage, and contact information.

14. **Minimal access scopes.** Request only what's needed. Use optional scopes for features not needed by all merchants.

15. **API versioning: target latest stable, plan for quarterly updates.** New API versions release quarterly. Each version supported for minimum 12 months. Falling behind = delisting.

---

## Scope

### In Scope (MVP) — API-Confirmed Capabilities

Every resource listed below has been confirmed as fully syncable via the Shopify GraphQL Admin API.

| Category | Key Mutations | Sync Strategy |
|----------|--------------|---------------|
| **Products** | `productSet` (create/update), `productVariantsBulkCreate/Update`, `publishablePublish` | `productSet` as primary sync primitive. Handles variants, options, metafields, media, collections in one call. Match by handle. Bulk Operations for large catalogs. |
| **Collections** | `collectionCreate`, `collectionUpdate`, `collectionAddProducts` | Create via `collectionCreate`, match by handle. Smart collections sync rules (portable). Manual collections require product ID remapping. |
| **Navigation Menus** | `menuCreate`, `menuUpdate`, `menuDelete` | Full CRUD available since API 2024-07. Nested items up to 3 levels. Menu item `resourceId` fields require ID remapping. |
| **Pages** | `pageCreate`, `pageUpdate` | Title, handle, body HTML, templateSuffix, isPublished, metafields. Embedded images in body HTML need CDN URL replacement. |
| **Content/Assets** | `stagedUploadsCreate` → `fileCreate` | Two-step upload: stage then create. Shortcut: pass public CDN URL as `originalSource` and let Shopify download it. Media processing is async — poll for READY status. |
| **Metafield Definitions** | `metafieldDefinitionCreate`, `metafieldDefinitionUpdate` | Sync definitions BEFORE data. Match by ownerType + namespace + key. Cannot change type/namespace/key after creation. |
| **Metafield Values** | `metafieldsSet` | Set on any resource by ownerId + namespace + key. Idempotent create-or-update. |
| **Blog Posts** | `blogCreate`, `articleCreate`, `articleUpdate` | Blog container + articles. Same CDN image considerations as pages. |
| **URL Redirects** | `urlRedirectCreate`, `urlRedirectImportCreate` (bulk CSV) | Path → target mapping. Bulk import via CSV staged upload. |
| **Store Pairing** | Custom logic (not a Shopify resource) | Our app's data model. Production store subscribes, dev/staging stores pair via app UI. |
| **Promotion Flow** | Custom logic using mutations above | Source → target directional sync. Preview diff → confirm → execute. |

### In Scope (V2 — Post-MVP, API-Confirmed)

| Category | Key Mutations | Notes |
|----------|--------------|-------|
| **Metaobjects** | `metaobjectDefinitionCreate`, `metaobjectCreate`, `metaobjectUpsert` | Full CRUD. `metaobjectUpsert` is handle-based idempotent — ideal for sync. Sync definitions first, then instances. |
| **Translations** | `translationsRegister`, `translatableResource` query | Complex flow: read translations → map resource IDs → get digests from target → register. Market-scoped. |
| **Discounts** | `discountCodeBasicCreate`, `discountAutomaticBasicCreate`, etc. | Codes syncable but customer usage data is not. Functions-based discounts require separate deployment. |
| **Scheduled Syncs** | N/A | Cron-based automation. No Shopify API dependency — purely our infrastructure. |
| **Rollback/Snapshots** | Custom logic | Snapshot state before sync, store in our DB, allow restore. |
| **Drift Detection** | Webhook subscriptions | Subscribe to resource change webhooks on both stores, compare to detect drift. |

### Out of Scope (No API or Wrong Use Case)

| Category | Reason |
|----------|--------|
| **Theme files** | CI/CD via GitHub preferred. Asset API exists but excluded by design. |
| **Orders / Customers** | Privacy concerns, different data per environment, massive complexity. |
| **Shopify Flow workflows** | No API for full workflow sync. |
| **Store settings** (most) | Read-only via API (name, currency, timezone, etc.). |
| **Staff accounts / Permissions** | No API. |
| **Payment gateway config** | No API. |
| **Checkout customizations** | Shopify Functions deployment, not data sync. |
| **App installations** | Cannot be automated. |

---

## Answered Open Questions

| Question | Answer | Source |
|----------|--------|--------|
| Can we detect if a paired store is in "test mode" via API? | **No reliable method.** `shop.plan` gives hints but isn't officially supported. | Billing research |
| What pricing model prevents abuse while staying fair? | **Bill production store only.** Paired stores are free. Abuse risk is genuinely low — a cloned store has no independent value. | Billing research |
| Are there Shopify Plus-only APIs we'd need? | **No.** All APIs we need work on all plans. Rate limits are higher on Plus (1,000 pts/sec vs 100 pts/sec) but the APIs themselves are available. Bulk Operations are the equalizer for standard-plan stores. | API inventory |
| What are the rate limits for bulk operations? | **Bulk Operations bypass normal rate limits.** Only the create/poll requests count. Standard plans: 100 pts/sec. Plus: 1,000 pts/sec. Max 5 concurrent bulk ops per type (v2026-01+). | API inventory |
| Should we support partial sync? | **Yes, by design.** The promotion flow already lets users select resource types. Product-level granularity (sync specific products/collections) is a natural extension. | Architecture decision |

### Remaining Open Questions

- [ ] What hosting infrastructure? (DigitalOcean App Platform is the leading candidate)
- [ ] How do we implement change detection / diff between two stores? (Snapshot-based? Hash comparison? Timestamp-based?)

### Confirmed Implementation Decisions

- **App name:** Cascade
- **Tech stack:** Remix (React Router) + Node.js + `@shopify/shopify-app-js`
- **Database:** Prisma ORM, SQLite for local dev, PostgreSQL for production
- **Hosting candidate:** DigitalOcean (App Platform or Droplet + managed PostgreSQL)

---

## Pricing Model (Confirmed Approach)

**Implementation:** Shopify Managed Pricing (Partner Dashboard, no billing code)

| Plan | Price | Stores Included | Target Merchant |
|------|-------|----------------|-----------------|
| **Free** | $0/mo | 1 store | Lead gen: read-only diff/comparison view, no sync execution |
| **Pro** | $49–79/mo | 1 prod + 1 dev/stage | Small enterprise teams with a single dev environment |
| **Business** | $129–199/mo | 1 prod + 3 stores | Teams with dev + staging + QA environments |
| **Enterprise** | Custom (private plan) | 1 prod + unlimited | Large enterprise via private Managed Pricing plan |

**Free trial:** 14 days on Pro and Business plans. Managed Pricing's 180-day abuse window prevents trial gaming.

**Annual discount:** 2 months free on annual billing (~17% discount). Annual plans cannot use usage-based billing, but we don't need usage billing for MVP.

**How pairing works:**
- Production store installs app → subscribes to paid plan via Shopify's hosted plan page
- From within the app, merchant enters the myshopify domain of their dev/staging store
- Dev/staging store must also install the app (free plan, no charge)
- Our backend associates the stores and validates the production store's active subscription
- If production store cancels → paired stores lose sync capability
- Webhook `APP_SUBSCRIPTIONS_UPDATE` detects cancellations

**Revenue share impact:** 0% on first $1M lifetime revenue (effective June 16, 2025). 2.9% processing fee on all charges. $19 one-time App Store registration.

---

## Technical Architecture (Updated)

```
┌──────────────────────────────────────────────────────────┐
│                    Steadro Sync App                       │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │
│  │ Embedded   │  │ Sync       │  │ Background Jobs    │ │
│  │ App UI     │  │ Engine     │  │ (Bulk Ops Polling, │ │
│  │ (Polaris + │  │ (Diff,     │  │  Webhook Handler,  │ │
│  │ App Bridge)│  │  Transform,│  │  Compliance)       │ │
│  │            │  │  Execute)  │  │                    │ │
│  └─────┬──────┘  └─────┬──────┘  └────────┬───────────┘ │
│        │               │                  │              │
│  ┌─────┴───────────────┴──────────────────┴───────────┐  │
│  │              Shopify GraphQL API Layer              │  │
│  │  (Session tokens, per-store auth, rate management)  │  │
│  └──┬──────────────┬──────────────┬───────────────────┘  │
│     │              │              │                       │
│  ┌──┴───────┐  ┌───┴────────┐  ┌─┴──────────┐           │
│  │ Store    │  │ ID Mapping │  │ Sync State │           │
│  │ Pairing  │  │ Table      │  │ & History  │           │
│  │ Registry │  │            │  │            │           │
│  └──────────┘  └────────────┘  └────────────┘           │
└──────────────────────────────────────────────────────────┘
         │              │              │
    ┌────┴────┐   ┌─────┴────┐  ┌─────┴────┐
    │  Dev    │   │  Stage   │  │  Prod    │
    │  Store  │   │  Store   │  │  Store   │
    └─────────┘   └──────────┘  └──────────┘
```

### Architecture Principles

**GraphQL only.** No REST Admin API calls anywhere. This is a Shopify mandate for new apps as of April 2025.

**Embedded app.** Runs inside the Shopify admin via App Bridge. Session token auth, Polaris UI components, `s-app-nav` for navigation.

**Per-store isolation.** Each store installation gets its own OAuth access token, webhook subscriptions, and rate limit bucket. Rate limits do NOT cross stores — API calls to the dev store don't consume the prod store's budget.

**Queue-based sync execution.** Sync operations are inherently long-running (bulk operations can take minutes to hours). The UI should submit sync jobs to a queue, return immediately, and poll/webhook for completion.

**ID mapping is the core data model challenge.** Every Shopify resource has a store-specific GID. Our app must maintain a mapping table linking equivalent resources across paired stores. Initial matching by handle; subsequent syncs use stored GID mappings.

### Sync Execution Strategy

**For small batches (< ~50 resources):** Use direct GraphQL mutations (`productSet`, `collectionCreate`, etc.) with rate limit awareness. Faster turnaround, simpler error handling.

**For large batches (50+ resources):** Use Bulk Operations API. Export from source store via `bulkOperationRunQuery` → download JSONL → transform (remap IDs, rewrite CDN URLs) → upload via `stagedUploadsCreate` → import via `bulkOperationRunMutation`.

**Sync dependency order** (must be respected):

```
1. Metafield Definitions     ← No dependencies. Schema must exist first.
2. Files / Assets             ← No dependencies. Upload media before referencing.
3. Products                   ← Depends on: files (for media), metafield defs
4. Collections                ← Depends on: products (for manual membership)
5. Pages                      ← Depends on: files (for embedded images)
6. Blog Posts                 ← Depends on: files (for images)
7. Navigation Menus           ← Depends on: products, collections, pages, blogs (resource links)
8. URL Redirects              ← No hard dependencies; logically last
```

### CDN Asset Strategy

Product/collection/page content may reference the source store's CDN URLs (`cdn.shopify.com/s/files/...`). These are NOT portable between stores.

**Shortcut available:** For publicly accessible CDN images, `productSet` and `fileCreate` accept `originalSource` as a URL — Shopify downloads and re-hosts it automatically. This avoids the staged upload step for most cases. Fall back to full staged upload only for private or very large files.

**Body HTML rewriting:** Page and article body HTML may contain inline CDN image URLs. Our sync engine must parse HTML, identify Shopify CDN URLs, re-upload those assets to the target store, and rewrite the URLs in the HTML before creating/updating the page.

### Rate Limit Strategy

| Store Plan | Points/Second | Strategy |
|-----------|---------------|----------|
| Standard (Basic, Shopify, Advanced) | 100 pts/sec | Use Bulk Operations for anything > 50 items. Queue individual mutations with backoff. |
| Plus | 1,000 pts/sec | Direct mutations viable for larger batches. Bulk Operations still preferred for 500+ items. |

Mutations cost 10 points base. At 100 pts/sec on standard plans, that's ~10 mutations/second max. A 500-product sync via individual `productSet` calls would take ~50 seconds of pure API time, plus media processing. Bulk Operations eliminate this bottleneck entirely.

---

## App Store Compliance Checklist

These requirements must be met before submission. Derived from our App Store requirements research.

### Must-Have for Submission

- [ ] Session token authentication (no third-party cookies, works in incognito)
- [ ] App Bridge loaded in `<head>` before all other scripts (latest version from Shopify CDN)
- [ ] Shopify managed installation configured in `shopify.app.toml`
- [ ] GraphQL Admin API only (no REST calls)
- [ ] Three compliance webhooks: `customers/data_request`, `customers/redact`, `shop/redact`
- [ ] Managed Pricing plans defined in Partner Dashboard
- [ ] Billing flow works on reinstall (can accept/decline/re-approve charges)
- [ ] Plan upgrades and downgrades work without contacting support
- [ ] Privacy policy URL provided in app listing
- [ ] Emergency developer contact (email + phone) in listing
- [ ] Demo screencast (English or English-subtitled) with working test credentials
- [ ] App icon: 1200×1200px JPEG/PNG, bold colors, no text/screenshots/trademarks
- [ ] Feature image: 1600×900px, 16:9
- [ ] Screenshots showing actual app UI (no pricing, testimonials, or PII in images)
- [ ] App name: unique, starts with brand, ≤30 characters, no "Shopify"
- [ ] Minimal access scopes (only request what's needed, justify restricted scopes)
- [ ] TLS/SSL on all endpoints
- [ ] No critical or minor errors during review (no 404s, 500s, broken UI)

### Nice-to-Have (Improves Review Outcome)

- [ ] Polaris components throughout
- [ ] Responsive design (mobile-friendly)
- [ ] App Bridge Contextual Save Bar for forms
- [ ] `s-app-nav` for navigation (not custom menus)
- [ ] No pop-up windows for essential flows
- [ ] Fast load times (target LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms)

---

## Required Access Scopes

| Scope | Reason |
|-------|--------|
| `write_products` | Sync products, variants, collections |
| `read_products` | Read products/collections from source store |
| `write_inventory` | Set inventory quantities during product sync |
| `read_inventory` | Read inventory levels from source store |
| `write_content` | Sync pages, blog posts |
| `read_content` | Read pages, blog posts from source store |
| `write_online_store_navigation` | Sync menus, URL redirects |
| `read_online_store_navigation` | Read menus, redirects from source store |
| `write_files` | Upload files/assets to target store |
| `read_files` | Read file metadata from source store |

**Deferred scopes (V2):**

| Scope | Reason |
|-------|--------|
| `write_metaobjects` / `read_metaobjects` | Metaobject sync |
| `write_translations` / `read_translations` | Translation sync |
| `write_discounts` / `read_discounts` | Discount sync |

---

## Competitive Landscape

**Status:** ✅ Complete — see `RESEARCH_competitive.md` for full analysis.

**Key finding: No tool in the Shopify ecosystem delivers true environment-aware content promotion.** The market has fragmented into three tiers, none of which understands the concept of environments, change detection, or selective resource promotion.

### Tier 1: Bulk Import/Export (Matrixify)

| Tool | Rating | Price | Positioning |
|------|--------|-------|-------------|
| **Matrixify** | 4.8★ (~598 reviews) | $20–200/mo | Spreadsheet-based import/export. Broadest resource coverage of any app. |

Matrixify is the incumbent power tool. It handles products, collections, pages, blogs, redirects, files, metaobjects, and navigation menus — but through Excel/CSV intermediaries. No environment awareness, no change detection, requires spreadsheet expertise. Metafield definitions must already exist on the target store before import.

### Tier 2: Product/Inventory Sync (Syncio, Multi-Store Sync Power, Tipo)

| Tool | Rating | Price | Positioning |
|------|--------|-------|-------------|
| **Syncio** | 4.7★ (~170 reviews) | Free–$129/mo | Real-time product/inventory sync, source/destination model |
| **Multi-Store Sync Power** | 4.2★ (~135 reviews) | Free–$49.99/mo | Bidirectional inventory sync with custom pricing rules |
| **Tipo** | 4.4★ (~98 reviews) | Free–$79/mo | Product sync + collections, pages, blogs (30-min batches) |

These apps serve multi-store commerce (wholesale/retail networks, international expansion). They focus almost exclusively on products and inventory. None syncs menus, files, metaobjects, or metafield definitions.

### Tier 3: Store Cloning (Rewind Staging, Simple Sync, Duplify) — Closest Competitors

| Tool | Rating | Price | Positioning |
|------|--------|-------|-------------|
| **Rewind Staging** | 3.9★ (66 reviews) | $99/mo + $29/extra dest | One-way continuous sync, part of protection suite |
| **Simple Sync** | 5.0★ (11 reviews) | $129–499/mo | Daily scheduled sync, broadest resource set of any sync tool. Launched Dec 2024. |
| **Duplify** | 4.8★ (109 reviews) | $79/mo | One-click store cloning, broad coverage including customers/orders |

**Rewind Staging** is the most recognized name but has declining reviews (3.9★), known metafield sync bugs, no menu sync, and no selective promotion. **Simple Sync** is the most direct threat — launched recently with broad resource coverage and metafield definition sync — but has only 11 reviews, high pricing ($129+), no change detection, and only daily sync frequency. **Duplify** is primarily a one-time cloner, not an ongoing sync tool.

### Resource Coverage Gap Analysis

| Resource | Our App (MVP) | Matrixify | Rewind Staging | Simple Sync | Syncio |
|----------|:---:|:---:|:---:|:---:|:---:|
| Products & variants | ✅ | ✅ | ✅ | ✅ | ✅ |
| Collections | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Navigation menus** | ✅ | ✅ (spreadsheet) | ❌ | Partial | ❌ |
| Pages | ✅ | ✅ | ✅ | ✅ | ❌ |
| Blog posts | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Metafield definitions** | ✅ | ❌ | ❌ | ✅ | ❌ |
| Files/assets | ✅ | ✅ | ✅ | ✅ | ❌ |
| URL redirects | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Environment awareness** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Change detection / diff** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Selective promotion** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Bidirectional sync** | ✅ | ❌ | ❌ | ❌ | ❌ |

### Our Differentiation (5 Market Gaps We Fill)

1. **Environment awareness.** We understand dev → staging → production as a deployment pipeline, not just "Store A and Store B."
2. **Change detection and selective promotion.** We can diff two stores and let users promote only what changed — no other tool does this.
3. **Comprehensive "forgotten resource" coverage.** Navigation menus, metafield definitions, and pages with ID-aware remapping — the resources developers manually recreate every time.
4. **Bidirectional sync.** Pull production changes back to staging. No competitor supports this.
5. **Aggressive pricing with a free tier.** Competitors start at $79–129/mo. Our free tier (read-only diff) plus $49–79/mo Pro undercuts every direct competitor.

### Competitive Timing Risk

Shopify's Summer 2025 Editions announced a CLI-based SQLite bulk data tool (still in beta) for importing/exporting data across environments. This is developer-focused and not a full sync solution, but it signals Shopify recognizes the gap. **Speed to market matters** — we should aim to be established before any native solution materializes.

---

## Development Methodology

### Principles

1. **Spec-driven:** Complete research and specification before code.
2. **AI-developed:** Built using Claude Code as primary development tool.
3. **Markdown-first:** All specs, research, and decisions documented in project markdown files. These files serve as Claude Code's context.
4. **Iterative:** MVP first, then expand based on real usage.
5. **Single-file artifacts where possible:** Keep related logic together rather than splitting across many small files. Easier for Claude Code to reason about.
6. **Explicit over implicit:** Document all assumptions, constraints, and decisions. Claude Code works best with clear, unambiguous context.

### Project Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **1. Research** | API capabilities, app requirements, billing, competitive landscape | ✅ Complete |
| **2. Specification** | Technical spec, data models, sync algorithms, UI wireframes | ⬜ Not Started |
| **3. Architecture** | System design, database schema, queue design, deployment plan | ⬜ Not Started |
| **4. MVP Build** | Core sync engine + embedded UI via Claude Code | ⬜ Not Started |
| **5. Testing** | Multi-store testing, edge cases, rate limit handling | ⬜ Not Started |
| **6. App Store Submission** | Compliance check, review prep, submission | ⬜ Not Started |
| **7. Launch** | Public release, documentation, marketing | ⬜ Not Started |

---

## Research Tracker

| # | Topic | Priority | Status | Findings Location |
|---|-------|----------|--------|-------------------|
| 1 | Shopify App Store requirements | 🔴 High | ✅ Complete | `RESEARCH_app_requirements.md` |
| 2 | API endpoint inventory | 🔴 High | ✅ Complete | `RESEARCH_api_inventory.md` |
| 3 | Competitive landscape analysis | 🟡 Medium | ✅ Complete | `RESEARCH_competitive.md` |
| 4 | Shopify billing API & pricing models | 🟡 Medium | ✅ Complete | `RESEARCH_billing_api.md` |
| 5 | ~~Bulk Operations API~~ | — | ✅ Covered by #2 | Included in `RESEARCH_api_inventory.md` |
| 6 | ~~Test store detection~~ | — | ✅ Covered by #4 | Included in `RESEARCH_billing_api.md` — answer: unreliable, don't attempt |
| 7 | ~~CDN asset migration~~ | — | ✅ Covered by #2 | Included in `RESEARCH_api_inventory.md` — staged uploads + originalSource shortcut |

**All research complete.** All seven topics have been completed — four as standalone deep dives and three covered within other research documents. Ready to move to Phase 2: Specification.

---

## File Index

| File | Purpose | Status |
|------|---------|--------|
| `PROJECT_PLAN.md` | Master project plan, decisions, tracker | ✅ Active |
| `RESEARCH_app_requirements.md` | Shopify App Store requirements (all 5 sections) | ✅ Complete |
| `RESEARCH_api_inventory.md` | API endpoints: what can/can't be synced, mutations, bulk ops | ✅ Complete |
| `RESEARCH_billing_api.md` | Billing API, Managed Pricing, revenue share, pricing strategy | ✅ Complete |
| `RESEARCH_competitive.md` | Competitive landscape: tiers, gaps, differentiation, timing risks | ✅ Complete |
| `SPEC_technical.md` | Technical specification | ⬜ Not Started |
| `SPEC_data_model.md` | Data model, ID mapping, sync algorithm spec | ⬜ Not Started |
| `SPEC_ui.md` | UI/UX specification, screens, flows | ⬜ Not Started |

---

## Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Rate limits on standard-plan stores** | Slow sync for large catalogs | Use Bulk Operations API for anything >50 items. Queue with backoff for individual mutations. |
| **`productSet` deletes omitted variants** | Accidental data loss if sync payload is incomplete | Always include ALL variants in `productSet` input. Read full product before updating. |
| **CDN URL references in HTML content** | Broken images on target store | Parse body HTML, detect Shopify CDN URLs, re-upload, rewrite before saving. |
| **Metafield references to other resources** | Broken cross-references after sync | Metafield values containing GIDs (file references, product references) need ID remapping. Detect by metafield type definition. |
| **App review rejection** | Delayed launch | Follow compliance checklist strictly. Provide clear demo screencast and test credentials. Common rejections: billing errors, broken install flow, UI errors. |
| **API version deprecation** | Delisting if we fall behind | Monitor Shopify changelog. Plan quarterly API version updates. Partner Dashboard shows API health report. |
| **50,000 variant throttle** | Stores with massive catalogs hit 1,000 variant creates/day limit | Use `productSet` (which may handle this differently than `productCreate`). Break large syncs into multi-day batches if needed. |
| **Shopify native tooling** | Shopify announced a CLI-based SQLite bulk data tool (beta) for cross-environment data management | Speed to market. Establish user base before any native solution ships. Our environment-awareness and UI layer add value beyond raw data transfer. |
| **Simple Sync as emerging competitor** | Launched Dec 2024 with broad resource coverage and metafield definition sync | Differentiate on environment awareness, change detection/diff, selective promotion, and bidirectional sync — none of which Simple Sync offers. Price more aggressively. |

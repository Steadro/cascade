# Cascade — Project Context

**Product:** Cascade
**Developer:** Steadro (kyle@steadro.com)
**Repo:** https://github.com/Steadro/cascade
**Status:** Scaffolded, app running on dev store, ready for development

---

## What We're Building

Cascade is a Shopify embedded app that lets enterprise merchants promote store content between dev, staging, and production environments. Think of it as CI/CD for Shopify store data — the missing piece that lets teams make changes on a dev store and push them to production with confidence.

**Core user flow:** Dev → Staging → Production (and reverse for pulling prod data down to dev/staging).

## Why This Exists

Enterprise Shopify merchants maintain multiple stores (dev, staging, production) but have no reliable way to keep them in sync. The resources most often neglected are the "forgotten" data types: products, collections, navigation menus, pages, metafield definitions, and content assets. Teams manually recreate these across environments, which is slow, error-prone, and creates drift.

Shopify has no native staging environment. No built-in store duplication. No content sync mechanism. The Shopify CLI only handles theme files. Community forums going back years are full of frustrated developers comparing Shopify unfavorably to WordPress's one-click staging.

## Who Else Does This (Nobody, Well)

The market has fragmented into three tiers, none built for environment promotion:

**Tier 1 — Bulk import/export (Matrixify):** Spreadsheet-based. Broadest resource coverage but entirely manual, no environment awareness, no change detection. 4.8★, ~598 reviews, $20–200/mo.

**Tier 2 — Product/inventory sync (Syncio, Multi-Store Sync Power, Tipo):** Built for multi-store commerce (wholesale/retail, international). Products and inventory only — no pages, menus, metafield definitions, or content.

**Tier 3 — Store cloning (Rewind Staging, Simple Sync, Duplify):** Closest to our use case but fundamentally one-way copiers.
- **Rewind Staging** ($99/mo, 3.9★): No menu sync, no metafield definitions, no selective promotion, known metafield bugs.
- **Simple Sync** ($129–499/mo, 5.0★ but only 11 reviews): Launched Dec 2024, broadest resource set, but daily sync only, no diff, no selective promotion, no bidirectional sync.
- **Duplify** ($79/mo, 4.8★): Primarily a one-time cloner, not ongoing sync.

**Our five differentiators:**
1. **Environment awareness** — we understand dev → staging → prod as a pipeline
2. **Change detection / diff** — show what's different between stores before syncing
3. **Selective promotion** — sync only specific resources or changes
4. **Bidirectional sync** — pull production changes back to staging
5. **Aggressive pricing** — competitors start at $79–129/mo; we offer a free tier plus $49–79/mo Pro

**Timing risk:** Shopify announced a CLI-based SQLite bulk data tool (beta) for cross-environment data management. Developer-focused, not a full sync solution, but signals Shopify recognizes the gap. Speed to market matters.

---

## Business Decisions

**Pricing (Managed Pricing, no billing code):**

| Plan | Price | Stores | Target |
|------|-------|--------|--------|
| Free | $0/mo | 1 store, view-only diff | Lead generation |
| Pro | $49–79/mo | 1 prod + 1 paired | Small enterprise teams |
| Business | $129–199/mo | 1 prod + 3 paired | Dev + staging + QA teams |
| Enterprise | Custom | Unlimited | Large enterprise (private plan) |

Free trial: 14 days. Annual discount: 2 months free (~17%).

**Billing model:** Bill only on the production store. Paired dev/staging stores install for free. Feature gating is based on the primary store's subscription status. Abuse risk is low — a cloned store has no independent value.

**Revenue share:** 0% on first $1M lifetime. 2.9% processing fee. $19 one-time App Store registration (not yet paid — save for submission time).

---

## What Can Be Synced (API-Confirmed)

Every resource below has been verified as fully readable and writable via the Shopify GraphQL Admin API:

| Resource | Read | Write | Key Mutation | Match By |
|----------|:----:|:-----:|-------------|----------|
| Products (+ variants, images, metafields) | ✅ | ✅ | `productSet` | handle |
| Collections (smart + manual) | ✅ | ✅ | `collectionCreate/Update` | handle |
| Navigation Menus (3 levels deep) | ✅ | ✅ | `menuCreate/Update` | handle |
| Pages | ✅ | ✅ | `pageCreate/Update` | handle |
| Blog Posts | ✅ | ✅ | `blogCreate`, `articleCreate/Update` | handle |
| Metafield Definitions | ✅ | ✅ | `metafieldDefinitionCreate` | ownerType + namespace + key |
| Metafield Values | ✅ | ✅ | `metafieldsSet` | ownerId + namespace + key |
| Files/Assets | ✅ | ✅ | `stagedUploadsCreate` → `fileCreate` | inline with parent |
| URL Redirects | ✅ | ✅ | `urlRedirectCreate` | path |

**What CANNOT be synced:** Orders, customers, themes (by design — use CI/CD), Shopify Flow workflows (no API), most store settings (read-only), staff accounts, payment config, checkout customizations.

**V2 resources (API-confirmed, deferred):** Metaobjects (`metaobjectUpsert` — ideal for sync), translations (`translationsRegister`), discounts.

---

## Key Technical Facts

These are research findings that inform the spec. Not implementation instructions — those are in `SPEC_TECHNICAL.md`.

**`productSet` is purpose-built for external sync.** Creates or updates a product with variants, options, metafields, media, and collection membership in one call. Supports sync and async modes. Designed explicitly for syncing from external data sources.

**Bulk Operations API bypasses rate limits.** Up to 5 concurrent bulk queries and 5 bulk mutations per store (API v2026-01+). JSONL format, 100MB file limit, 10-day timeout. Essential for large stores.

**Rate limits are per-app per-store.** API calls to the dev store don't consume the prod store's budget. Standard plans: 100 pts/sec. Plus: 1,000 pts/sec. Mutations cost 10 points.

**CDN URLs are not portable.** `cdn.shopify.com/s/files/...` URLs are store-specific. Product media can use `originalSource` URL shortcut (Shopify re-downloads). Page/article body HTML needs CDN URL detection and rewriting.

**Every resource has a store-specific GID.** `gid://shopify/Product/12345` on Store A has no relationship to Store B. Cross-store ID mapping is the core data challenge. Handle-based matching for first sync, stored GID mappings for subsequent syncs.

**Navigation menu API is relatively new.** Added in API version 2024-07. This means most competitors don't support it — it's a differentiator.

**`productSet` deletes omitted variants.** If you call `productSet` without including all existing variants, the missing ones get deleted. Always read the full product before updating.

**Metafield definitions must exist before values.** Sync definitions first across all resource types, then sync the resources with their metafield values.

---

## App Store Requirements (Summary)

All of these are mandatory for approval:
- Embedded app with App Bridge (latest version from Shopify CDN)
- Session token auth (no cookies, works in incognito)
- Managed installation via shopify.app.toml
- GraphQL Admin API only (zero REST)
- Three compliance webhooks: customers/data_request, customers/redact, shop/redact
- Managed Pricing plans (no off-platform billing)
- Billing works on reinstall, upgrades/downgrades without support
- Privacy policy URL, emergency contact, demo screencast
- App icon 1200×1200px, feature image 1600×900px, screenshots of actual UI
- Name ≤30 chars, starts with brand, no "Shopify"
- Minimal access scopes, TLS/SSL everywhere, no broken pages

Review takes 8–10 business days (often 2–4 weeks in practice). Common rejections: broken install flow, billing errors, UI errors during review.

---

## Secondary Goal

Cascade is also the first publicly launched AI-developed app for Steadro — a showcase of Shopify expertise and AI-driven development methodology. The "built with AI" angle is a differentiator in the App Store and marketing.

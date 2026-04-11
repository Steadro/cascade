# Cascade — Technical Specification

**Version:** 1.0
**Last updated:** April 9, 2026
**Status:** Ready for development

Cascade is a Shopify embedded app that lets enterprise merchants promote store content between dev, staging, and production environments. This document is the single source of truth for building it. It contains every architectural decision, data model, API pattern, UI screen, and constraint. Build from this document.

---

## Hard Constraints

These are non-negotiable. Do not deviate from these under any circumstances.

1. **GraphQL Admin API only.** Zero REST API calls. Shopify mandates GraphQL for all new public apps as of April 2025. REST is legacy.
2. **Embedded app.** Runs inside Shopify admin via App Bridge. Load `app-bridge.js` from Shopify's CDN in the `<head>` before any other scripts.
3. **Polaris components for all UI.** Use Shopify's Polaris design system. No custom UI frameworks.
4. **Session token authentication.** Short-lived JWTs, 1-minute lifetime, HS256. No third-party cookies, no localStorage for auth. Must work in Chrome incognito.
5. **Shopify managed installation.** Configured in `shopify.app.toml`. No custom OAuth install flow.
6. **React Router v7 + Node.js + Prisma.** PostgreSQL for all environments (dev, test, production). This is the scaffolded stack — do not change it.
7. **Three mandatory compliance webhooks.** `customers/data_request`, `customers/redact`, `shop/redact`. Must validate HMAC signatures and return 200. Missing these = App Store rejection.
8. **Managed Pricing for billing.** Plans defined in Partner Dashboard, not in code. No Billing API code. App only needs to check subscription status and redirect to the Shopify-hosted plan page.
9. **Use Context7 MCP** to fetch current documentation for Shopify APIs, Polaris, React Router, Prisma, and @shopify/shopify-app-js before writing any code that uses those libraries. Do not rely on training data for API signatures or method names.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Router v7 (Shopify app template) |
| Runtime | Node.js |
| ORM | Prisma |
| Database | PostgreSQL (DigitalOcean managed — all environments) |
| UI | Shopify Polaris + App Bridge |
| API | Shopify GraphQL Admin API |
| Hosting | DigitalOcean App Platform |
| Auth | Shopify session tokens + managed installation |
| Billing | Shopify Managed Pricing (no code — Partner Dashboard) |

---

## Access Scopes

Configure in `shopify.app.toml` under `[access_scopes]`:

```
scopes = "read_products,write_products,read_inventory,write_inventory,read_content,write_content,read_online_store_navigation,write_online_store_navigation,read_files,write_files"
```

Each scope is required for a specific sync capability:

| Scope | Used for |
|-------|----------|
| `read_products` / `write_products` | Products, variants, collections, metafields on products/collections |
| `read_inventory` / `write_inventory` | Inventory quantities during product sync |
| `read_content` / `write_content` | Pages, blog posts, articles |
| `read_online_store_navigation` / `write_online_store_navigation` | Navigation menus, URL redirects |
| `read_files` / `write_files` | File uploads, CDN asset management |

---

## Database Schema

Cascade needs three custom tables beyond the default Shopify session table. Add these to `prisma/schema.prisma`.

### StorePairing

Links a "primary" store (the one paying for the subscription) with one or more "paired" stores (dev/staging environments). Every sync operation happens between two stores in a pairing.

```prisma
model StorePairing {
  id              String   @id @default(cuid())
  primaryShop     String   // myshopify domain of the paying store (e.g., "cool-brand.myshopify.com")
  pairedShop      String   // myshopify domain of the paired store
  label           String?  // user-defined label, e.g., "Development", "Staging", "QA"
  status          String   @default("active") // "active", "disconnected"
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  syncJobs        SyncJob[]
  resourceMaps    ResourceMap[]

  @@unique([primaryShop, pairedShop])
}
```

### ResourceMap

Cross-store ID mapping table. This is the core data challenge — every Shopify resource has a store-specific GID that is not portable. This table links "the same resource" across two stores.

```prisma
model ResourceMap {
  id              String   @id @default(cuid())
  pairingId       String
  pairing         StorePairing @relation(fields: [pairingId], references: [id], onDelete: Cascade)
  resourceType    String   // "Product", "Collection", "Page", "Menu", "Blog", "Article", "File", "MetafieldDefinition", "UrlRedirect"
  sourceId        String   // GID on source store (e.g., "gid://shopify/Product/12345")
  targetId        String   // GID on target store (e.g., "gid://shopify/Product/67890")
  handle          String?  // handle used for initial matching
  lastSyncedAt    DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([pairingId, resourceType, sourceId])
  @@index([pairingId, resourceType])
  @@index([pairingId, resourceType, handle])
}
```

### SyncJob

Tracks each sync operation from request through completion. Sync jobs are asynchronous — the UI submits them and polls for status.

```prisma
model SyncJob {
  id              String   @id @default(cuid())
  pairingId       String
  pairing         StorePairing @relation(fields: [pairingId], references: [id], onDelete: Cascade)
  sourceShop      String   // which store is the source for this sync
  targetShop      String   // which store is the target
  resourceTypes   String   // JSON array of types to sync, e.g., '["Product","Collection","Menu"]'
  status          String   @default("pending") // "pending", "running", "completed", "failed", "cancelled"
  progress        Int      @default(0) // percentage 0-100
  totalItems      Int      @default(0)
  processedItems  Int      @default(0)
  errors          String?  // JSON array of error messages
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Migration

After updating the schema, generate and apply the migration:

```
npx prisma migrate dev --name add_cascade_models
```

---

## Shopify App Configuration

Update `shopify.app.toml` with the following. The `client_id` is already populated from `shopify app config link`. Add the scopes and webhook configuration:

```toml
name = "Cascade"
client_id = "<already set>"
application_url = "<set by shopify app dev>"
embedded = true

[access_scopes]
scopes = "read_products,write_products,read_inventory,write_inventory,read_content,write_content,read_online_store_navigation,write_online_store_navigation,read_files,write_files"

[webhooks]
api_version = "2026-04"

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
compliance_topics = ["customers/redact", "customers/data_request", "shop/redact"]
uri = "/webhooks"

[build]
automatically_update_urls_on_dev = true
dev_store_url = "steadro-dev-2.myshopify.com"
```

---

## App Navigation

Use App Bridge `s-app-nav` for sidebar navigation. The app has four main screens:

```
Cascade
├── Home (dashboard — sync status, paired stores overview)
├── Stores (manage store pairings)
├── Sync (select resources, preview diff, execute sync)
└── History (past sync jobs and their status)
```

---

## Screen Specifications

### Screen 1: Home (Dashboard)

**Route:** `/app`
**Purpose:** At-a-glance overview of paired stores and recent sync activity.

**Content:**
- First launch (no pairings, no subscription): Show a Polaris Banner (info tone) at the top: "We recommend installing Cascade on your production store first — that's where your subscription and billing will be managed. Dev and staging stores pair to it for free." This banner is dismissible and only shows when the store has no pairings and no active subscription.
- Banner showing the current store's role (e.g., "This is your primary store with 2 paired environments")
- If no pairings exist: empty state with call-to-action to pair a store
- Card for each paired store showing: store name, label (Dev/Staging/etc), last sync timestamp, status
- Recent sync jobs list (last 5) with status badges (completed, failed, running)
- If on a paired (non-primary) store: show who the primary store is and indicate this store doesn't manage billing

**Feature gating:** Check if the primary store in the pairing has an active subscription. If not, show an upgrade prompt. For MVP, since billing is Managed Pricing, query the `appInstallation` field to check subscription status.

### Screen 2: Stores (Manage Pairings)

**Route:** `/app/stores`
**Purpose:** Add, view, and remove paired stores.

**Content:**
- List of current pairings with store domain, label, status, and a "Remove" action
- "Pair a new store" button that opens a form:
  - Input field: myshopify domain of the store to pair (e.g., `my-dev-store.myshopify.com`)
  - Dropdown: label (Development, Staging, QA, Custom)
  - The target store must also have Cascade installed. Validate this by checking if we have an active session for that store domain.
- Pairing validation flow:
  1. User enters domain
  2. Backend checks if that store has Cascade installed (has a session record)
  3. If yes → create the StorePairing record, show success
  4. If no → show message: "Cascade must be installed on that store first. Share this install link: [app install URL]"

**Rules:**
- Only the primary store can manage pairings. Paired stores see their pairings as read-only.
- The store the merchant is currently logged into is always the "primary" store when creating pairings.
- Enforce plan limits: Free = 0 paired stores (view only), Pro = 1, Business = 3, Enterprise = unlimited. For MVP, implement the check but use a config constant for the limit since Managed Pricing handles billing externally.

### Screen 3: Sync

**Route:** `/app/sync`
**Purpose:** The core feature. Select a target store, choose resource types, preview what will change, and execute the sync.

**Step 1: Configure**
- Dropdown: select target store from paired stores list
- Direction toggle: Push (current store → target) or Pull (target → current store)
- Checkboxes: which resource types to sync. Options:
  - ☑ Metafield Definitions
  - ☑ Products (includes variants, images, metafields)
  - ☑ Collections (smart rules + manual membership)
  - ☑ Pages
  - ☑ Blog Posts
  - ☑ Navigation Menus
  - ☑ URL Redirects
  - ☑ Files/Assets
- "Preview Changes" button

**Step 2: Preview (Diff)**
- For each selected resource type, show a summary:
  - "Products: 42 to create, 15 to update, 0 to delete"
  - "Menus: 2 to create, 1 to update"
- Expandable section per resource type showing individual items:
  - Each item shows: handle/title, action (create/update/skip), and a brief description of what changed
- This is the change detection feature that differentiates Cascade from every competitor.
- "Start Sync" button and "Cancel" button

**Step 3: Execute**
- Progress view showing:
  - Overall progress bar (percentage)
  - Current resource type being processed
  - Items processed / total
  - Real-time log of actions taken
- On completion: summary of results (X created, Y updated, Z errors)
- Link to view details in History

**Diff algorithm:**
- Read all resources of the selected types from both source and target stores
- Match resources by handle (products, collections, pages, menus, blogs) or by namespace+key (metafield definitions) or by path (redirects)
- For matched resources: compare `updatedAt` timestamps. If source is newer, mark as "update". For deeper comparison, hash the relevant fields and compare.
- For unmatched source resources: mark as "create"
- For unmatched target resources: do NOT mark for deletion in MVP. Only creates and updates. Deletion is dangerous and should be a V2 opt-in feature.

### Screen 4: History

**Route:** `/app/history`
**Purpose:** View past sync jobs and their outcomes.

**Content:**
- Table of SyncJob records with columns: date, direction (source → target), resource types, status, items processed, duration
- Click a row to see detail view:
  - Full error log if any errors occurred
  - Breakdown by resource type (X products created, Y collections updated, etc.)
  - Timestamp for started, completed

---

## Sync Engine Architecture

The sync engine is the core of the app. It runs server-side and is invoked by the Sync screen's "Start Sync" action.

### Sync Pipeline

Each sync job follows this pipeline:

```
1. VALIDATE
   - Confirm both stores have active sessions
   - Confirm pairing exists and is active
   - Confirm primary store has active subscription (feature gate)

2. READ SOURCE
   - For each selected resource type, query all resources from the source store
   - Use Bulk Operations API if resource count > 50
   - Store results in memory (or temp file for very large datasets)

3. READ TARGET
   - For each selected resource type, query all resources from the target store
   - Same bulk operations threshold

4. DIFF
   - Match source and target resources by handle/key
   - Identify: creates (source only), updates (both exist, source newer), skips (both exist, target same or newer)
   - Build a "sync plan" — ordered list of operations to execute

5. TRANSFORM
   - Remap GIDs: look up ResourceMap for existing mappings
   - For creates: no target GID yet (will be created)
   - For updates: use mapped target GID
   - Rewrite CDN URLs in HTML content (pages, articles)
   - Rewrite resource references in metafield values (file references, product references)

6. EXECUTE
   - Process in dependency order (metafield defs → files → products → collections → pages → blogs → menus → redirects)
   - For each resource: call the appropriate mutation
   - After successful create: store the new GID mapping in ResourceMap
   - After successful update: update lastSyncedAt in ResourceMap
   - Track progress: update SyncJob.processedItems after each operation
   - On error: log the error, continue with next resource (don't fail the entire job)

7. COMPLETE
   - Set SyncJob status to "completed" or "failed" (if all items errored)
   - Set completedAt timestamp
```

### Resource-Specific Sync Logic

#### Metafield Definitions

**Read:** Query `metafieldDefinitions` connection, filtered by `ownerType` (PRODUCT, COLLECTION, PAGE, etc.)
**Match by:** `ownerType` + `namespace` + `key`
**Write:** `metafieldDefinitionCreate` for new definitions
**Notes:**
- Sync these FIRST — they must exist on the target before any metafield values can be set
- Cannot change `type`, `namespace`, `key`, or `ownerType` after creation
- Skip definitions with `$app:` namespace prefix — these belong to other apps
- Match standard definitions by template key; use `standardMetafieldDefinitionEnable` instead of recreating

#### Products

**Read:** Query `products` connection with nested `variants`, `options`, `media`, `metafields`, `collections`
**Match by:** `handle`
**Write:** `productSet` mutation — this is the primary sync primitive
**Notes:**
- `productSet` handles create-or-update semantics in one call
- Include ALL variants in every `productSet` call — omitted variants get DELETED
- Media: pass CDN URLs as `originalSource` in the `files` array — Shopify re-downloads them
- Metafields: include in the `metafields` array of `productSet`
- Collections: include in the `collections` array of `productSet` (requires target collection GIDs — sync collections first, or do a second pass)
- After create: product is UNPUBLISHED by default. Call `publishablePublish` to make it available
- Throttle: stores with 50,000+ variants are limited to 1,000 new variants/day
- For large catalogs (50+ products): use Bulk Operations API with `productSet` in the mutation

#### Collections

**Read:** Query `collections` connection with `ruleSet` (for smart collections) and `products` (for manual collections)
**Match by:** `handle`
**Write:** `collectionCreate` for new, `collectionUpdate` for existing
**Notes:**
- Smart collections: sync the `ruleSet` (rules are portable — they reference product properties, not IDs)
- Manual collections: sync the product membership. Requires mapping source product GIDs → target product GIDs via ResourceMap. Use `collectionAddProducts` after creation.
- Collection images: pass URL as `image.src` — Shopify re-downloads
- After create: collection is UNPUBLISHED. Call `publishablePublish`.
- Sort order for manual collections: set via `collectionUpdate` with `sortOrder` field

#### Pages

**Read:** Query `pages` connection with `title`, `handle`, `body`, `bodySummary`, `isPublished`, `templateSuffix`, `metafields`
**Match by:** `handle`
**Write:** `pageCreate` for new, `pageUpdate` for existing
**Notes:**
- Body HTML may contain Shopify CDN URLs (embedded images). Must parse, re-upload images to target store, and rewrite URLs before saving.
- CDN URL pattern to detect: `cdn.shopify.com/s/files/`
- `templateSuffix` assumes matching templates exist on target store
- Author is not settable — assigned to the authenticated app user

#### Blog Posts

**Read:** Query `blogs` connection, then `articles` within each blog
**Match by:** blog `handle`, then article `handle` within that blog
**Write:** `blogCreate` for new blogs, `articleCreate` / `articleUpdate` for articles
**Notes:**
- Same CDN URL rewriting concerns as pages
- Blog must exist on target before articles can be created in it
- Sync blogs first, then articles within each blog

#### Navigation Menus

**Read:** Query `menus` connection with nested `items` (up to 3 levels)
**Match by:** `handle`
**Write:** `menuCreate` for new, `menuUpdate` for existing
**Notes:**
- Menu items contain `resourceId` fields that point to collections, products, pages, or blogs. These are store-specific GIDs and MUST be remapped via ResourceMap.
- Item types: COLLECTION, PRODUCT, PAGE, BLOG, CATALOG, FRONTPAGE, HTTP, SEARCH
- HTTP and SEARCH types don't need remapping
- FRONTPAGE type doesn't use a resourceId
- Default menus (main-menu, footer) cannot have their handles changed
- **Sync menus LAST** — they depend on all other resources existing on the target store
- If a referenced resource doesn't exist on the target (no mapping found), skip that menu item and log a warning

#### URL Redirects

**Read:** Query `urlRedirects` connection
**Match by:** `path`
**Write:** `urlRedirectCreate` for new redirects
**Notes:**
- Simple path → target mapping, no GID remapping needed
- For bulk redirects: use `urlRedirectImportCreate` with a CSV staged upload
- Cannot create duplicate paths — check for existing redirects first

#### Files / Assets

**Read:** Query `files` connection
**Write:** `fileCreate` with `originalSource` URL (for publicly accessible CDN files) or staged upload workflow
**Notes:**
- Files are not synced as a standalone resource type in MVP. Instead, they are handled inline when syncing products (media), pages (body HTML images), and collections (images).
- The `originalSource` shortcut works for most cases — pass the source store's CDN URL and Shopify downloads it automatically.
- File processing is async. After `fileCreate`, poll for `READY` status before referencing the file.
- For the diff/preview step, don't try to diff individual files — instead, show file counts as part of the parent resource's diff (e.g., "Product X: 3 new images to upload").

---

## API Layer

### GraphQL Client Setup

The Shopify app template provides an authenticated GraphQL client via the `admin` object from `authenticate.admin(request)`. For the SOURCE store in a sync, we also need an authenticated client for a different store.

**Critical architecture decision:** Each store that has Cascade installed has its own session stored in the database. To make API calls to a paired store, retrieve that store's offline session token from the Prisma `Session` table and construct an admin API client with it.

```
// Pseudo-pattern for making API calls to a paired store:
// 1. Look up the session for the paired store in the Session table
// 2. Use the Shopify API library to create an authenticated client with that session
// 3. Make GraphQL queries/mutations against that store
```

Use Context7 to look up the exact API for creating an admin client from a stored session in `@shopify/shopify-app-js` — the pattern depends on the current library version.

### Rate Limit Handling

- GraphQL Admin API: 100 points/second (Standard), 1,000 points/second (Plus)
- Mutations cost 10 points base
- Read the `X-Shopify-Shop-Api-Call-Limit` response header (or the `throttleStatus` in GraphQL extensions) to track remaining budget
- If approaching limit: pause and wait. Implement exponential backoff.
- For sync jobs: process one mutation at a time with a small delay (100ms) to stay well within limits
- For large operations: use Bulk Operations API which bypasses rate limits entirely

### Bulk Operations Pattern

For reading large datasets (50+ resources):

```
1. Submit: bulkOperationRunQuery with the GraphQL query
2. Poll: query bulkOperation(id:) every 2-5 seconds for status
3. Download: when status is COMPLETED, download JSONL from the url field
4. Parse: read JSONL line by line, each line is a JSON object
5. Process: transform and use the data
```

For writing large datasets:

```
1. Build: create a JSONL file with one mutation input per line
2. Upload: use stagedUploadsCreate to get an upload URL, then POST the JSONL file
3. Submit: bulkOperationRunMutation with the mutation string and staged upload path
4. Poll: same as reads
5. Check results: download the result JSONL for per-item success/error status
```

---

## Compliance Webhook Handlers

The route at `/webhooks` (configured in `shopify.app.toml`) must handle three compliance topics. The app template likely already has a webhook handler — extend it to handle these:

### customers/data_request

A customer has requested their data. Since Cascade does NOT store customer data (we only sync store content like products, pages, and menus), respond with a 200 status and an empty payload. Log the request for audit purposes.

### customers/redact

A store owner wants customer data deleted. Same as above — we don't store customer data, so acknowledge with 200 and log it.

### shop/redact

A merchant has uninstalled the app. Triggered 48 hours after uninstall. We MUST delete all data associated with that shop within 30 days.

**Action required:**
1. Delete all `StorePairing` records where `primaryShop` or `pairedShop` matches the uninstalled shop domain
2. Cascade delete will handle `ResourceMap` and `SyncJob` records (via Prisma's `onDelete: Cascade`)
3. Delete the Session record for that shop
4. Log the deletion for audit purposes
5. Respond with 200

---

## Feature Gating (Subscription Check)

Since billing is handled by Managed Pricing (no code), the app needs to check whether the current store has an active subscription to gate features.

Query the current store's subscription status using the `appInstallation` query:

```graphql
query {
  appInstallation {
    activeSubscriptions {
      id
      name
      status
      lineItems {
        plan {
          pricingDetails {
            ... on AppRecurringPricing {
              price {
                amount
                currencyCode
              }
              interval
            }
          }
        }
      }
    }
  }
}
```

**Gating logic:**
- If `activeSubscriptions` is empty or status is not `ACTIVE` → free tier (can view diffs, cannot execute syncs, cannot pair stores)
- If active subscription exists → check the plan name to determine tier limits:
  - Pro: max 1 paired store
  - Business: max 3 paired stores
  - Enterprise: unlimited paired stores

Store the plan tier as a derived value on the server side. Check it before allowing pairing or sync operations.

---

## ID Mapping and Cross-Store Matching

This is the core technical challenge. Every resource in Shopify has a store-specific Global ID (GID) like `gid://shopify/Product/12345`. The same product on a different store has a completely different GID.

### Initial Match Strategy

When syncing for the first time between two stores (no existing ResourceMap entries):

| Resource Type | Match By |
|--------------|----------|
| Products | `handle` |
| Collections | `handle` |
| Pages | `handle` |
| Blogs | `handle` |
| Articles | `handle` (within the same blog handle) |
| Menus | `handle` |
| Metafield Definitions | `ownerType` + `namespace` + `key` |
| URL Redirects | `path` |

### Subsequent Sync Strategy

After the first sync, ResourceMap entries exist. Use `sourceId` to look up the corresponding `targetId` for updates.

### GID Remapping in Content

Some fields contain GID references to other resources:
- **Menu item `resourceId`:** points to a Collection, Product, Page, or Blog GID → look up in ResourceMap
- **Metafield values of type `product_reference`, `collection_reference`, `file_reference`, `page_reference`:** contain GIDs → look up in ResourceMap
- **Manual collection membership:** list of product GIDs → look up each in ResourceMap
- **`productSet` collections field:** list of collection GIDs → look up each in ResourceMap

When a referenced GID has no mapping (the referenced resource doesn't exist on the target), skip that reference and log a warning. Do not fail the sync.

---

## CDN URL Rewriting

Page body HTML, article body HTML, and metafield values may contain Shopify CDN URLs from the source store. These URLs are not valid on the target store.

### Detection Pattern

Look for URLs matching: `https://cdn.shopify.com/s/files/` or the store-specific pattern.

### Rewriting Strategy

For MVP, use a simple approach:
1. Regex scan the HTML for `https://cdn.shopify.com/s/files/[^"'\s]+`
2. For each found URL, call `fileCreate` on the target store with `originalSource: <source_url>`
3. Wait for the file to be processed (poll for READY status)
4. Replace the source URL in the HTML with the new target file's URL
5. Then create/update the page with the rewritten HTML

This is potentially slow for pages with many images. For MVP, this is acceptable. V2 can batch the file uploads and parallelize.

---

## Sync Dependency Order

Resources MUST be synced in this order. The sync engine should process all items of one type before moving to the next.

```
1. Metafield Definitions     ← No dependencies
2. Products                   ← Depends on: metafield definitions
3. Collections                ← Depends on: products (for manual membership)
4. Pages                      ← No hard dependencies (CDN URLs handled inline)
5. Blog Posts                 ← No hard dependencies (CDN URLs handled inline)
6. Navigation Menus           ← Depends on: products, collections, pages, blogs
7. URL Redirects              ← No hard dependencies
```

Files are not synced separately — they're handled inline within their parent resource's sync step (product media via `productSet`, page images via CDN rewriting).

---

## Error Handling

### Per-Resource Errors

If a single resource fails to sync (mutation returns `userErrors`), log the error, mark that item as failed, and continue with the next resource. Do not abort the entire sync job.

Store errors in the SyncJob's `errors` field as a JSON array:

```json
[
  {
    "resourceType": "Product",
    "handle": "blue-widget",
    "action": "create",
    "error": "Title can't be blank",
    "timestamp": "2026-04-02T10:30:00Z"
  }
]
```

### Rate Limit Errors

If a rate limit error is returned (HTTP 429 or `THROTTLED` error code), wait and retry with exponential backoff. Start at 1 second, double each retry, max 5 retries.

### Network Errors

Retry transient network errors up to 3 times with exponential backoff. If all retries fail, mark the item as failed and continue.

### Session Errors

If a 401 Unauthorized is returned, the session token for that store may have expired. Log an error, mark the sync job as failed with a message indicating the paired store needs to be re-authenticated. The merchant will need to open Cascade from the affected store's admin to refresh the session.

---

## Webhook Configuration

Beyond compliance webhooks, subscribe to `APP_SUBSCRIPTIONS_UPDATE` to detect when a merchant cancels or changes their subscription. Handle this in the webhook route:

- On subscription cancellation: disable sync capabilities for stores paired under that primary store
- On subscription activation: re-enable sync capabilities

Also subscribe to `app/uninstalled` to clean up when a store uninstalls the app:
- If a primary store uninstalls: mark all its pairings as "disconnected"
- If a paired store uninstalls: remove it from the pairing

---

## Development Phases

Each phase must follow the Build-Test-Verify loop defined in CLAUDE.md. A phase is NOT complete until all tests pass and the app boots cleanly.

### Phase 1: Foundation
- [ ] **Install Vitest and testing dependencies:** `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`. Configure `vitest.config.ts` (separate from vite.config.ts to avoid React Router plugin conflicts). Add `test`, `test:unit`, `test:integration`, and `test:api` scripts to package.json. Create `/tests` directory structure (`/unit`, `/integration`, `/api`, `/mocks`).
- [ ] **Update Prisma schema** with StorePairing, ResourceMap, SyncJob models
- [ ] **Run migration** (`npx prisma migrate dev --name add_cascade_models`)
- [ ] **Write integration tests for all three models:** create, read, update, delete, unique constraints, cascade deletes. Run them. They must pass.
- [ ] **Update shopify.app.toml** with access scopes and webhook config
- [ ] **Set up app navigation** (Home, Stores, Sync, History) using App Bridge `s-app-nav`
- [ ] **Implement compliance webhook handlers** (customers/data_request, customers/redact, shop/redact). Each must validate HMAC, return 200, and handle shop/redact by deleting related StorePairing records.
- [ ] **Write tests for webhook handlers:** mock incoming webhook payloads, verify correct responses and database side effects.
- [ ] **Implement subscription status check utility** (query appInstallation.activeSubscriptions)
- [ ] **Write unit test for subscription check:** mock GraphQL response, verify correct plan tier detection.
- [ ] **Run ALL tests.** Show output. All must pass.
- [ ] **Verify app boots cleanly** with `shopify app dev`
- [ ] **Commit** with message describing what was built and tested

### Phase 2: Store Pairing
- [ ] Build Stores screen (list, add, remove pairings)
- [ ] Implement pairing validation (check if target store has Cascade installed)
- [ ] Implement plan-based pairing limits
- [ ] Build Home dashboard with pairing overview
- [ ] **Write tests:** pairing CRUD operations, validation logic (reject invalid domains, reject duplicate pairings, enforce plan limits), cascade behavior when pairing is deleted
- [ ] **Run ALL tests.** All must pass. Commit.
- [ ] **Document manual testing needed:** describe what to verify visually in the Shopify admin (store list renders, add form works, error states display correctly)

### Phase 3: Sync Engine - Read & Diff
- [ ] Build GraphQL queries for each resource type on source store
- [ ] Build GraphQL queries for each resource type on target store
- [ ] Implement handle-based matching logic
- [ ] Implement diff algorithm (create/update/skip classification)
- [ ] Build Preview screen showing diff results
- [ ] **Write unit tests:** matching logic (handle matches, no-match creates, type-specific matchers for metafield definitions), diff algorithm (correctly classifies creates/updates/skips, respects timestamp comparison), dependency ordering
- [ ] **Write tests with mock Shopify API responses:** create realistic mock data in `/tests/mocks` (sample product lists, collection lists, menu structures). Test that the read → match → diff pipeline produces correct output.
- [ ] **Run ALL tests.** All must pass. Commit.

### Phase 4: Sync Engine - Transform & Execute
- [ ] Implement ID remapping using ResourceMap
- [ ] Implement CDN URL rewriting for HTML content
- [ ] Implement mutation execution for each resource type
- [ ] Implement ResourceMap updates after successful creates
- [ ] Implement progress tracking and SyncJob status updates
- [ ] Build execution progress UI
- [ ] **Write unit tests:** ID remapping (known mappings resolve, unknown mappings skip gracefully), CDN URL detection regex (catches all Shopify CDN patterns, ignores non-CDN URLs), CDN URL rewriting (correctly replaces URLs in HTML), GID reference detection in metafield values
- [ ] **Write integration tests:** SyncJob status transitions (pending → running → completed/failed), progress tracking updates, ResourceMap creation after successful sync
- [ ] **Run ALL tests.** All must pass. Commit.

### Phase 5: History & Polish
- [ ] Build History screen with job list and detail views
- [ ] Add error display and retry suggestions
- [ ] Test with real multi-store data (manual testing — document the test plan)
- [ ] Performance optimization (bulk operations for large stores)
- [ ] App Store compliance checklist pass
- [ ] **Run full test suite one final time.** All must pass.
- [ ] **Document what requires manual testing** for App Store review (install flow, billing flow, visual UI, multi-store sync with real data)

---

## Multi-Store Development Testing

Multi-store testing runs against the **DigitalOcean App Platform deployment**, not a local tunnel. The deployed app has a single permanent URL that both dev stores install against. This is the same topology a merchant-facing production app uses, so the install flow being validated here is the real one.

> **Why not ngrok or `shopify app dev --tunnel-url`?** `shopify app dev` only rewrites the app URL for the store it is actively tunneling to — a second store installed against the same Partner app would hit a stale URL the moment the dev server restarts. ngrok is also blocked on the Steadro network (SSL/TLS interception), so it is not a viable fallback. The deployed app URL is stable across restarts and shared by every store, which is what multi-store install requires.

**One-time setup:**
1. Deploy the app to DigitalOcean App Platform. The Dockerfile at the repo root builds the container; `prisma migrate deploy` runs on container start. Confirm the app is reachable at its `ondigitalocean.app` URL (or custom domain).
2. Set `application_url` in `shopify.app.toml` to the deployed URL (HTTPS, no trailing slash).
3. Run `shopify app deploy` to push the config to the Partner Dashboard. This updates the app URL and allowed redirect URLs for every store.
4. In the Partner Dashboard, confirm the app URL and `/auth/callback` redirect URL both match the deployed URL.

**Install flow (per store):**
1. **First store** — open the Partner Dashboard → Apps → Cascade → "Test on development store" → select the store. Shopify walks the OAuth consent and drops you into the embedded app.
2. **Second store** — visit `https://admin.shopify.com/store/SECOND-STORE-HANDLE/oauth/install?client_id=CLIENT_ID` directly (the client_id is in `shopify.app.toml`). This triggers the same OAuth flow against the deployed app URL.
3. After each install, confirm a row exists in the Prisma `Session` table for the store (`npx prisma studio` → Session). The `accessToken` column must be populated — that is the offline token used for cross-store API calls.

**How cross-store sync works at the server level:**
- The merchant opens Cascade from Store A's admin. The embedded app loads from the deployed URL via App Bridge.
- Store A's session is derived from the current request's session token (App Bridge).
- When Cascade needs to read from or write to Store B, the server looks up Store B's offline access token from the Prisma `Session` table and constructs an Admin API client for Store B using `createAdminApiClient` (see AD-004).
- Store B never needs its own browser session or tunnel — the stored offline token is sufficient for server-to-server GraphQL calls.

**Do NOT:**
- Do not attempt ngrok or any other tunnel for multi-store testing. Only the deployed URL works.
- Do not edit app URLs directly in the Partner Dashboard. Change `application_url` in `shopify.app.toml` and run `shopify app deploy` so the config stays source-controlled.
- Do not run `shopify app dev` while validating a multi-store flow. `shopify app dev` is for single-store local iteration only and will temporarily rewrite the app URL, breaking the deployed install.
- Do not mix a locally-running database with the deployed app. The deployed app uses the managed PostgreSQL instance; local changes to `prisma/schema.prisma` must be deployed (`prisma migrate deploy` runs automatically on container start) before testing against it.

**Local single-store iteration is unchanged:** `shopify app dev` with the default Cloudflare tunnel still works for fast inner-loop development against one store. Use it for UI and logic work; switch to the deployed app only when validating install, OAuth, or multi-store sync.

---

## App Store Submission Checklist

Before submitting, verify every item:

- [ ] Session token auth works (no third-party cookies, works in incognito)
- [ ] App Bridge loaded before all other scripts
- [ ] Managed installation configured in shopify.app.toml
- [ ] GraphQL only (zero REST calls)
- [ ] Three compliance webhooks responding correctly
- [ ] Managed Pricing plans defined in Partner Dashboard
- [ ] Billing works on reinstall
- [ ] Plan upgrades/downgrades work without support contact
- [ ] Privacy policy URL set in listing
- [ ] Emergency contact (email + phone) in listing
- [ ] Demo screencast with working test credentials
- [ ] App icon: 1200×1200px JPEG/PNG
- [ ] Feature image: 1600×900px, 16:9
- [ ] Screenshots showing actual UI (no pricing/testimonials/PII)
- [ ] App name is "Cascade" (7 chars, no "Shopify")
- [ ] Only necessary scopes requested
- [ ] TLS/SSL on all endpoints
- [ ] No 404s, 500s, or broken UI during review

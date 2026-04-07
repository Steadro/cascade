# Cascade

**Enterprise store promotion for Shopify** — sync content between development, staging, and production environments with change detection and selective promotion.

[![CI](https://github.com/Steadro/cascade/actions/workflows/ci.yml/badge.svg)](https://github.com/Steadro/cascade/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

---

## The Problem

Enterprise Shopify merchants maintain multiple store environments but have no reliable native tool to keep them in sync. Manually recreating products, collections, pages, menus, and metafields across environments is slow, error-prone, and creates drift.

**Cascade** is the missing CI/CD for Shopify store data.

## Key Features

- **Environment-aware pipeline** — understands dev → staging → prod as a promotion flow
- **Change detection** — shows diffs before syncing (like `git diff` for store content)
- **Selective promotion** — sync only specific resource types or changes
- **Bidirectional sync** — push changes downstream or pull production data back to staging
- **Cross-store ID mapping** — persistent GID mapping survives re-pairings

## Supported Resources

| Resource | Match Strategy | Diff Method |
|----------|---------------|-------------|
| Products (variants, images, metafields) | Handle | Timestamp |
| Collections (smart + manual) | Handle | Timestamp |
| Pages (with metafields) | Handle | Timestamp |
| Blog Posts & Articles | Handle | Timestamp |
| Navigation Menus (3 levels) | Handle | Content hash |
| Metafield Definitions | Handle | Content hash |
| URL Redirects | Handle | Content hash |

Sync order is enforced: Metafield definitions → Products → Collections → Pages → Blogs → Menus → Redirects

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [React Router v7](https://reactrouter.com/) |
| Runtime | Node.js 20+ |
| ORM | [Prisma 6](https://www.prisma.io/) |
| Database | SQLite (dev) / PostgreSQL (prod) |
| UI | [Shopify Polaris](https://polaris.shopify.com/) + [App Bridge](https://shopify.dev/docs/api/app-bridge-library) |
| API | Shopify GraphQL Admin API |
| Build | [Vite 6](https://vitejs.dev/) |
| Testing | [Vitest 4](https://vitest.dev/) |
| Linting | ESLint + Prettier |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20.19+ (see `engines` in package.json)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) installed globally
- A [Shopify Partner account](https://partners.shopify.com/) with a development store

### Installation

```bash
# Clone the repository
git clone https://github.com/Steadro/cascade.git
cd cascade

# Install dependencies
npm install

# Set up the database
npx prisma migrate dev
npx prisma generate
```

### Local Development

```bash
shopify app dev
```

Press **P** to open the app URL. Install on your development store to start working.

### Running Tests

```bash
npm test                  # All tests
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
npm run test:watch        # Watch mode
```

### Type Checking

```bash
npm run typecheck
```

### Building for Production

```bash
npm run build
npm start
```

---

## Project Structure

```
cascade/
├── app/
│   ├── routes/
│   │   ├── app.tsx                # App shell with navigation
│   │   ├── app._index.tsx         # Dashboard
│   │   ├── app.stores.tsx         # Store pairing management
│   │   ├── app.sync.tsx           # Sync configuration & preview
│   │   ├── app.history.tsx        # Sync job history
│   │   ├── auth.login/route.tsx   # Login
│   │   ├── auth.$/tsx             # OAuth callback
│   │   ├── webhooks.tsx           # Compliance webhooks
│   │   └── _index/route.tsx       # Public landing page
│   ├── sync/                      # Core sync engine
│   │   ├── index.server.ts        # Preview generation orchestrator
│   │   ├── reader.server.ts       # GraphQL resource fetching
│   │   ├── matcher.server.ts      # Handle-based cross-store matching
│   │   ├── diff.server.ts         # Change detection (timestamp & hash)
│   │   ├── queries.server.ts      # GraphQL query templates
│   │   └── types.ts               # Sync types & constants
│   ├── utils/
│   │   ├── pairing.server.ts      # Store pairing logic
│   │   ├── admin-client.server.ts # Multi-store API clients
│   │   └── subscription.server.ts # Plan tier detection
│   ├── db.server.ts               # Prisma singleton
│   └── shopify.server.ts          # Shopify app configuration
├── prisma/
│   └── schema.prisma              # Database schema
├── tests/
│   ├── unit/                      # Unit tests
│   └── integration/               # Integration tests
├── extensions/                    # Shopify app extensions
├── docs/                          # Project documentation
│   ├── PROJECT_CONTEXT.md         # Business context & competitive analysis
│   ├── SPEC_TECHNICAL.md          # Technical specification
│   ├── DECISIONS.md               # Architecture decisions & workarounds
│   └── CLAUDE.md                  # AI development guidelines
└── .github/
    ├── workflows/ci.yml           # CI pipeline
    ├── CONTRIBUTING.md
    └── PULL_REQUEST_TEMPLATE.md
```

## Database Schema

| Model | Purpose |
|-------|---------|
| `Session` | Shopify session management (framework-managed) |
| `StorePairing` | Links a primary store to paired environments |
| `ResourceMap` | Cross-store GID mapping for synced resources |
| `SyncJob` | Tracks async sync operations and progress |

---

## How It Works

### 1. Pair Stores

Connect your primary store with development, staging, or QA environments. Each pairing gets a label and maintains its own resource mapping history.

### 2. Preview Changes

Before syncing, Cascade generates a non-destructive preview showing exactly what will happen:

- **Create** — resource exists in source but not in target
- **Update** — resource exists in both but has changed
- **Skip** — resource is unchanged

### 3. Sync

Execute the sync with full visibility into progress. Resources sync in dependency order to maintain data integrity.

### 4. Track History

Review past sync operations, outcomes, and any errors for audit and debugging.

---

## Subscription Tiers

| Plan | Paired Stores | Price |
|------|--------------|-------|
| Free | 0 (view-only) | $0/mo |
| Pro | 1 | $49–79/mo |
| Business | 3 | $129–199/mo |
| Enterprise | Unlimited | Custom |

Billing is managed through [Shopify Managed Pricing](https://shopify.dev/docs/apps/billing) — only the primary store is billed.

---

## Architecture Decisions

- **GraphQL Admin API only** — no REST. Required for new public Shopify apps.
- **`productSet` mutation** — purpose-built for sync (creates/updates products with variants, options, metafields, and media in one call).
- **Handle-based initial matching** — products match by handle on first sync; subsequent syncs use stored GID mappings.
- **Content hashing for resources without `updatedAt`** — menus and metafield definitions use SHA-256 content hashing for change detection.
- **Soft-delete for store pairings** — preserves ResourceMap history if a merchant re-pairs a store.

---

## CI/CD

GitHub Actions runs on every push and PR:

- Tests across Node 20, 22, 24
- TypeScript type checking
- ESLint validation
- Prisma schema validation
- Full app build

---

## Deployment

### Application Storage

This app uses Prisma with SQLite in development. For production, switch to PostgreSQL by updating the `datasource` in `prisma/schema.prisma`.

| Database | Recommended Hosts |
|----------|------------------|
| PostgreSQL | [DigitalOcean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres) |

### Hosting

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run)
- [Fly.io](https://fly.io/docs/js/shopify/)
- [Render](https://render.com/docs/deploy-shopify-app)
- [DigitalOcean App Platform](https://www.digitalocean.com/products/app-platform) (target)

Set `NODE_ENV=production` in your hosting environment.

---

## Troubleshooting

<details>
<summary><strong>Database tables don't exist</strong></summary>

Run the setup script to create the database:

```bash
npm run setup
```
</details>

<details>
<summary><strong>Navigation/redirecting breaks embedded app</strong></summary>

Embedded apps must maintain the user session inside the iframe:

1. Use `Link` from `react-router` or `@shopify/polaris` — not `<a>` tags
2. Use `redirect` from `authenticate.admin` — not from `react-router`
3. Use `useSubmit` from `react-router` for form submissions
</details>

<details>
<summary><strong>"nbf" claim timestamp check failed</strong></summary>

A JWT token is expired. Ensure "Set time and date automatically" is enabled in your OS settings.
</details>

<details>
<summary><strong>Prisma engine error on Windows ARM64</strong></summary>

Set the environment variable:

```bash
PRISMA_CLIENT_ENGINE_TYPE=binary
```
</details>

---

## Documentation

| Document | Description |
|----------|-------------|
| [PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) | Business decisions & competitive analysis |
| [SPEC_TECHNICAL.md](docs/SPEC_TECHNICAL.md) | Architecture, API patterns, screen specs |
| [DECISIONS.md](docs/DECISIONS.md) | Architecture decisions & workarounds |
| [CONTRIBUTING.md](.github/CONTRIBUTING.md) | Contribution guidelines |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

---

## Resources

**Shopify:**
- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify App Bridge](https://shopify.dev/docs/api/app-bridge-library)
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components)

**Framework:**
- [React Router docs](https://reactrouter.com/home)
- [Prisma docs](https://www.prisma.io/docs)
- [Vite docs](https://vitejs.dev/guide/)

---

## License

[MIT](LICENSE.md)

Built by [Steadro](https://steadro.com)

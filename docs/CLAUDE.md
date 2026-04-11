# Cascade

A Shopify embedded app for promoting store content between dev, staging, and production environments. Built by Steadro.

## Project Documentation

Three documents govern all development. Read them before making changes:

- **`/docs/PROJECT_CONTEXT.md`** — Why we're building this, business decisions, competitive landscape, research findings, App Store requirements.
- **`/docs/SPEC_TECHNICAL.md`** — How to build it. Database schema, sync engine architecture, screen specs, API patterns, compliance handlers, development phases.
- **`/docs/DECISIONS.md`** — Architectural decisions, temporary dev workarounds (with removal conditions), and phase completion status. **Check this before every release milestone.**

When these documents conflict with assumptions or training data, the documents win.

## How to Work

### Plan First, Then Execute

Start every non-trivial task in Plan Mode (Shift+Tab twice). Build the plan, iterate until it's solid, then switch to auto-accept edits and execute. A good plan lets you one-shot the implementation. If something goes sideways mid-execution, stop and re-plan — don't keep pushing.

### Verify Everything

Give yourself a way to verify your work. After every significant change:
- Run `npx prisma migrate dev` and confirm migrations apply cleanly
- Run `npx prisma generate` to confirm the client generates
- Check for TypeScript errors
- Run `shopify app dev` and confirm the app loads without errors
- If you built UI, open the preview URL and confirm it renders correctly

Do not claim a task is complete without verification. Verification 2-3x the quality of the output.

### Update This File After Mistakes

When you make a mistake, add a rule to the Known Gotchas section below so it doesn't happen again. This file should grow over time with project-specific learnings. Claude is excellent at writing rules for itself.

### Commit Often

After each meaningful change, commit with a descriptive message. Don't batch multiple unrelated changes into one commit.

## Documentation Lookup Rules

**Always use Context7 MCP to fetch current documentation before writing or modifying code that uses any external library or API.** This is mandatory, not optional. Do not rely on training data for API signatures, method names, configuration options, or patterns.

Specifically, use Context7 for:
- **Shopify GraphQL Admin API** — mutations, queries, input types, field names
- **Shopify App Bridge** — initialization, session tokens, navigation, modals
- **Shopify Polaris** — component names, props, usage patterns
- **React Router** (formerly Remix) — loaders, actions, routing, data fetching
- **Prisma ORM** — schema syntax, client API, migrations
- **@shopify/shopify-app-js** — authentication, session management, webhook handling, billing

If Context7 doesn't have docs for a specific library, say so and use web search or ask rather than guessing.

## Hard Rules

1. **GraphQL Admin API only.** Zero REST API calls. Shopify mandates GraphQL for all new public apps.
2. **Polaris for all UI.** No custom component libraries. Use Shopify's Polaris design system.
3. **Session token auth.** No third-party cookies, no localStorage for auth. Must work in Chrome incognito.
4. **No billing code.** Billing is handled by Shopify Managed Pricing in the Partner Dashboard. The app only checks subscription status — it does not create charges.
5. **Sync dependency order matters.** Metafield definitions → Products → Collections → Pages → Blog posts → Menus → Redirects. Menus are always last because they reference other resources.
6. **`productSet` deletes omitted variants.** Always include ALL variants when calling `productSet`. Read the full product before updating.
7. **All IDs are store-specific.** Never assume a GID from one store is valid on another. Use the ResourceMap table for cross-store ID lookups.

## Tech Stack

- React Router v7 (Shopify app template — NOT legacy Remix)
- Node.js
- Prisma ORM (PostgreSQL — DigitalOcean managed in production, local or remote for dev)
- Shopify Polaris + App Bridge
- Shopify GraphQL Admin API

## Dev Commands

```bash
shopify app dev                    # Start dev server with tunnel (single-store local dev)
npx prisma migrate dev             # Run database migrations (requires DATABASE_URL)
npx prisma generate                # Regenerate Prisma client
npx prisma studio                  # Browse database
npm run build                      # Production build
npm run start                      # Serve production build (PORT env var, default 8080)
```

## Structure

```
/app                  # React Router app (routes, components, utilities)
/docs                 # Project context and technical spec
/prisma               # Database schema and migrations
/extensions           # Shopify app extensions (if any)
shopify.app.toml      # Shopify app configuration
Dockerfile            # Production container (DigitalOcean App Platform)
.env.example          # Required environment variables
CLAUDE.md             # This file — read automatically every session
```

## Deployment

**Platform:** DigitalOcean App Platform (app: cascade-app) + managed PostgreSQL (steadro-cascade-postgresql-dev, NYC1, PostgreSQL 18).

**Key facts:**
- PostgreSQL is the only database. SQLite is no longer used anywhere.
- Port 8080 is required by DigitalOcean App Platform. Server must bind to `0.0.0.0`.
- Dockerfile uses `node:20-slim` (not Alpine — Prisma has binary target issues on Alpine).
- Migrations run via a `PRE_DEPLOY` job in the app spec, NOT in the Dockerfile CMD.
- `prisma generate` runs at Docker build time. `prisma migrate deploy` runs as a PRE_DEPLOY job before each deployment.
- `DATABASE_URL` is set as an env var in the DO dashboard. It is not available at build time.
- `SHOPIFY_APP_URL` will be set to the `*.ondigitalocean.app` domain after first successful deploy.
- Multi-store testing uses the DigitalOcean deployment (permanent URL), not local tunnels. Both dev stores install against the deployed app URL.
- Local single-store dev still uses `shopify app dev` with the default Cloudflare tunnel — no changes to that workflow.
- See `docs/DEPLOYMENT.md` for the full runbook.

**Deployment workflow:**
1. Make changes locally, verify with `shopify app dev`
2. `git push origin main`
3. DO auto-builds from Dockerfile, then starts new container
4. Zero-downtime rolling deploy — old container serves until new one passes health check
5. If health check fails, automatic rollback

**Health check:** `/health` endpoint must return 200 without Shopify auth.

## Known Gotchas

<!-- Add entries here as you encounter issues. Format: what went wrong → what to do instead. -->
- The repo was initially scaffolded from the legacy Remix template. It has been corrected to the React Router template. Do not reference Remix patterns — use React Router v7 patterns.
- `SHOPIFY_CLI_PARTNERS_TOKEN` env var works for `shopify app config link` but breaks `shopify app dev` (401 on organization API). Must be unset before running `shopify app dev`.
- Shopify's Google SSO can loop if the connected Google account email doesn't match the Shopify account email. The accounts.shopify.com security settings control this.
- Vitest runs test files in parallel by default. With a shared test database, this can cause constraint failures. `fileParallelism: false` in vitest.config.ts fixes this.
- `npx prisma generate` fails with EPERM on Windows when `query_engine-windows.dll.node` is locked by a running node process. Kill the dev server first.
- `shopify app dev` only overrides the app URL for one store. Multi-store testing now uses the DigitalOcean deployment — both stores install against the deployed app URL. Local dev with `shopify app dev` is for single-store work only.
- ngrok is blocked at the network level (SSL/TLS interception). Do not attempt ngrok-based multi-store testing — use the DigitalOcean deployment instead.
- First-launch onboarding: when a store has no pairings and no subscription, show a dismissible Polaris info banner recommending they install on their production store first for billing purposes.
- Dockerfile must use `node:20-slim`, not `node:20-alpine`. Prisma has binary target mismatches on Alpine that cause runtime crashes.
- Server must bind to `0.0.0.0:8080`, not `localhost:8080`. App Platform routes traffic to `0.0.0.0` — binding to localhost makes the container unreachable.
- If using Prisma 7: `?sslmode=require` fails with DigitalOcean's self-signed CA. Use `?sslmode=no-verify` or bundle the CA cert.
